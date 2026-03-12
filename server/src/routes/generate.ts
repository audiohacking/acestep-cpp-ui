import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { spawn } from 'child_process';
import rateLimit from 'express-rate-limit';
import { pool } from '../db/pool.js';
import { generateUUID } from '../db/sqlite.js';
import { config } from '../config/index.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import {
  generateMusicViaAPI,
  getJobStatus,
  getAudioStream,
  discoverEndpoints,
  checkSpaceHealth,
  cleanupJob,
  getJobRawResponse,
  downloadAudioToBuffer,
  getJobLogs,
  listActiveJobs,
} from '../services/acestep.js';
import { getStorageProvider } from '../services/storage/factory.js';

// Rate limiter for the debug log polling endpoints (read-only, lightweight)
const logRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 120, // 2 req/s sustained — enough for 1.5s poll intervals
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many log requests — please slow down polling' },
});

const router = Router();

// Auto-generate a song title from lyrics or style when none is provided
function autoTitle(params: { title?: string; lyrics?: string; instrumental?: boolean; style?: string; songDescription?: string; taskType?: string; trackName?: string; sourceAudioTitle?: string }): string {
  if (params.title?.trim()) return params.title.trim();

  // For lego mode: combine source audio name + instrument to make a descriptive title
  if (params.taskType === 'lego' && params.trackName) {
    const base = params.sourceAudioTitle
      ? params.sourceAudioTitle.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()
      : 'track';
    return `${base} — ${params.trackName}`;
  }

  // Try first meaningful lyric line (skip section markers like [verse], [chorus])
  if (!params.instrumental && params.lyrics) {
    for (const line of params.lyrics.split('\n')) {
      const t = line.trim();
      if (t && !/^\[.*\]$/.test(t)) {
        return t.length > 40 ? t.slice(0, 40).trimEnd() + '…' : t;
      }
    }
  }

  // Fall back to first 4 words of style or description
  const source = params.style || params.songDescription || '';
  if (source) {
    const words = source.trim().split(/\s+/).slice(0, 4).join(' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  return 'Untitled';
}

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
  fileFilter: (_req, file, cb) => {
    const allowedTypes = [
      'audio/mpeg',
      'audio/mp3', // Alternative MIME type for MP3
      'audio/mpeg3',
      'audio/x-mpeg-3',
      'audio/wav',
      'audio/x-wav',
      'audio/flac',
      'audio/x-flac',
      'audio/mp4',
      'audio/x-m4a',
      'audio/aac',
      'audio/ogg',
      'audio/webm',
      'video/mp4',
    ];

    // Also check file extension as fallback
    const allowedExtensions = ['.mp3', '.wav', '.flac', '.m4a', '.mp4', '.aac', '.ogg', '.webm', '.opus'];
    const fileExt = file.originalname.toLowerCase().match(/\.[^.]+$/)?.[0];

    if (allowedTypes.includes(file.mimetype) || (fileExt && allowedExtensions.includes(fileExt))) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Only common audio formats are allowed. Received: ${file.mimetype} (${file.originalname})`));
    }
  }
});

interface GenerateBody {
  // Mode (kept for backward compatibility; unified mode always uses full-featured panel)
  customMode?: boolean;

  // Simple Mode
  songDescription?: string;

  // Custom Mode
  lyrics: string;
  style: string;
  title: string;

  // Common
  instrumental: boolean;
  vocalLanguage?: string;

  // Music Parameters
  duration?: number;
  bpm?: number;
  keyScale?: string;
  timeSignature?: string;

  // Generation Settings
  inferenceSteps?: number;
  guidanceScale?: number;
  batchSize?: number;
  randomSeed?: boolean;
  seed?: number;
  thinking?: boolean;
  audioFormat?: 'mp3' | 'flac';
  inferMethod?: 'ode' | 'sde';
  shift?: number;

  // LM Parameters
  lmTemperature?: number;
  lmCfgScale?: number;
  lmTopK?: number;
  lmTopP?: number;
  lmNegativePrompt?: string;
  lmBackend?: 'pt' | 'vllm';
  lmModel?: string;

  // Expert Parameters
  referenceAudioUrl?: string;
  sourceAudioUrl?: string;
  referenceAudioTitle?: string;
  sourceAudioTitle?: string;
  audioCodes?: string;
  repaintingStart?: number;
  repaintingEnd?: number;
  instruction?: string;
  audioCoverStrength?: number;
  taskType?: string;
  useAdg?: boolean;
  cfgIntervalStart?: number;
  cfgIntervalEnd?: number;
  customTimesteps?: string;
  useCotMetas?: boolean;
  useCotCaption?: boolean;
  useCotLanguage?: boolean;
  autogen?: boolean;
  constrainedDecodingDebug?: boolean;
  allowLmBatch?: boolean;
  getScores?: boolean;
  getLrc?: boolean;
  scoreScale?: number;
  lmBatchChunkSize?: number;
  trackName?: string;
  completeTrackClasses?: string[];
  isFormatCaption?: boolean;

  // Model selection
  ditModel?: string;
}

router.post('/upload-audio', authMiddleware, (req: AuthenticatedRequest, res: Response, next: Function) => {
  audioUpload.single('audio')(req, res, (err: any) => {
    if (err) {
      res.status(400).json({ error: err.message || 'Invalid file upload' });
      return;
    }
    next();
  });
}, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Audio file is required' });
      return;
    }

    const storage = getStorageProvider();
    const extFromName = path.extname(req.file.originalname || '').toLowerCase();
    const extFromType = (() => {
      switch (req.file.mimetype) {
        case 'audio/mpeg':
          return '.mp3';
        case 'audio/wav':
        case 'audio/x-wav':
          return '.wav';
        case 'audio/flac':
        case 'audio/x-flac':
          return '.flac';
        case 'audio/ogg':
          return '.ogg';
        case 'audio/mp4':
        case 'audio/x-m4a':
        case 'audio/aac':
          return '.m4a';
        case 'audio/webm':
          return '.webm';
        case 'video/mp4':
          return '.mp4';
        default:
          return '';
      }
    })();
    const ext = extFromName || extFromType || '.audio';
    const key = `references/${req.user!.id}/${Date.now()}-${generateUUID()}${ext}`;
    const storedKey = await storage.upload(key, req.file.buffer, req.file.mimetype);
    const publicUrl = storage.getPublicUrl(storedKey);

    res.json({ url: publicUrl, key: storedKey });
  } catch (error) {
    console.error('Upload reference audio error:', error);
    res.status(500).json({ error: 'Failed to upload audio' });
  }
});

router.post('/', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      customMode,
      songDescription,
      lyrics,
      style,
      title,
      instrumental,
      vocalLanguage,
      duration,
      bpm,
      keyScale,
      timeSignature,
      inferenceSteps,
      guidanceScale,
      batchSize,
      randomSeed,
      seed,
      thinking,
      audioFormat,
      inferMethod,
      shift,
      lmTemperature,
      lmCfgScale,
      lmTopK,
      lmTopP,
      lmNegativePrompt,
      lmBackend,
      lmModel,
      referenceAudioUrl,
      sourceAudioUrl,
      referenceAudioTitle,
      sourceAudioTitle,
      audioCodes,
      repaintingStart,
      repaintingEnd,
      instruction,
      audioCoverStrength,
      taskType,
      useAdg,
      cfgIntervalStart,
      cfgIntervalEnd,
      customTimesteps,
      useCotMetas,
      useCotCaption,
      useCotLanguage,
      autogen,
      constrainedDecodingDebug,
      allowLmBatch,
      getScores,
      getLrc,
      scoreScale,
      lmBatchChunkSize,
      trackName,
      completeTrackClasses,
      isFormatCaption,
      ditModel,
    } = req.body as GenerateBody;

    // At least one content field is required — unless the request is for cover/repaint/lego
    // and a source audio is provided (the source audio itself is the primary input).
    const requiresSourceAudio = taskType === 'cover' || taskType === 'audio2audio' || taskType === 'repaint' || taskType === 'lego';
    if (!songDescription && !style && !lyrics && !referenceAudioUrl && !(requiresSourceAudio && sourceAudioUrl)) {
      res.status(400).json({ error: 'Please provide a description, style, lyrics, or audio' });
      return;
    }

    // Debug log: show what the API client sent
    console.log(
      `[API] POST /generate:` +
      `\n  taskType    = ${taskType || 'text2music'}` +
      `\n  ditModel    = ${ditModel || '(default)'}` +
      `\n  sourceAudio = ${sourceAudioUrl || 'none'}` +
      `\n  repaint     = [${repaintingStart ?? 'start'}, ${repaintingEnd ?? 'end'}]` +
      `\n  coverStr    = ${audioCoverStrength ?? 'n/a'}` +
      `\n  user        = ${req.user!.id}`
    );

    const params = {
      customMode: true,
      songDescription,
      lyrics,
      style,
      title,
      instrumental,
      vocalLanguage,
      duration,
      bpm,
      keyScale,
      timeSignature,
      inferenceSteps,
      guidanceScale,
      batchSize,
      randomSeed,
      seed,
      thinking,
      audioFormat,
      inferMethod,
      shift,
      lmTemperature,
      lmCfgScale,
      lmTopK,
      lmTopP,
      lmNegativePrompt,
      lmBackend,
      lmModel,
      referenceAudioUrl,
      sourceAudioUrl,
      referenceAudioTitle,
      sourceAudioTitle,
      audioCodes,
      repaintingStart,
      repaintingEnd,
      instruction,
      audioCoverStrength,
      taskType,
      useAdg,
      cfgIntervalStart,
      cfgIntervalEnd,
      customTimesteps,
      useCotMetas,
      useCotCaption,
      useCotLanguage,
      autogen,
      constrainedDecodingDebug,
      allowLmBatch,
      getScores,
      getLrc,
      scoreScale,
      lmBatchChunkSize,
      trackName,
      completeTrackClasses,
      isFormatCaption,
      ditModel,
    };

    // Create job record in database
    const localJobId = generateUUID();
    await pool.query(
      `INSERT INTO generation_jobs (id, user_id, status, params, created_at, updated_at)
       VALUES (?, ?, 'queued', ?, datetime('now'), datetime('now'))`,
      [localJobId, req.user!.id, JSON.stringify(params)]
    );

    // Start generation
    const { jobId: hfJobId } = await generateMusicViaAPI(params);

    // Update job with ACE-Step task ID
    await pool.query(
      `UPDATE generation_jobs SET acestep_task_id = ?, status = 'running', updated_at = datetime('now') WHERE id = ?`,
      [hfJobId, localJobId]
    );

    res.json({
      jobId: localJobId,
      status: 'queued',
      queuePosition: 1,
    });
  } catch (error) {
    console.error('Generate error:', error);
    res.status(500).json({ error: (error as Error).message || 'Generation failed' });
  }
});

router.get('/status/:jobId', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const jobResult = await pool.query(
      `SELECT id, user_id, acestep_task_id, status, params, result, error, created_at
       FROM generation_jobs
       WHERE id = ?`,
      [req.params.jobId]
    );

    if (jobResult.rows.length === 0) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    const job = jobResult.rows[0];

    if (job.user_id !== req.user!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // If job is still running, check ACE-Step status
    if (['pending', 'queued', 'running'].includes(job.status) && job.acestep_task_id) {
      try {
        const aceStatus = await getJobStatus(job.acestep_task_id);

        if (aceStatus.status !== job.status) {
          // Use optimistic lock: only update if status hasn't changed (prevents duplicate song creation)
          let updateQuery = `UPDATE generation_jobs SET status = ?, updated_at = datetime('now')`;
          const updateParams: unknown[] = [aceStatus.status];

          if (aceStatus.status === 'succeeded' && aceStatus.result) {
            updateQuery += `, result = ?`;
            updateParams.push(JSON.stringify(aceStatus.result));
          } else if (aceStatus.status === 'failed' && aceStatus.error) {
            updateQuery += `, error = ?`;
            updateParams.push(aceStatus.error);
          }

          updateQuery += ` WHERE id = ? AND status = ?`;
          updateParams.push(req.params.jobId, job.status);

          const updateResult = await pool.query(updateQuery, updateParams);
          const wasUpdated = updateResult.rowCount > 0;

          // If succeeded AND we were the first to update (optimistic lock), create song records
          if (aceStatus.status === 'succeeded' && aceStatus.result && wasUpdated) {
            const params = typeof job.params === 'string' ? JSON.parse(job.params) : job.params;
            const audioUrls = aceStatus.result.audioUrls.filter((url: string) => {
              const lower = url.toLowerCase();
              return lower.endsWith('.mp3') || lower.endsWith('.flac') || lower.endsWith('.wav');
            });
            const localPaths: string[] = [];
            const storage = getStorageProvider();

            for (let i = 0; i < audioUrls.length; i++) {
              const audioUrl = audioUrls[i];
              const variationSuffix = audioUrls.length > 1 ? ` (v${i + 1})` : '';
              const songTitle = autoTitle(params) + variationSuffix;

              const songId = generateUUID();

              try {
                const { buffer } = await downloadAudioToBuffer(audioUrl);
                const ext = audioUrl.endsWith('.flac') ? '.flac' : audioUrl.endsWith('.wav') ? '.wav' : '.mp3';
                const mimeType = ext === '.wav' ? 'audio/wav' : ext === '.flac' ? 'audio/flac' : 'audio/mpeg';
                const storageKey = `${req.user!.id}/${songId}${ext}`;
                await storage.upload(storageKey, buffer, mimeType);
                const storedPath = storage.getPublicUrl(storageKey);

                await pool.query(
                  `INSERT INTO songs (id, user_id, title, lyrics, style, caption, audio_url,
                                      duration, bpm, key_scale, time_signature, tags, is_public, generation_params,
                                      created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now'), datetime('now'))`,
                  [
                    songId,
                    req.user!.id,
                    songTitle,
                    params.instrumental ? '[Instrumental]' : params.lyrics,
                    params.style,
                    params.style,
                    storedPath,
                    aceStatus.result.duration && aceStatus.result.duration > 0 ? aceStatus.result.duration : (params.duration && params.duration > 0 ? params.duration : 0),
                    aceStatus.result.bpm || params.bpm,
                    aceStatus.result.keyScale || params.keyScale,
                    aceStatus.result.timeSignature || params.timeSignature,
                    JSON.stringify([]),
                    JSON.stringify(params),
                  ]
                );

                localPaths.push(storedPath);
              } catch (downloadError) {
                console.error(`Failed to download audio ${i + 1}:`, downloadError);
                // Still create song record with remote URL
                await pool.query(
                  `INSERT INTO songs (id, user_id, title, lyrics, style, caption, audio_url,
                                      duration, bpm, key_scale, time_signature, tags, is_public, generation_params,
                                      created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now'), datetime('now'))`,
                  [
                    songId,
                    req.user!.id,
                    songTitle,
                    params.instrumental ? '[Instrumental]' : params.lyrics,
                    params.style,
                    params.style,
                    audioUrl,
                    aceStatus.result.duration && aceStatus.result.duration > 0 ? aceStatus.result.duration : (params.duration && params.duration > 0 ? params.duration : 0),
                    aceStatus.result.bpm || params.bpm,
                    aceStatus.result.keyScale || params.keyScale,
                    aceStatus.result.timeSignature || params.timeSignature,
                    JSON.stringify([]),
                    JSON.stringify(params),
                  ]
                );
                localPaths.push(audioUrl);
              }
            }

            aceStatus.result.audioUrls = localPaths;
            cleanupJob(job.acestep_task_id);
          }
        }

        res.json({
          jobId: req.params.jobId,
          status: aceStatus.status,
          queuePosition: aceStatus.queuePosition,
          etaSeconds: aceStatus.etaSeconds,
          progress: aceStatus.progress,
          stage: aceStatus.stage,
          result: aceStatus.result,
          error: aceStatus.error,
        });
        return;
      } catch (aceError) {
        console.error('ACE-Step status check error:', aceError);
      }
    }

    // Return stored status
    res.json({
      jobId: req.params.jobId,
      status: job.status,
      progress: undefined,
      stage: undefined,
      result: job.result && typeof job.result === 'string' ? JSON.parse(job.result) : job.result,
      error: job.error,
    });
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Audio proxy endpoint
router.get('/audio', async (req, res: Response) => {
  try {
    const audioPath = req.query.path as string;
    if (!audioPath) {
      res.status(400).json({ error: 'Path required' });
      return;
    }

    const audioResponse = await getAudioStream(audioPath);

    if (!audioResponse.ok) {
      res.status(audioResponse.status).json({ error: 'Failed to fetch audio' });
      return;
    }

    const contentType = audioResponse.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    const contentLength = audioResponse.headers.get('content-length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    const reader = audioResponse.body?.getReader();
    if (!reader) {
      res.status(500).json({ error: 'Failed to read audio stream' });
      return;
    }

    const pump = async (): Promise<void> => {
      const { done, value } = await reader.read();
      if (done) {
        res.end();
        return;
      }
      res.write(value);
      return pump();
    };

    await pump();
  } catch (error) {
    console.error('Audio proxy error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/history', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, acestep_task_id, status, params, result, error, created_at
       FROM generation_jobs
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 50`,
      [req.user!.id]
    );

    res.json({ jobs: result.rows });
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/endpoints', authMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const endpoints = await discoverEndpoints();
    res.json({ endpoints });
  } catch (error) {
    console.error('Discover endpoints error:', error);
    res.status(500).json({ error: 'Failed to discover endpoints' });
  }
});

router.get('/models', async (_req, res: Response) => {
  // In HTTP mode: ask the server; in spawn mode: return current model from config
  if (!(config.acestep.lmBin && config.acestep.ditVaeBin)) {
    try {
      const apiRes = await fetch(`${config.acestep.apiUrl}/v1/models`);
      if (apiRes.ok) {
        const data = await apiRes.json() as any;
        // Support both { models: [...] } (acestep-cpp) and { data: { models: [...] } } legacy shape
        const models = data?.models || data?.data?.models || [];
        res.json({ models });
        return;
      }
    } catch { /* fall through to defaults */ }
  }

  // Spawn mode (or HTTP server unreachable): report the configured DiT model
  const activeModel = config.acestep.ditModel
    ? path.basename(config.acestep.ditModel, path.extname(config.acestep.ditModel))
    : 'acestep-v15-turbo';

  res.json({
    models: [
      { name: activeModel,         is_active: true,  is_preloaded: Boolean(config.acestep.ditModel) },
      { name: 'acestep-v15-turbo', is_active: activeModel === 'acestep-v15-turbo', is_preloaded: false },
      { name: 'acestep-v15-base',  is_active: false, is_preloaded: false },
      { name: 'acestep-v15-sft',   is_active: false, is_preloaded: false },
    ].filter((m, i, arr) => i === arr.findIndex(n => n.name === m.name)), // dedup
  });
});

// GET /api/generate/random-description — Load a random simple description from Gradio
router.get('/random-description', authMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  // Return a static random description from a built-in list
  const descriptions = [
    { description: 'upbeat pop song with catchy hooks and electric guitar', instrumental: false, vocalLanguage: 'en' },
    { description: 'cinematic orchestral score with epic strings and choir', instrumental: true, vocalLanguage: 'en' },
    { description: 'lo-fi hip hop beat with jazzy chords and soft drums', instrumental: true, vocalLanguage: 'en' },
    { description: 'dark electronic track with heavy bass and synth leads', instrumental: false, vocalLanguage: 'en' },
    { description: 'acoustic folk ballad with fingerpicked guitar and warm vocals', instrumental: false, vocalLanguage: 'en' },
    { description: 'funky r&b groove with slap bass and brass stabs', instrumental: true, vocalLanguage: 'en' },
    { description: 'dreamy indie pop with reverb-drenched guitars and airy vocals', instrumental: false, vocalLanguage: 'en' },
    { description: 'energetic rock anthem with distorted guitars and powerful drums', instrumental: false, vocalLanguage: 'en' },
    { description: 'smooth jazz quartet with piano, bass, drums, and saxophone', instrumental: true, vocalLanguage: 'en' },
    { description: 'ambient electronic soundscape with evolving pads and textures', instrumental: true, vocalLanguage: 'en' },
  ];
  const pick = descriptions[Math.floor(Math.random() * descriptions.length)];
  res.json(pick);
});

router.get('/health', async (_req, res: Response) => {
  try {
    const healthy = await checkSpaceHealth();
    const mode = (config.acestep.lmBin && config.acestep.ditVaeBin) ? 'spawn' : 'http';
    res.json({
      healthy,
      mode,
      lmBin:     config.acestep.lmBin     || null,
      ditVaeBin: config.acestep.ditVaeBin || null,
      aceStepUrl: config.acestep.apiUrl,
    });
  } catch (error) {
    res.json({ healthy: false, error: (error as Error).message });
  }
});

router.get('/limits', async (_req, res: Response) => {
  // In HTTP mode, ask the server; in spawn mode, return safe defaults
  if (!(config.acestep.lmBin && config.acestep.ditVaeBin)) {
    try {
      const response = await fetch(`${config.acestep.apiUrl}/v1/limits`);
      if (response.ok) {
        res.json(await response.json());
        return;
      }
    } catch { /* fall through */ }
  }
  // Safe defaults (users can override by setting VRAM-aware values in .env)
  res.json({
    tier: 'medium',
    gpu_memory_gb: 8,
    max_duration_with_lm: 120,
    max_duration_without_lm: 240,
    max_batch_size_with_lm: 2,
    max_batch_size_without_lm: 4,
  });
});

router.get('/debug/:taskId', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rawResponse = getJobRawResponse(req.params.taskId);
    if (!rawResponse) {
      res.status(404).json({ error: 'Job not found or no raw response available' });
      return;
    }
    res.json({ rawResponse });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ── Debug log endpoints ───────────────────────────────────────────────────────

/** List all in-memory jobs (for the debug panel job selector). */
router.get('/logs', logRateLimiter, authMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    res.json({ jobs: listActiveJobs() });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * Stream log lines for a specific job.
 * Query param `after` (integer) returns only lines after that index for efficient polling.
 */
router.get('/logs/:jobId', logRateLimiter, authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const after = parseInt(req.query.after as string || '0', 10);
    const result = getJobLogs(req.params.jobId, isNaN(after) ? 0 : after);
    if (!result) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Format endpoint - uses LLM to enhance style/lyrics
// Spawn mode: runs `acestep-generate --mode format` with the prompt/lyrics as args
// HTTP mode:  calls ACESTEP_API_URL/format_input
router.post('/format', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { caption, lyrics, bpm, duration, keyScale, timeSignature, temperature } = req.body;

    if (!caption) {
      res.status(400).json({ error: 'Caption/style is required' });
      return;
    }

    // ── Spawn mode ────────────────────────────────────────────────────────
    // ace-qwen3 is used for format/enhance — pass a request JSON with autogen enabled
    if (config.acestep.lmBin && config.acestep.lmModel) {
      const { writeFile: wf, mkdir: mkd, rm: rmf } = await import('fs/promises');
      const { tmpdir } = await import('os');
      const tmpD = path.join(tmpdir(), `acestep_fmt_${Date.now()}`);
      await mkd(tmpD, { recursive: true });
      const reqPath = path.join(tmpD, 'request.json');
      const reqJson: Record<string, unknown> = {
        caption,
        lyrics:       lyrics        || '',
        lm_temperature: temperature ?? 0.85,
      };
      if (bpm && bpm > 0)        reqJson.bpm           = bpm;
      if (duration && duration > 0) reqJson.duration   = duration;
      if (keyScale)              reqJson.keyscale       = keyScale;
      if (timeSignature)         reqJson.timesignature  = timeSignature;
      await wf(reqPath, JSON.stringify(reqJson, null, 2));

      const args: string[] = ['--request', reqPath, '--model', config.acestep.lmModel];
      const { spawn } = await import('child_process');
      const result = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
        const proc = spawn(config.acestep.lmBin!, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = ''; let stderr = '';
        proc.stdout.on('data', (c: Buffer) => { stdout += c.toString(); });
        proc.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
        proc.on('close', (code) => resolve({ stdout, stderr, code: code ?? 1 }));
        proc.on('error', (e) => resolve({ stdout: '', stderr: e.message, code: 1 }));
      });

      // Read the enriched JSON output (request0.json placed alongside request.json)
      let enriched: Record<string, unknown> = {};
      try {
        const { readFile } = await import('fs/promises');
        const text = await readFile(path.join(tmpD, 'request0.json'), 'utf-8');
        enriched = JSON.parse(text);
      } catch { /* best-effort */ }
      await rmf(tmpD, { recursive: true, force: true }).catch(() => { /* ignore */ });

      if (result.code !== 0 && !enriched.caption) {
        res.status(500).json({ success: false, error: (result.stderr || result.stdout).slice(0, 500) });
        return;
      }
      res.json({
        caption:        enriched.caption        ?? caption,
        lyrics:         enriched.lyrics         ?? lyrics,
        bpm:            enriched.bpm,
        duration:       enriched.duration,
        key_scale:      enriched.keyscale,
        time_signature: enriched.timesignature,
        vocal_language: enriched.vocal_language,
      });
      return;
    }

    // ── HTTP mode ─────────────────────────────────────────────────────────
    const paramObj: Record<string, unknown> = {};
    if (bpm && bpm > 0)      paramObj.bpm            = bpm;
    if (duration && duration > 0) paramObj.duration   = duration;
    if (keyScale)            paramObj.key             = keyScale;
    if (timeSignature)       paramObj.time_signature  = timeSignature;

    console.log(`[Format] Calling HTTP server: ${config.acestep.apiUrl}/format_input`);
    const apiRes = await fetch(`${config.acestep.apiUrl}/format_input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: caption, lyrics: lyrics || '', temperature: temperature ?? 0.85, param_obj: paramObj }),
      signal: AbortSignal.timeout(300_000),
    });

    const apiData = await apiRes.json() as any;
    if (!apiRes.ok) {
      res.status(500).json({ success: false, error: apiData.error || `Format API returned ${apiRes.status}` });
      return;
    }
    const d = apiData.data ?? apiData;
    res.json({ caption: d.caption, lyrics: d.lyrics, bpm: d.bpm, duration: d.duration,
               key_scale: d.key_scale, time_signature: d.time_signature, vocal_language: d.vocal_language });
  } catch (error) {
    console.error('[Format] Route error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
