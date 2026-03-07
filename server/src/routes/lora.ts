/**
 * LoRA inference routes
 *
 * In spawn mode the LoRA adapter path and scale are stored in memory and
 * injected as CLI arguments on every `acestep-generate` invocation.
 *
 * In HTTP mode the same state is forwarded as JSON fields to the remote
 * acestep-cpp server on each /v1/generate call, and mirrored to the
 * server's own /v1/lora/* endpoints for persistence.
 */

import { Router, Response } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { loraState } from '../services/acestep.js';
import { config } from '../config/index.js';

const router = Router();

// Helper: forward LoRA command to the HTTP server (HTTP mode only)
async function syncHttpServer(endpoint: string, body?: Record<string, unknown>): Promise<void> {
  if (config.acestep.lmBin && config.acestep.ditVaeBin) return; // spawn mode — nothing to forward
  try {
    await fetch(`${config.acestep.apiUrl}/v1/lora/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // Best-effort; local state is always the source of truth
  }
}

// POST /api/lora/load
router.post('/load', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { lora_path } = req.body;
  if (!lora_path || typeof lora_path !== 'string') {
    res.status(400).json({ error: 'lora_path is required' });
    return;
  }

  loraState.loaded = true;
  loraState.active = true;
  loraState.path   = lora_path;

  await syncHttpServer('load', { lora_path });

  res.json({ message: 'LoRA loaded', lora_path, loaded: true });
});

// POST /api/lora/unload
router.post('/unload', authMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  loraState.loaded = false;
  loraState.active = false;
  loraState.path   = '';
  loraState.scale  = 1.0;

  await syncHttpServer('unload');

  res.json({ message: 'LoRA unloaded' });
});

// POST /api/lora/scale
router.post('/scale', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { scale } = req.body;
  if (typeof scale !== 'number' || scale < 0 || scale > 1) {
    res.status(400).json({ error: 'scale must be a number between 0 and 1' });
    return;
  }

  loraState.scale = scale;
  await syncHttpServer('scale', { scale });

  res.json({ message: 'LoRA scale updated', scale });
});

// POST /api/lora/toggle
router.post('/toggle', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { enabled } = req.body;
  const useLoRA = typeof enabled === 'boolean' ? enabled : !loraState.active;

  loraState.active = useLoRA;
  await syncHttpServer('toggle', { enabled: useLoRA });

  res.json({ message: `LoRA ${useLoRA ? 'enabled' : 'disabled'}`, active: useLoRA });
});

// GET /api/lora/status
router.get('/status', authMiddleware, (_req: AuthenticatedRequest, res: Response) => {
  res.json({ ...loraState });
});

export default router;
