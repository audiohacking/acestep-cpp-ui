import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import { pool } from '../db/pool.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { getStorageProvider } from '../services/storage/factory.js';
import { spawn } from 'child_process';
import { runUnderstand } from '../services/acestep.js';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUDIO_DIR = path.join(__dirname, '../../public/audio');

// Per-IP rate limiter for CPU-intensive understand operations (max 6 requests per minute)
const understandRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please wait before analysing another track' },
});

// Apply rate limiting to all understand routes
router.use('/understand-url', understandRateLimiter);
router.use('/:id/understand', understandRateLimiter);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (_req, file, cb) => {
    const allowedTypes = [
      'audio/mpeg',
      'audio/wav',
      'audio/flac',
      'audio/mp3',
      'audio/x-wav',
      'audio/x-flac',
      'audio/mp4',
      'audio/x-m4a',
      'audio/aac',
      'video/mp4',
    ];
    if (allowedTypes.includes(file.mimetype) || file.originalname.match(/\.(mp3|wav|flac|m4a|mp4)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only MP3, WAV, FLAC, M4A, and MP4 are allowed.'));
    }
  }
});

const findWhisperExecutable = async (): Promise<string | null> => {
  if (process.env.WHISPER_CMD) return process.env.WHISPER_CMD;
  const customPath = process.env.WHISPER_PATH;
  if (customPath) {
    const candidate = path.join(customPath, 'whisper');
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // ignore
    }
  }

  const pathEntries = (process.env.PATH || '').split(path.delimiter);
  for (const entry of pathEntries) {
    const candidate = path.join(entry, 'whisper');
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // ignore
    }
  }
  return null;
};

const transcribeWithWhisper = async (buffer: Buffer, originalFilename: string, signal?: AbortSignal): Promise<string | null> => {
  const whisperCmd = await findWhisperExecutable();
  if (!whisperCmd) return null;

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'whisper-'));
  const ext = path.extname(originalFilename) || '.mp3';
  const inputPath = path.join(tempDir, `input${ext}`);
  const outputDir = path.join(tempDir, 'out');

  try {
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(inputPath, buffer);

    const args = [
      inputPath,
      '--model', 'base',
      '--output_format', 'txt',
      '--output_dir', outputDir,
      '--fp16', 'False'
    ];

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(whisperCmd, args, { stdio: 'ignore' });
      const handleAbort = () => {
        proc.kill('SIGTERM');
        reject(new Error('Transcription cancelled'));
      };
      if (signal) {
        if (signal.aborted) {
          handleAbort();
          return;
        }
        signal.addEventListener('abort', handleAbort, { once: true });
      }
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (signal) {
          signal.removeEventListener('abort', handleAbort);
        }
        if (code === 0) resolve();
        else reject(new Error(`Whisper exited with code ${code}`));
      });
    });

    const files = await fs.readdir(outputDir);
    const txtFile = files.find((file) => file.endsWith('.txt'));
    if (!txtFile) return null;
    const text = await fs.readFile(path.join(outputDir, txtFile), 'utf8');
    return text.trim() || null;
  } catch (error) {
    console.warn('Whisper transcription failed:', error);
    return null;
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
};

// Get user's reference tracks
router.get('/', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, filename, storage_key, duration, file_size_bytes, tags, created_at
       FROM reference_tracks
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user!.id]
    );

    const storage = getStorageProvider();
    const tracks = result.rows.map(row => ({
      ...row,
      audio_url: storage.getPublicUrl(row.storage_key)
    }));

    res.json({ tracks });
  } catch (error) {
    console.error('Get reference tracks error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Upload a new reference track
router.post('/', authMiddleware, upload.single('audio'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const userId = req.user!.id;
    const originalFilename = req.file.originalname;
    const ext = path.extname(originalFilename) || '.mp3';
    const timestamp = Date.now();
    const key = `reference-tracks/${userId}/${timestamp}${ext}`;

    const storage = getStorageProvider();
    await storage.upload(key, req.file.buffer, req.file.mimetype);
    const audioUrl = storage.getPublicUrl(key);
    const whisperAvailable = Boolean(await findWhisperExecutable());

    // Parse tags from request body if provided
    const tags = req.body.tags ? JSON.parse(req.body.tags) : null;

    const result = await pool.query(
      `INSERT INTO reference_tracks (user_id, filename, storage_key, file_size_bytes, tags)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, originalFilename, key, req.file.size, tags]
    );

    res.status(201).json({
      track: {
        ...result.rows[0],
        audio_url: audioUrl
      },
      whisper_available: whisperAvailable
    });
  } catch (error) {
    console.error('Upload reference track error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to upload reference track', details: errorMessage });
  }
});

// Update reference track (duration, tags)
router.patch('/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Verify ownership
    const check = await pool.query(
      'SELECT user_id FROM reference_tracks WHERE id = $1',
      [req.params.id]
    );
    if (check.rows.length === 0) {
      res.status(404).json({ error: 'Track not found' });
      return;
    }
    if (check.rows[0].user_id !== req.user!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const { duration, tags } = req.body;
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramCount = 1;

    if (duration !== undefined) {
      updates.push(`duration = $${paramCount}`);
      values.push(duration);
      paramCount++;
    }
    if (tags !== undefined) {
      updates.push(`tags = $${paramCount}`);
      values.push(tags);
      paramCount++;
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    values.push(req.params.id);
    const result = await pool.query(
      `UPDATE reference_tracks SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      values
    );

    const storage = getStorageProvider();
    res.json({
      track: {
        ...result.rows[0],
        audio_url: storage.getPublicUrl(result.rows[0].storage_key)
      }
    });
  } catch (error) {
    console.error('Update reference track error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Transcribe a reference track with whisper (if available)
router.post('/:id/transcribe', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const whisperCmd = await findWhisperExecutable();
    if (!whisperCmd) {
      res.status(404).json({ error: 'Whisper not available' });
      return;
    }

    const result = await pool.query(
      'SELECT user_id, filename, storage_key FROM reference_tracks WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Track not found' });
      return;
    }
    if (result.rows[0].user_id !== req.user!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const audioPath = path.join(AUDIO_DIR, result.rows[0].storage_key);
    const buffer = await fs.readFile(audioPath);
    const controller = new AbortController();

    req.on('close', () => controller.abort());

    const lyrics = await transcribeWithWhisper(buffer, result.rows[0].filename, controller.signal);
    if (controller.signal.aborted) return;

    res.json({ lyrics: lyrics || '' });
  } catch (error) {
    console.error('Transcribe reference track error:', error);
    res.status(500).json({ error: 'Failed to transcribe' });
  }
});

// Delete a reference track
router.delete('/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Verify ownership
    const check = await pool.query(
      'SELECT user_id, storage_key FROM reference_tracks WHERE id = $1',
      [req.params.id]
    );
    if (check.rows.length === 0) {
      res.status(404).json({ error: 'Track not found' });
      return;
    }
    if (check.rows[0].user_id !== req.user!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // Delete from storage
    const storage = getStorageProvider();
    try {
      await storage.delete(check.rows[0].storage_key);
    } catch (storageError) {
      console.error('Failed to delete from storage:', storageError);
    }

    // Delete from database
    await pool.query('DELETE FROM reference_tracks WHERE id = $1', [req.params.id]);

    res.json({ success: true });
  } catch (error) {
    console.error('Delete reference track error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Understand a reference track with ace-understand
router.post('/:id/understand', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT user_id, storage_key FROM reference_tracks WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Track not found' });
      return;
    }
    if (result.rows[0].user_id !== req.user!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const audioUrl = `/audio/${result.rows[0].storage_key}`;
    const understood = await runUnderstand(audioUrl);
    res.json(understood);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to understand audio';
    console.error('Understand reference track error:', error);
    res.status(500).json({ error: msg });
  }
});

// Understand audio by URL (for source/generated audio without a reference track DB entry)
router.post('/understand-url', understandRateLimiter, authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { audioUrl } = req.body as { audioUrl?: string };
  if (!audioUrl || typeof audioUrl !== 'string') {
    res.status(400).json({ error: 'audioUrl is required' });
    return;
  }

  try {
    const understood = await runUnderstand(audioUrl);
    res.json(understood);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to understand audio';
    console.error('Understand URL error:', error);
    res.status(500).json({ error: msg });
  }
});

export default router;
