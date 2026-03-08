import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readdirSync } from 'fs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// App root = three levels above this file in both dev and release layouts:
//   dev:     <repo>/server/src/config/ → ../../.. → <repo>/
//   release: <bundle>/server/dist/config/ → ../../.. → <bundle>/
const APP_ROOT = path.resolve(__dirname, '../../..');

// Server root = two levels above this file (always the server/ directory):
//   dev:     <repo>/server/src/config/ → ../.. → <repo>/server/
//   release: <bundle>/server/dist/config/ → ../.. → <bundle>/server/
const SERVER_ROOT = path.resolve(__dirname, '../..');

// ── Path helpers ─────────────────────────────────────────────────────────────

/**
 * Resolves a path relative to APP_ROOT when it is not already absolute.
 * This prevents relative paths from .env (e.g. `./models`) being interpreted
 * relative to the server/ working directory instead of the project root.
 */
function resolveFromRoot(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(APP_ROOT, p);
}

// ── Binary resolution ───────────────────────────────────────────────────────

/** Resolves the ace-qwen3 LLM binary path (step 1 of the pipeline). */
function resolveLmBin(): string {
  if (process.env.ACE_QWEN3_BIN) return resolveFromRoot(process.env.ACE_QWEN3_BIN);
  for (const name of ['ace-qwen3', 'ace-qwen3.exe']) {
    const p = path.join(APP_ROOT, 'bin', name);
    if (existsSync(p)) return p;
  }
  return '';
}

/** Resolves the dit-vae binary path (step 2 of the pipeline). */
function resolveDitVaeBin(): string {
  if (process.env.DIT_VAE_BIN) return resolveFromRoot(process.env.DIT_VAE_BIN);
  for (const name of ['dit-vae', 'dit-vae.exe']) {
    const p = path.join(APP_ROOT, 'bin', name);
    if (existsSync(p)) return p;
  }
  return '';
}

// ── Model resolution ─────────────────────────────────────────────────────────

/** Resolves the models directory. */
function resolveModelsDir(): string {
  if (process.env.MODELS_DIR) return resolveFromRoot(process.env.MODELS_DIR);
  return path.join(APP_ROOT, 'models');
}

/** Resolves the DiT model (acestep-v15-turbo-*.gguf). */
function resolveDitModel(modelsDir: string): string {
  if (process.env.ACESTEP_MODEL) {
    const p = resolveFromRoot(process.env.ACESTEP_MODEL);
    if (existsSync(p)) return p;
    console.warn(`[config] ACESTEP_MODEL path not found: ${p} — falling back to auto-detection`);
  }
  if (!existsSync(modelsDir)) return '';

  const preference = [
    'acestep-v15-turbo-Q8_0.gguf',
    'acestep-v15-turbo-Q6_K.gguf',
    'acestep-v15-turbo-Q5_K_M.gguf',
    'acestep-v15-turbo-Q4_K_M.gguf',
    'acestep-v15-turbo-BF16.gguf',
  ];
  for (const name of preference) {
    const p = path.join(modelsDir, name);
    if (existsSync(p)) return p;
  }

  try {
    const files = readdirSync(modelsDir).filter(f => f.endsWith('.gguf') && !f.endsWith('.part'));
    const turbo = files.find(f => f.startsWith('acestep-v15-turbo'));
    if (turbo) return path.join(modelsDir, turbo);
    const sft   = files.find(f => f.startsWith('acestep-v15'));
    if (sft)   return path.join(modelsDir, sft);
  } catch { /* ignore read errors */ }

  return '';
}

/** Resolves the causal LM model (acestep-5Hz-lm-*.gguf). */
function resolveLmModel(modelsDir: string): string {
  if (process.env.LM_MODEL) return resolveFromRoot(process.env.LM_MODEL);
  if (!existsSync(modelsDir)) return '';

  // Prefer 4B Q8_0, then smaller quantisations, then smaller LM sizes
  const preference = [
    'acestep-5Hz-lm-4B-Q8_0.gguf',
    'acestep-5Hz-lm-4B-Q6_K.gguf',
    'acestep-5Hz-lm-4B-Q5_K_M.gguf',
    'acestep-5Hz-lm-4B-BF16.gguf',
    'acestep-5Hz-lm-1.7B-Q8_0.gguf',
    'acestep-5Hz-lm-1.7B-BF16.gguf',
    'acestep-5Hz-lm-0.6B-Q8_0.gguf',
    'acestep-5Hz-lm-0.6B-BF16.gguf',
  ];
  for (const name of preference) {
    const p = path.join(modelsDir, name);
    if (existsSync(p)) return p;
  }

  try {
    const files = readdirSync(modelsDir).filter(f => f.endsWith('.gguf') && !f.endsWith('.part'));
    const lm = files.find(f => f.startsWith('acestep-5Hz-lm-'));
    if (lm) return path.join(modelsDir, lm);
  } catch { /* ignore */ }

  return '';
}

/** Resolves the text-encoder model (Qwen3-Embedding-*.gguf). */
function resolveTextEncoderModel(modelsDir: string): string {
  if (process.env.TEXT_ENCODER_MODEL) return resolveFromRoot(process.env.TEXT_ENCODER_MODEL);
  if (!existsSync(modelsDir)) return '';

  for (const name of [
    'Qwen3-Embedding-0.6B-Q8_0.gguf',
    'Qwen3-Embedding-0.6B-BF16.gguf',
  ]) {
    const p = path.join(modelsDir, name);
    if (existsSync(p)) return p;
  }

  try {
    const files = readdirSync(modelsDir).filter(f => f.endsWith('.gguf') && !f.endsWith('.part'));
    const enc = files.find(f => f.startsWith('Qwen3-Embedding'));
    if (enc) return path.join(modelsDir, enc);
  } catch { /* ignore */ }

  return '';
}

/** Resolves the VAE model (vae-BF16.gguf). */
function resolveVaeModel(modelsDir: string): string {
  if (process.env.VAE_MODEL) return resolveFromRoot(process.env.VAE_MODEL);
  if (!existsSync(modelsDir)) return '';

  for (const name of ['vae-BF16.gguf', 'vae-Q8_0.gguf']) {
    const p = path.join(modelsDir, name);
    if (existsSync(p)) return p;
  }

  try {
    const files = readdirSync(modelsDir).filter(f => f.endsWith('.gguf') && !f.endsWith('.part'));
    const vae = files.find(f => f.startsWith('vae-'));
    if (vae) return path.join(modelsDir, vae);
  } catch { /* ignore */ }

  return '';
}

// ── Resolve everything ───────────────────────────────────────────────────────

const modelsDir          = resolveModelsDir();
const resolvedLmBin      = resolveLmBin();
const resolvedDitVaeBin  = resolveDitVaeBin();
const resolvedDitModel   = resolveDitModel(modelsDir);
const resolvedLmModel    = resolveLmModel(modelsDir);
const resolvedTextEncoderModel = resolveTextEncoderModel(modelsDir);
const resolvedVaeModel   = resolveVaeModel(modelsDir);

// Log detected paths at startup
if (resolvedLmBin)             console.log(`[config] ace-qwen3:      ${resolvedLmBin}`);
else                           console.log('[config] ace-qwen3:      not found (set ACE_QWEN3_BIN)');
if (resolvedDitVaeBin)         console.log(`[config] dit-vae:        ${resolvedDitVaeBin}`);
else                           console.log('[config] dit-vae:        not found (set DIT_VAE_BIN)');
if (resolvedLmModel)           console.log(`[config] LM model:       ${resolvedLmModel}`);
else                           console.log('[config] LM model:       none (run models.sh)');
if (resolvedTextEncoderModel)  console.log(`[config] text encoder:   ${resolvedTextEncoderModel}`);
else                           console.log('[config] text encoder:   none (run models.sh)');
if (resolvedDitModel)          console.log(`[config] DiT model:      ${resolvedDitModel}`);
else                           console.log('[config] DiT model:      none (run models.sh)');
if (resolvedVaeModel)          console.log(`[config] VAE model:      ${resolvedVaeModel}`);
else                           console.log('[config] VAE model:      none (run models.sh)');

const resolvedPort = parseInt(process.env.PORT || '3001', 10);

export const config = {
  port:    resolvedPort,
  nodeEnv: process.env.NODE_ENV || 'development',

  // SQLite database
  database: {
    path: resolveFromRoot(process.env.DATABASE_PATH || path.join(APP_ROOT, 'data', 'acestep.db')),
  },

  // acestep-cpp — spawn mode uses ace-qwen3 + dit-vae directly.
  // HTTP mode fallback: calls ACESTEP_API_URL (e.g. a running acestep-cpp server).
  acestep: {
    // Two-binary spawn mode (acestep.cpp native pipeline)
    lmBin:             resolvedLmBin,
    ditVaeBin:         resolvedDitVaeBin,
    lmModel:           resolvedLmModel,
    textEncoderModel:  resolvedTextEncoderModel,
    ditModel:          resolvedDitModel,
    vaeModel:          resolvedVaeModel,

    // HTTP fallback mode
    apiUrl: process.env.ACESTEP_API_URL || 'http://localhost:7860',
  },

  // GGUF model storage
  models: {
    dir: modelsDir,
  },

  // Pexels (optional)
  pexels: { apiKey: process.env.PEXELS_API_KEY || '' },

  frontendUrl: process.env.FRONTEND_URL || `http://localhost:${resolvedPort}`,

  storage: {
    provider: 'local' as const,
    // Audio directory must match where LocalStorageProvider writes files and
    // where Express serves /audio/ from (server/src/index.ts: '../public/audio').
    // Both resolve to <server_root>/public/audio, so we use SERVER_ROOT here.
    // AUDIO_DIR env override is still supported (resolved against APP_ROOT).
    audioDir: resolveFromRoot(process.env.AUDIO_DIR || path.join(SERVER_ROOT, 'public', 'audio')),
  },

  jwt: {
    secret:    process.env.JWT_SECRET || 'ace-step-ui-local-secret',
    expiresIn: '365d',
  },
};

