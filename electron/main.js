/**
 * Electron main process — ACE-Step UI desktop shell
 *
 * Responsibilities:
 *  1. Set environment variables so the embedded Express server uses
 *     platform-appropriate user-writable directories.
 *  2. Dynamically import the compiled server (server/dist/index.js) so it
 *     starts listening on localhost inside the same Node.js process that
 *     Electron provides.
 *  3. Poll until the server responds, then open a BrowserWindow that loads
 *     the React SPA served by the Express app.
 *
 * Constraints honoured:
 *  - No files inside server/, components/, context/, services/, data/,
 *    i18n/, or audiomass-editor/ are modified.
 *  - vite.config.ts, tailwind.config.ts, tsconfig.json, and existing shell
 *    scripts are untouched.
 *  - The Node server remains launchable standalone via `cd server && npm run dev`.
 *  - All new Electron code lives exclusively under electron/.
 */

import { app, BrowserWindow, shell } from 'electron';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import fs from 'fs';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER_PORT = parseInt(process.env.PORT ?? '3001', 10);
let mainWindow = null;
let serverLogStream = null;

const isPackaged = app.isPackaged;

/**
 * `app.getAppPath()` returns:
 *   - dev  : the project root directory
 *   - prod : the path to app.asar (or the extracted app directory)
 */
const appRoot = app.getAppPath();

// ── User-writable directories (never inside asar) ──────────────────────────
const userDataPath = app.getPath('userData');
const musicPath = app.getPath('music');

const MODELS_DIR = path.join(userDataPath, 'models');
const AUDIO_DIR = path.join(musicPath, 'ACEStep');
const DATA_DIR = path.join(userDataPath, 'data');
const LOGS_DIR = path.join(userDataPath, 'logs');

// ── Precompiled acestep.cpp binaries ───────────────────────────────────────
// In the packaged app these live in <resourcesPath>/bin/ (extraResources).
// In dev mode they are expected at <projectRoot>/bin/.
const binExt = process.platform === 'win32' ? '.exe' : '';
const BIN_DIR = isPackaged
  ? path.join(process.resourcesPath, 'bin')
  : path.join(appRoot, 'bin');

// ── Helpers ─────────────────────────────────────────────────────────────────

function ensureDirs() {
  for (const dir of [MODELS_DIR, AUDIO_DIR, DATA_DIR, LOGS_DIR]) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* exists or unwritable */ }
  }
}

/**
 * Configure environment variables, then dynamically import the compiled
 * Express server so it starts listening.  The server reads env vars at
 * import time (dotenv only fills variables that are *not* already set),
 * so we must assign them *before* the import.
 */
async function startServer() {
  process.env.PORT = String(SERVER_PORT);
  process.env.NODE_ENV = 'production';
  process.env.MODELS_DIR = MODELS_DIR;
  process.env.AUDIO_DIR = AUDIO_DIR;
  process.env.DATABASE_PATH = path.join(DATA_DIR, 'acestep.db');
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'ace-step-ui-electron-local-secret';
  }

  // Wire up binary paths if the binaries are present
  const aceQwen3 = path.join(BIN_DIR, `ace-qwen3${binExt}`);
  const ditVae = path.join(BIN_DIR, `dit-vae${binExt}`);
  if (fs.existsSync(aceQwen3)) process.env.ACE_QWEN3_BIN = aceQwen3;
  if (fs.existsSync(ditVae)) process.env.DIT_VAE_BIN = ditVae;

  // Redirect server output to a log file when running as a packaged app
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

  // pathToFileURL correctly handles Windows back-slashes and asar paths
  const serverEntry = pathToFileURL(
    path.join(appRoot, 'server', 'dist', 'index.js'),
  ).href;

  try {
    await import(serverEntry);
  } catch (err) {
    console.error('[Electron] Failed to start embedded server:', err);
  }
}

/**
 * Poll until the server responds on localhost, then resolve.
 * Gives up after maxTries and resolves anyway so Electron still opens.
 */
function waitForServer(maxTries = 40, intervalMs = 500) {
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
        else resolve(); // give up — let Electron load the URL anyway
      });
    };
    attempt();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'ACE-Step UI',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${SERVER_PORT}`);

  // Open <a target="_blank"> links in the default system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  ensureDirs();
  await startServer();
  await waitForServer();
  createWindow();

  // macOS: re-create the window when the dock icon is clicked with no windows open
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // On macOS, keep the app alive in the dock until the user explicitly quits
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  // Flush and close the server log stream to prevent incomplete writes
  if (serverLogStream) {
    serverLogStream.end();
    serverLogStream = null;
  }
});
