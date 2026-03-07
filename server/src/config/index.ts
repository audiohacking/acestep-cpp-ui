import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readdirSync } from 'fs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// App root = two levels above server/dist/ in both dev (server/src/) and
// release bundle (server/dist/) layouts:
//   dev:     <repo>/server/src/  → ../.. → <repo>/
//   release: <bundle>/server/dist/ → ../.. → <bundle>/
const APP_ROOT = path.resolve(__dirname, '../..');

// ── Auto-detect binary ──────────────────────────────────────────────────────
function resolveBin(): string {
  if (process.env.ACESTEP_BIN) return process.env.ACESTEP_BIN;

  // Bundled binary (release layout: <app>/bin/acestep-generate)
  const bundledUnix = path.join(APP_ROOT, 'bin', 'acestep-generate');
  if (existsSync(bundledUnix)) return bundledUnix;

  const bundledWin  = path.join(APP_ROOT, 'bin', 'acestep-generate.exe');
  if (existsSync(bundledWin))  return bundledWin;

  // Not found — server will report unhealthy; user must set ACESTEP_BIN
  return '';
}

// ── Auto-detect models directory ────────────────────────────────────────────
function resolveModelsDir(): string {
  if (process.env.MODELS_DIR) return process.env.MODELS_DIR;
  // Default: <app>/models (works for both dev and release layout)
  return path.join(APP_ROOT, 'models');
}

// ── Auto-detect active model ─────────────────────────────────────────────────
// Scans modelsDir for the best available DiT model in preference order.
// Users can always override by setting ACESTEP_MODEL.
function resolveModel(modelsDir: string): string {
  if (process.env.ACESTEP_MODEL) return process.env.ACESTEP_MODEL;

  if (!existsSync(modelsDir)) return '';

  // Ordered preference list — Q8_0 turbo first, then lower quants, then variants
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

  // Any turbo variant, then any sft/base, then any .gguf
  try {
    const files = readdirSync(modelsDir).filter(f => f.endsWith('.gguf') && !f.endsWith('.part'));
    const turbo = files.find(f => f.startsWith('acestep-v15-turbo'));
    if (turbo) return path.join(modelsDir, turbo);
    const sft   = files.find(f => f.startsWith('acestep-v15'));
    if (sft)   return path.join(modelsDir, sft);
    if (files[0]) return path.join(modelsDir, files[0]);
  } catch { /* ignore read errors */ }

  return '';
}

const modelsDir = resolveModelsDir();
const resolvedBin = resolveBin();
const resolvedModel = resolveModel(modelsDir);

if (resolvedBin)   console.log(`[config] acestep-generate: ${resolvedBin}`);
else               console.log('[config] acestep-generate: not found (set ACESTEP_BIN)');
if (resolvedModel) console.log(`[config] active model:     ${resolvedModel}`);
else               console.log('[config] active model:     none (run models.sh or use Models tab)');

export const config = {
  port:    parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // SQLite database
  database: {
    path: process.env.DATABASE_PATH || path.join(APP_ROOT, 'data', 'acestep.db'),
  },

  // acestep-cpp — spawn mode (preferred) or HTTP mode fallback.
  // Both bin and model are auto-detected from the bundle layout; env vars
  // are overrides for users who want a custom binary or model.
  acestep: {
    bin:    resolvedBin,    // mutable — POST /api/models/active can change model
    model:  resolvedModel,  // mutable at runtime
    apiUrl: process.env.ACESTEP_API_URL || 'http://localhost:7860',
  },

  // GGUF model storage
  models: {
    dir: modelsDir,
  },

  // Pexels (optional)
  pexels: { apiKey: process.env.PEXELS_API_KEY || '' },

  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',

  storage: {
    provider: 'local' as const,
    audioDir: process.env.AUDIO_DIR || path.join(APP_ROOT, 'public', 'audio'),
  },

  jwt: {
    secret:    process.env.JWT_SECRET || 'ace-step-ui-local-secret',
    expiresIn: '365d',
  },
};
