import { Router, Response } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { config } from '../config/index.js';

const router = Router();
const ACESTEP_API = config.acestep.apiUrl;

// Local LoRA state tracking
let loraState = {
  loaded: false,
  active: false,
  scale: 1.0,
  path: '',
};

// POST /api/lora/load — Load a LoRA adapter
router.post('/load', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { lora_path } = req.body;
    if (!lora_path || typeof lora_path !== 'string') {
      res.status(400).json({ error: 'lora_path is required' });
      return;
    }

    const response = await fetch(`${ACESTEP_API}/v1/lora/load`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lora_path }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => `HTTP ${response.status}`);
      throw new Error(`acestep-cpp lora load failed: ${response.status} ${errText}`);
    }

    const data = await response.json() as { message?: string };
    loraState = { loaded: true, active: true, scale: loraState.scale, path: lora_path };

    res.json({ message: data.message || 'LoRA loaded', lora_path, loaded: true });
  } catch (error) {
    console.error('[LoRA] Load error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load LoRA' });
  }
});

// POST /api/lora/unload — Unload the current LoRA adapter
router.post('/unload', authMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const response = await fetch(`${ACESTEP_API}/v1/lora/unload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => `HTTP ${response.status}`);
      throw new Error(`acestep-cpp lora unload failed: ${response.status} ${errText}`);
    }

    const data = await response.json() as { message?: string };
    loraState = { loaded: false, active: false, scale: 1.0, path: '' };

    res.json({ message: data.message || 'LoRA unloaded' });
  } catch (error) {
    console.error('[LoRA] Unload error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to unload LoRA' });
  }
});

// POST /api/lora/scale — Set LoRA scale (0.0 - 1.0)
router.post('/scale', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { scale } = req.body;
    if (typeof scale !== 'number' || scale < 0 || scale > 1) {
      res.status(400).json({ error: 'scale must be a number between 0 and 1' });
      return;
    }

    const response = await fetch(`${ACESTEP_API}/v1/lora/scale`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scale }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => `HTTP ${response.status}`);
      throw new Error(`acestep-cpp lora scale failed: ${response.status} ${errText}`);
    }

    const data = await response.json() as { message?: string };
    loraState.scale = scale;

    res.json({ message: data.message || 'LoRA scale updated', scale });
  } catch (error) {
    console.error('[LoRA] Scale error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to set LoRA scale' });
  }
});

// POST /api/lora/toggle — Toggle LoRA on/off
router.post('/toggle', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { enabled } = req.body;
    const useLoRA = typeof enabled === 'boolean' ? enabled : !loraState.active;

    const response = await fetch(`${ACESTEP_API}/v1/lora/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: useLoRA }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => `HTTP ${response.status}`);
      throw new Error(`acestep-cpp lora toggle failed: ${response.status} ${errText}`);
    }

    const data = await response.json() as { message?: string };
    loraState.active = useLoRA;

    res.json({ message: data.message || `LoRA ${useLoRA ? 'enabled' : 'disabled'}`, active: useLoRA });
  } catch (error) {
    console.error('[LoRA] Toggle error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to toggle LoRA' });
  }
});

// GET /api/lora/status — Get current LoRA state
router.get('/status', authMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  // Return cached local state; sync with backend if needed
  try {
    const response = await fetch(`${ACESTEP_API}/v1/lora/status`);
    if (response.ok) {
      const data = await response.json() as Partial<typeof loraState>;
      loraState = {
        loaded: data.loaded ?? loraState.loaded,
        active: data.active ?? loraState.active,
        scale: data.scale ?? loraState.scale,
        path: data.path ?? loraState.path,
      };
    }
  } catch {
    // If backend unavailable, return cached state
  }
  res.json(loraState);
});

export default router;
