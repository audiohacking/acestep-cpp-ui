import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // SQLite database
  database: {
    path: process.env.DATABASE_PATH || path.join(__dirname, '../../data/acestep.db'),
  },

  // acestep-cpp — two modes, checked in priority order:
  //   1. Spawn mode (preferred): set ACESTEP_BIN to the path of the
  //      acestep-generate binary. Node.js spawns it directly per job.
  //   2. HTTP mode (advanced): set ACESTEP_API_URL to a running
  //      acestep-cpp HTTP server (e.g. the built-in server of these.cpp).
  acestep: {
    // Path to the `acestep-generate` binary (spawn mode — preferred)
    bin: process.env.ACESTEP_BIN || '',
    // Path to the GGUF model file passed to --model on each invocation
    model: process.env.ACESTEP_MODEL || '',
    // Fallback HTTP server URL (used only when ACESTEP_BIN is not set)
    apiUrl: process.env.ACESTEP_API_URL || 'http://localhost:7860',
  },

  // Pexels (optional - for video backgrounds)
  pexels: {
    apiKey: process.env.PEXELS_API_KEY || '',
  },

  // Frontend URL
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',

  // Storage (local only)
  storage: {
    provider: 'local' as const,
    audioDir: process.env.AUDIO_DIR || path.join(__dirname, '../../public/audio'),
  },

  // Simplified JWT (for local session, not critical security)
  jwt: {
    secret: process.env.JWT_SECRET || 'ace-step-ui-local-secret',
    expiresIn: '365d', // Long-lived for local app
  },
};
