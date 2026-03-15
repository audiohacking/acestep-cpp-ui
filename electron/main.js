/**
 * Electron main process — ACE-Step UI desktop shell
 *
 * Start-up sequence
 * ─────────────────
 * 1. ensureDirs()            create user-space directories
 * 2. setupLibraryPaths()     set LD_LIBRARY_PATH (Linux) / DYLD_LIBRARY_PATH
 *                            (macOS) to BIN_DIR so that ace-qwen3 / dit-vae
 *                            child processes find their shared libraries.
 *                            Linux ELFs have a hardcoded RUNPATH to the CI
 *                            build tree; macOS dylibs use versioned install
 *                            names — both need the env var override.
 * 3. fixSonameLinks()        Linux only: archive ships libggml.so /
 *                            libggml-base.so (unversioned) but ELFs link
 *                            against libggml.so.0 / libggml-base.so.0 —
 *                            create the missing versioned symlinks.
 * 4. fixMacosDylibLinks()    macOS only: archive ships real versioned dylibs
 *                            (libggml.0.9.7.dylib) plus a two-level symlink
 *                            chain (.0.dylib → .0.9.7.dylib, .dylib → .0.dylib).
 *                            Recreate any missing symlinks in case
 *                            electron-builder did not preserve them.
 * 5. show loading window     file:// → electron/loading.html
 * 6. startServer()           set all env-vars, then dynamically import compiled
 *                            server so it starts inside Electron's own Node.js
 * 7. waitForServer()         poll until Express responds
 * 8. checkFirstRun()         if no .gguf files in MODELS_DIR, offer to download
 * 9. open main window        http://127.0.0.1:PORT
 */

import { app, BrowserWindow, dialog, shell } from 'electron';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import fs from 'fs';
import https from 'https';
import http from 'http';
import { URL as NodeURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Constants ────────────────────────────────────────────────────────────────

const SERVER_PORT  = parseInt(process.env.PORT ?? '3001', 10);
const isPackaged   = app.isPackaged;
const appRoot      = app.getAppPath();

// User-writable directories (never inside asar)
const userDataPath = app.getPath('userData');
const musicPath    = app.getPath('music');
const MODELS_DIR   = path.join(userDataPath, 'models');
const AUDIO_DIR    = path.join(musicPath, 'ACEStep');
const DATA_DIR     = path.join(userDataPath, 'data');
const LOGS_DIR     = path.join(userDataPath, 'logs');

// Precompiled binaries land in extraResources → <resourcesPath>/bin/
// In dev mode we fall back to <projectRoot>/bin/
const binExt = process.platform === 'win32' ? '.exe' : '';
const BIN_DIR = isPackaged
  ? path.join(process.resourcesPath, 'bin')
  : path.join(appRoot, 'bin');

// Default model set — matches models.sh "Q8_0 essential" defaults
const HF_BASE = 'https://huggingface.co/Serveurperso/ACE-Step-1.5-GGUF/resolve/main';
const DEFAULT_MODELS = [
  { filename: 'vae-BF16.gguf',                      label: 'VAE (BF16)' },
  { filename: 'Qwen3-Embedding-0.6B-Q8_0.gguf',     label: 'Text Encoder Q8_0' },
  { filename: 'acestep-5Hz-lm-4B-Q8_0.gguf',        label: 'Language Model 4B Q8_0' },
  { filename: 'acestep-v15-turbo-Q8_0.gguf',        label: 'DiT Turbo Q8_0' },
];

// ── Window handles ────────────────────────────────────────────────────────────

let mainWindow    = null;
let loadingWindow = null;
let serverLogStream = null;

// ── Directory helpers ────────────────────────────────────────────────────────

function ensureDirs () {
  for (const dir of [MODELS_DIR, AUDIO_DIR, DATA_DIR, LOGS_DIR]) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  }
}

// ── Library-path setup ───────────────────────────────────────────────────────

/**
 * Prepend BIN_DIR to the platform's dynamic-library search path so that the
 * ace-qwen3 / dit-vae child processes find their bundled shared libraries.
 *
 * Linux: The ELFs have a hardcoded RUNPATH pointing to the CI build tree
 *   (/home/runner/work/…) which never exists on user machines.
 *   LD_LIBRARY_PATH overrides the RUNPATH and is inherited by every child
 *   process spawned by the Express server.
 *
 * macOS: The release archive ships versioned dylibs (libggml.0.9.7.dylib,
 *   libggml-base.0.9.7.dylib, libggml-metal.0.9.7.dylib, etc.) alongside
 *   the binaries.  The dyld linker checks DYLD_LIBRARY_PATH before the
 *   embedded @rpath or install-name path, so setting it to BIN_DIR ensures
 *   the bundled libraries are found regardless of what paths were baked in
 *   at compile time.  DYLD_FALLBACK_LIBRARY_PATH is set as an additional
 *   safety net for transitive dylib-to-dylib dependencies.
 */
function setupLibraryPaths () {
  if (!fs.existsSync(BIN_DIR)) return;

  if (process.platform === 'linux') {
    const prev = process.env.LD_LIBRARY_PATH || '';
    process.env.LD_LIBRARY_PATH = prev ? `${BIN_DIR}:${prev}` : BIN_DIR;
  } else if (process.platform === 'darwin') {
    const prev = process.env.DYLD_LIBRARY_PATH || '';
    process.env.DYLD_LIBRARY_PATH = prev ? `${BIN_DIR}:${prev}` : BIN_DIR;
    // Also set DYLD_FALLBACK_LIBRARY_PATH as an extra safety net
    const prev2 = process.env.DYLD_FALLBACK_LIBRARY_PATH || '';
    process.env.DYLD_FALLBACK_LIBRARY_PATH = prev2 ? `${BIN_DIR}:${prev2}` : BIN_DIR;
  }
}

/**
 * The Linux binary archive ships `libggml.so` / `libggml-base.so` but the
 * ELFs link against the versioned sonames `libggml.so.0` / `libggml-base.so.0`.
 * Create symlinks at runtime so the dynamic linker can resolve them.
 * (The CI workflow also creates these symlinks before packaging, but we do it
 * here too as a robust fallback — e.g. when running in dev mode.)
 */
function fixSonameLinks () {
  if (process.platform !== 'linux') return;
  const pairs = [
    ['libggml.so',      'libggml.so.0'],
    ['libggml-base.so', 'libggml-base.so.0'],
  ];
  for (const [real, soname] of pairs) {
    const realPath   = path.join(BIN_DIR, real);
    const sonamePath = path.join(BIN_DIR, soname);
    if (fs.existsSync(realPath) && !fs.existsSync(sonamePath)) {
      try { fs.symlinkSync(real, sonamePath); } catch (_) {}
    }
  }
}

/**
 * The macOS binary archive ships real versioned dylibs (e.g. libggml.0.9.7.dylib)
 * plus a two-level symlink chain:
 *   libggml.dylib → libggml.0.dylib → libggml.0.9.7.dylib
 *
 * electron-builder may not preserve symlinks when collecting extraResources.
 * This function recreates any missing alias links so the dynamic linker can
 * find the libraries regardless of which name the binary references.
 *
 * It is safe to call on every launch — existing symlinks are left untouched.
 */
function fixMacosDylibLinks () {
  if (process.platform !== 'darwin') return;
  let files;
  try { files = fs.readdirSync(BIN_DIR); } catch (_) { return; }

  // Match versioned dylibs: libX.MAJOR.MINOR.PATCH.dylib
  const verRe = /^(.+)\.(\d+)\.(\d+)\.(\d+)\.dylib$/;
  for (const f of files) {
    const match = f.match(verRe);
    if (!match) continue;
    const [, baseName, majorVersion] = match;
    // e.g. baseName="libggml-metal", majorVersion="0"
    const majorAlias  = `${baseName}.${majorVersion}.dylib`;  // libggml-metal.0.dylib
    const simpleAlias = `${baseName}.dylib`;                  // libggml-metal.dylib

    const majorPath  = path.join(BIN_DIR, majorAlias);
    const simplePath = path.join(BIN_DIR, simpleAlias);

    // major alias → versioned real file
    if (!fs.existsSync(majorPath))  try { fs.symlinkSync(f, majorPath);          } catch (_) {}
    // simple alias → major alias (two-step chain matches the macOS convention)
    if (!fs.existsSync(simplePath)) try { fs.symlinkSync(majorAlias, simplePath); } catch (_) {}
  }
}

// ── Server startup ───────────────────────────────────────────────────────────

/**
 * Set all environment variables that the Express server reads at import time,
 * then dynamically import the compiled server entry point.
 *
 * dotenv inside the server only fills variables that are *not already set*, so
 * our values here always take precedence over any .env file.
 */
async function startServer () {
  process.env.PORT            = String(SERVER_PORT);
  process.env.NODE_ENV        = 'production';
  process.env.MODELS_DIR      = MODELS_DIR;
  process.env.AUDIO_DIR       = AUDIO_DIR;
  process.env.DATABASE_PATH   = path.join(DATA_DIR, 'acestep.db');
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'ace-step-ui-electron-local-secret';
  }

  const aceQwen3 = path.join(BIN_DIR, `ace-qwen3${binExt}`);
  const ditVae   = path.join(BIN_DIR, `dit-vae${binExt}`);
  if (fs.existsSync(aceQwen3)) process.env.ACE_QWEN3_BIN = aceQwen3;
  if (fs.existsSync(ditVae))   process.env.DIT_VAE_BIN   = ditVae;

  // In packaged mode redirect server stdout/stderr to a persistent log file
  if (isPackaged) {
    const logPath = path.join(LOGS_DIR, 'server.log');
    serverLogStream = fs.createWriteStream(logPath, { flags: 'a' });
    for (const name of ['stdout', 'stderr']) {
      const orig = process[name].write.bind(process[name]);
      process[name].write = (chunk, enc, cb) => {
        serverLogStream.write(chunk);
        return orig(chunk, enc, cb);
      };
    }
  }

  const serverEntry = pathToFileURL(
    path.join(appRoot, 'server', 'dist', 'index.js'),
  ).href;

  try {
    await import(serverEntry);
  } catch (err) {
    console.error('[Electron] Failed to start embedded server:', err);
  }
}

/** Poll until the Express server accepts connections, then resolve. */
function waitForServer (maxTries = 60, intervalMs = 500) {
  return new Promise((resolve) => {
    let tries = 0;
    const attempt = () => {
      const req = http.get(`http://127.0.0.1:${SERVER_PORT}/`, (res) => {
        res.resume();
        resolve();
      });
      req.setTimeout(400, () => req.destroy());
      req.on('error', () => {
        if (++tries < maxTries) setTimeout(attempt, intervalMs);
        else resolve();
      });
    };
    attempt();
  });
}

// ── Loading window ────────────────────────────────────────────────────────────

function createLoadingWindow () {
  loadingWindow = new BrowserWindow({
    width: 480,
    height: 320,
    resizable: false,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    title: 'ACE-Step UI — Starting',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  loadingWindow.loadFile(path.join(__dirname, 'loading.html'));
  loadingWindow.on('closed', () => { loadingWindow = null; });
}

function sendStatus (msg, pct = -1, label = '') {
  if (loadingWindow && !loadingWindow.isDestroyed()) {
    loadingWindow.webContents.send('setup:status', { msg, pct, label });
  }
}

// ── Model download ────────────────────────────────────────────────────────────

function hasModels () {
  try {
    return fs.readdirSync(MODELS_DIR).some(f => f.endsWith('.gguf') && !f.endsWith('.part'));
  } catch { return false; }
}

/**
 * Download a single file from `url` to `destPath`, following HTTP redirects.
 * Calls `progressCb(downloaded, total)` as data arrives.
 * Writes to `destPath + '.part'` and renames atomically on success.
 */
function downloadFile (url, destPath, progressCb, maxRedirects = 15) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects'));

    const parsed  = new NodeURL(url);
    const getter  = parsed.protocol === 'https:' ? https : http;

    const req = getter.get(url, { headers: { 'User-Agent': 'ACEStepUI-Electron/1.0' } }, (res) => {
      // Follow redirects (HuggingFace → CDN is a common pattern)
      if (res.statusCode >= 301 && res.statusCode <= 308 && res.headers.location) {
        res.resume();
        const next = new NodeURL(res.headers.location, url).href;
        return downloadFile(next, destPath, progressCb, maxRedirects - 1)
          .then(resolve, reject);
      }

      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
      }

      const total    = parseInt(res.headers['content-length'] ?? '0', 10);
      let downloaded = 0;
      const tmpPath  = `${destPath}.part`;
      const out      = fs.createWriteStream(tmpPath);

      res.on('data', (chunk) => {
        downloaded += chunk.length;
        if (total > 0 && progressCb) progressCb(downloaded, total);
      });

      res.pipe(out);

      out.on('finish', () =>
        out.close(() =>
          fs.rename(tmpPath, destPath, (err) => {
            if (err) { try { fs.unlinkSync(tmpPath); } catch (_) {} reject(err); }
            else resolve();
          })
        )
      );
      out.on('error', (err) => {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        reject(err);
      });
    });

    req.on('error', reject);
  });
}

function fmtBytes (bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/**
 * Download all DEFAULT_MODELS into MODELS_DIR, skipping files that are
 * already present and complete (> 1 MB).
 */
async function downloadModels () {
  fs.mkdirSync(MODELS_DIR, { recursive: true });

  for (let i = 0; i < DEFAULT_MODELS.length; i++) {
    const { filename, label } = DEFAULT_MODELS[i];
    const destPath = path.join(MODELS_DIR, filename);

    // Skip if already downloaded (> 1 MB = not a truncated/partial file)
    try {
      if (fs.statSync(destPath).size > 1_048_576) {
        sendStatus(
          `Skipping ${label} (already downloaded)`,
          Math.round(((i + 1) / DEFAULT_MODELS.length) * 100),
        );
        continue;
      }
    } catch (_) { /* file doesn't exist */ }

    sendStatus(`Downloading ${label}… (${i + 1}/${DEFAULT_MODELS.length})`, -1, '');

    try {
      await downloadFile(
        `${HF_BASE}/${filename}`,
        destPath,
        (dl, total) => {
          const pct = Math.round((dl / total) * 100);
          const fileProgress = Math.round(
            ((i + (dl / total)) / DEFAULT_MODELS.length) * 100,
          );
          sendStatus(
            `Downloading ${label}… (${i + 1}/${DEFAULT_MODELS.length})`,
            fileProgress,
            `${fmtBytes(dl)} / ${fmtBytes(total)}  (${pct}%)`,
          );
        },
      );
    } catch (err) {
      console.error(`[Electron] Failed to download ${filename}:`, err.message);
      sendStatus(`Error downloading ${label}: ${err.message}`, -1, '');
      // Continue with remaining models rather than aborting the whole setup
    }
  }
}

// ── First-run check ───────────────────────────────────────────────────────────

async function checkFirstRun () {
  if (hasModels()) return; // all good

  sendStatus('No GGUF models found in your models directory.');

  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Download now (~8 GB)', 'Skip — I\'ll add models manually'],
    defaultId: 0,
    cancelId: 1,
    title: 'ACE-Step — First Run Setup',
    message: 'ACE-Step models not found',
    detail:
      `No .gguf model files were found in:\n${MODELS_DIR}\n\n` +
      'Would you like to download the default Q8_0 set (~8 GB) from ' +
      'HuggingFace now? This only needs to happen once.\n\n' +
      'If you already have models elsewhere, choose "Skip" and set ' +
      'MODELS_DIR in the app settings.',
  });

  if (response === 0) {
    sendStatus('Starting model downloads…', 0, '');
    await downloadModels();
    sendStatus('Models ready!', 100, '');
    await new Promise(r => setTimeout(r, 800)); // brief pause so user sees "ready"
  }
}

// ── Main window ───────────────────────────────────────────────────────────────

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'ACE-Step UI',
    show: false, // reveal after content loads to avoid flash
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${SERVER_PORT}`);

  mainWindow.once('ready-to-show', () => {
    if (loadingWindow && !loadingWindow.isDestroyed()) {
      loadingWindow.close();
    }
    mainWindow.show();
  });

  // Open <a target="_blank"> links in the default system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  ensureDirs();
  setupLibraryPaths();
  fixSonameLinks();
  fixMacosDylibLinks();

  createLoadingWindow();

  sendStatus('Starting server…');
  await startServer();

  sendStatus('Waiting for server…');
  await waitForServer();

  sendStatus('Checking models…');
  await checkFirstRun();

  sendStatus('Opening app…', 100, '');
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverLogStream) {
    serverLogStream.end();
    serverLogStream = null;
  }
});
