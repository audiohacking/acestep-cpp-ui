/**
 * Model management routes
 *
 * GET  /api/models/catalog          — full list of downloadable GGUF files
 * GET  /api/models/status           — which files exist on disk + active model
 * POST /api/models/download         — enqueue a file download
 * GET  /api/models/download/stream  — SSE stream for download progress
 * POST /api/models/active           — change the runtime active model
 */

import { Router, Response } from 'express';
import { existsSync, mkdirSync, statSync, createWriteStream, unlinkSync } from 'fs';
import { readdir } from 'fs/promises';
import path from 'path';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { config } from '../config/index.js';

const router = Router();

// ── Catalog ──────────────────────────────────────────────────────────────────

const HF_REPO = 'Serveurperso/ACE-Step-1.5-GGUF';
const HF_BASE = `https://huggingface.co/${HF_REPO}/resolve/main`;

// Quant availability matrix — matches upstream quantize.sh
const QUANTS_EMB     = ['BF16', 'Q8_0'] as const;
const QUANTS_LM_4B   = ['BF16', 'Q5_K_M', 'Q6_K', 'Q8_0'] as const;
const QUANTS_LM_SMALL= ['BF16', 'Q8_0'] as const;
const QUANTS_DIT     = ['BF16', 'Q4_K_M', 'Q5_K_M', 'Q6_K', 'Q8_0'] as const;

interface ModelFile {
  filename: string;
  label: string;
  group: 'vae' | 'encoder' | 'lm' | 'dit';
  quant: string;
  variant?: string;
  essential: boolean;    // part of the default Q8_0 turbo set
  approxSizeMB: number;
}

function buildCatalog(): ModelFile[] {
  const files: ModelFile[] = [];

  // VAE (always BF16, always essential)
  files.push({ filename: 'vae-BF16.gguf',       label: 'VAE (BF16)',            group: 'vae',     quant: 'BF16',   essential: true,  approxSizeMB: 320 });

  // Text encoder
  for (const q of QUANTS_EMB) {
    files.push({ filename: `Qwen3-Embedding-0.6B-${q}.gguf`, label: `Text Encoder 0.6B (${q})`, group: 'encoder', quant: q, essential: q === 'Q8_0', approxSizeMB: q === 'BF16' ? 1400 : 700 });
  }

  // LMs
  for (const q of QUANTS_LM_SMALL) {
    files.push({ filename: `acestep-5Hz-lm-0.6B-${q}.gguf`, label: `LM 0.6B (${q})`, group: 'lm', quant: q, variant: '0.6B', essential: false, approxSizeMB: q === 'BF16' ? 1400 : 700 });
    files.push({ filename: `acestep-5Hz-lm-1.7B-${q}.gguf`, label: `LM 1.7B (${q})`, group: 'lm', quant: q, variant: '1.7B', essential: false, approxSizeMB: q === 'BF16' ? 3600 : 1800 });
  }
  for (const q of QUANTS_LM_4B) {
    files.push({ filename: `acestep-5Hz-lm-4B-${q}.gguf`,   label: `LM 4B (${q})`,   group: 'lm', quant: q, variant: '4B',   essential: q === 'Q8_0', approxSizeMB: q === 'BF16' ? 8500 : q === 'Q8_0' ? 4800 : q === 'Q6_K' ? 3600 : 2800 });
  }

  // DiT variants
  const ditVariants: Array<{ key: string; label: string; essential: boolean }> = [
    { key: 'turbo',            label: 'Turbo',           essential: true  },
    { key: 'sft',              label: 'SFT',             essential: false },
    { key: 'base',             label: 'Base',            essential: false },
    { key: 'turbo-shift1',     label: 'Turbo Shift-1',   essential: false },
    { key: 'turbo-shift3',     label: 'Turbo Shift-3',   essential: false },
    { key: 'turbo-continuous', label: 'Turbo Continuous',essential: false },
    { key: 'xl-turbo',         label: 'XL Turbo',        essential: false },
    { key: 'xl-sft',           label: 'XL SFT',          essential: false },
    { key: 'xl-sftturbo50',    label: 'XL SFT/Turbo 50/50', essential: false },
    { key: 'xl-base',          label: 'XL Base',         essential: false },
  ];
  
  for (const v of ditVariants) {
    for (const q of QUANTS_DIT) {
      files.push({
        filename: `acestep-v15-${v.key}-${q}.gguf`,
        label: `DiT ${v.label} (${q})`,
        group: 'dit',
        quant: q,
        variant: v.key,
        essential: v.essential && q === 'Q8_0',
        approxSizeMB: v.key.startsWith('xl')
          ? (q === 'BF16' ? 10000 : q === 'Q8_0' ? 5500 : q === 'Q6_K' ? 4100 : q === 'Q5_K_M' ? 3500 : 3000)
          : (q === 'BF16' ? 5200 : q === 'Q8_0' ? 2900 : q === 'Q6_K' ? 2200 : q === 'Q5_K_M' ? 1800 : 1500),
      });
    }
  }

  return files;
}

const CATALOG = buildCatalog();

// ── Download queue / SSE ──────────────────────────────────────────────────────

interface DownloadJob {
  id: string;
  filename: string;
  status: 'queued' | 'downloading' | 'done' | 'error';
  downloadedBytes: number;
  totalBytes: number;
  error?: string;
}

const downloadQueue: DownloadJob[] = [];
const sseClients = new Set<Response>();
let isDownloading = false;

function broadcast(event: string, data: unknown) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(msg); } catch { sseClients.delete(client); }
  }
}

function modelsDir(): string {
  return config.models.dir;
}

function destPath(filename: string): string {
  return path.join(modelsDir(), filename);
}

// Resolve quant to next available when the requested one doesn't exist for the type
function resolveQuant(requested: string, type: 'emb' | 'lm_small' | 'lm_4B' | 'dit'): string {
  if (type === 'emb' || type === 'lm_small') {
    // Only BF16 and Q8_0 are available for embedding/small LM
    return QUANTS_EMB.includes(requested as typeof QUANTS_EMB[number]) ? requested : 'Q8_0';
  }
  if (type === 'lm_4B') {
    // Q4_K_M breaks audio codes — promote to Q5_K_M
    if (!QUANTS_LM_4B.includes(requested as typeof QUANTS_LM_4B[number])) return 'Q8_0';
    return requested === 'Q4_K_M' ? 'Q5_K_M' : requested;
  }
  // dit: all quants available
  return QUANTS_DIT.includes(requested as typeof QUANTS_DIT[number]) ? requested : 'Q8_0';
}

async function downloadFile(job: DownloadJob): Promise<void> {
  const filePath = destPath(job.filename);
  const tmpPath = `${filePath}.part`;
  const url = `${HF_BASE}/${job.filename}`;
  const hfToken = process.env.HF_TOKEN || '';

  job.status = 'downloading';
  broadcast('progress', { ...job });

  try {
    const headers: Record<string, string> = {};
    if (hfToken) headers['Authorization'] = `Bearer ${hfToken}`;

    // @ts-ignore — using native fetch (Node 20+)
    const fetchResponse = await fetch(url, { headers });
    if (!fetchResponse.ok) {
      throw new Error(`HTTP ${fetchResponse.status}: ${fetchResponse.statusText}`);
    }

    const contentLength = fetchResponse.headers.get('content-length');
    job.totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

    mkdirSync(modelsDir(), { recursive: true });
    const writer = createWriteStream(tmpPath);

    // Stream the download, tracking bytes
    const reader = fetchResponse.body!.getReader();
    let lastBroadcast = Date.now();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      writer.write(Buffer.from(value));
      job.downloadedBytes += value.byteLength;

      // Throttle SSE broadcasts to ~4 Hz
      if (Date.now() - lastBroadcast > 250) {
        broadcast('progress', { ...job });
        lastBroadcast = Date.now();
      }
    }

    await new Promise<void>((res, rej) => {
      writer.end((err: Error | null) => (err ? rej(err) : res()));
    });

    // Atomic rename
    if (existsSync(filePath)) unlinkSync(filePath);
    const { rename } = await import('fs/promises');
    await rename(tmpPath, filePath);

    job.status = 'done';
    job.downloadedBytes = job.totalBytes || job.downloadedBytes;
    broadcast('progress', { ...job });
    broadcast('done', { filename: job.filename });
  } catch (err) {
    job.status = 'error';
    job.error = (err as Error).message;
    broadcast('progress', { ...job });
    broadcast('error', { filename: job.filename, error: job.error });
    // Clean up partial file
    try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

async function processDownloadQueue(): Promise<void> {
  if (isDownloading) return;
  isDownloading = true;

  while (true) {
    const job = downloadQueue.find(j => j.status === 'queued');
    if (!job) break;
    await downloadFile(job);
  }

  isDownloading = false;
  broadcast('queue_empty', {});
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/models/catalog
router.get('/catalog', (_req, res) => {
  res.json({ catalog: CATALOG, repo: HF_REPO });
});

// GET /api/models/status
router.get('/status', async (_req, res: Response) => {
  try {
    const dir = modelsDir();
    let onDisk: string[] = [];

    if (existsSync(dir)) {
      const entries = await readdir(dir);
      onDisk = entries
        .filter(f => f.endsWith('.gguf') && !f.endsWith('.part'))
        .map(f => f);
    }

    const diskSet = new Set(onDisk);
    const activeModel = config.acestep.ditModel ? path.basename(config.acestep.ditModel) : null;
    const queue = downloadQueue.map(j => ({ ...j }));

    res.json({
      modelsDir: dir,
      activeModel,
      onDisk,
      catalog: CATALOG.map(f => ({
        ...f,
        downloaded: diskSet.has(f.filename),
        queued: downloadQueue.some(j => j.filename === f.filename),
        active: f.filename === activeModel,
      })),
      queue,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/models/download  — body: { files: string[] }
router.post('/download', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const { files } = req.body as { files: string[] };

  if (!Array.isArray(files) || files.length === 0) {
    res.status(400).json({ error: 'files[] array is required' });
    return;
  }

  // Validate every requested filename is in the catalog
  const catalogNames = new Set(CATALOG.map(f => f.filename));
  const invalid = files.filter(f => !catalogNames.has(f));
  if (invalid.length > 0) {
    res.status(400).json({ error: `Unknown model files: ${invalid.join(', ')}` });
    return;
  }

  const enqueued: string[] = [];
  for (const filename of files) {
    const filePath = destPath(filename);

    // Skip already-downloaded files (unless explicitly re-requested)
    if (existsSync(filePath) && statSync(filePath).size > 1_048_576) continue;

    // Skip if already in queue
    if (downloadQueue.some(j => j.filename === filename)) continue;

    const job: DownloadJob = {
      id: `dl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      filename,
      status: 'queued',
      downloadedBytes: 0,
      totalBytes: 0,
    };
    downloadQueue.push(job);
    enqueued.push(filename);
  }

  // Start processing (non-blocking)
  processDownloadQueue().catch(err => console.error('[Models] Queue error:', err));

  res.json({ enqueued, queueLength: downloadQueue.filter(j => j.status === 'queued').length });
});

// GET /api/models/download/stream  — SSE progress stream
router.get('/download/stream', (req, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  sseClients.add(res);

  // Send current queue state immediately on connect
  res.write(`event: queue\ndata: ${JSON.stringify(downloadQueue)}\n\n`);

  // Heartbeat every 15 s to keep the connection alive through proxies
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { clearInterval(heartbeat); }
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// POST /api/models/active  — body: { filename: string }
// Changes the active model for subsequent generations (runtime only — not persisted to disk)
router.post('/active', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const { filename } = req.body as { filename: string };

  if (!filename || typeof filename !== 'string') {
    res.status(400).json({ error: 'filename is required' });
    return;
  }

  const fullPath = destPath(filename);
  if (!existsSync(fullPath)) {
    res.status(404).json({ error: `Model not found on disk: ${filename}` });
    return;
  }

  // Update runtime config (takes effect on the next generation)
  config.acestep.ditModel = fullPath;
  console.log(`[Models] Active model changed to: ${fullPath}`);

  res.json({ message: 'Active model updated', filename, path: fullPath });
});

export default router;
