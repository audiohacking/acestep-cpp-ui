/**
 * acestep.ts — Music generation service
 *
 * Primary mode:  spawn `acestep-generate` binary directly via child_process
 *                (set ACESTEP_BIN in .env)
 *
 * Fallback mode: HTTP calls to a running acestep-cpp server
 *                (set ACESTEP_API_URL in .env when ACESTEP_BIN is not set)
 */

import { spawn } from 'child_process';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { execSync, execFileSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUDIO_DIR = config.storage.audioDir;

// Get audio duration using ffprobe
function getAudioDuration(filePath: string): number {
  try {
    const result = execFileSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ], { encoding: 'utf-8', timeout: 10000 });
    const duration = parseFloat(result.trim());
    return isNaN(duration) ? 0 : Math.round(duration);
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GenerationParams {
  customMode: boolean;
  songDescription?: string;
  lyrics: string;
  style: string;
  title: string;
  instrumental: boolean;
  vocalLanguage?: string;
  duration?: number;
  bpm?: number;
  keyScale?: string;
  timeSignature?: string;
  inferenceSteps?: number;
  guidanceScale?: number;
  batchSize?: number;
  randomSeed?: boolean;
  seed?: number;
  thinking?: boolean;
  enhance?: boolean;
  audioFormat?: 'mp3' | 'flac';
  inferMethod?: 'ode' | 'sde';
  shift?: number;
  lmTemperature?: number;
  lmCfgScale?: number;
  lmTopK?: number;
  lmTopP?: number;
  lmNegativePrompt?: string;
  lmBackend?: 'pt' | 'vllm';
  lmModel?: string;
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
  useCotMetas?: boolean;
  useCotCaption?: boolean;
  useCotLanguage?: boolean;
  autogen?: boolean;
  ditModel?: string;
}

interface GenerationResult {
  audioUrls: string[];
  duration: number;
  bpm?: number;
  keyScale?: string;
  timeSignature?: string;
  status: string;
}

interface JobStatus {
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  queuePosition?: number;
  etaSeconds?: number;
  progress?: number;
  stage?: string;
  result?: GenerationResult;
  error?: string;
}

interface ActiveJob {
  params: GenerationParams;
  startTime: number;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  result?: GenerationResult;
  error?: string;
  rawResponse?: unknown;
  queuePosition?: number;
  progress?: number;
  stage?: string;
}

const activeJobs = new Map<string, ActiveJob>();
setInterval(() => cleanupOldJobs(3600000), 600000);

const jobQueue: string[] = [];
let isProcessingQueue = false;

// ---------------------------------------------------------------------------
// Mode detection
// ---------------------------------------------------------------------------

function useSpawnMode(): boolean {
  return Boolean(config.acestep.bin);
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

export async function checkSpaceHealth(): Promise<boolean> {
  if (useSpawnMode()) {
    // Spawn mode: check the binary exists and is executable
    return existsSync(config.acestep.bin!);
  }
  // HTTP mode: ping the server
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${config.acestep.apiUrl}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Audio path resolution (for reference/source audio inputs)
// ---------------------------------------------------------------------------

function resolveAudioPath(audioUrl: string): string {
  if (audioUrl.startsWith('/audio/')) {
    return path.join(AUDIO_DIR, audioUrl.replace('/audio/', ''));
  }
  if (audioUrl.startsWith('http')) {
    try {
      const parsed = new URL(audioUrl);
      if (parsed.pathname.startsWith('/audio/')) {
        return path.join(AUDIO_DIR, parsed.pathname.replace('/audio/', ''));
      }
    } catch { /* fall through */ }
  }
  return audioUrl;
}

// ---------------------------------------------------------------------------
// Build CLI argument list for acestep-generate (no shell — safe)
// ---------------------------------------------------------------------------

function buildSpawnArgs(params: GenerationParams, outputPrefix: string): string[] {
  const caption = params.style || 'pop music';
  const prompt = params.customMode ? caption : (params.songDescription || caption);
  const lyrics = params.instrumental ? '' : (params.lyrics || '');
  const isThinking = params.thinking ?? false;
  const isEnhance = params.enhance ?? false;
  const useCot = isEnhance || isThinking;
  const taskType = params.taskType === 'audio2audio' ? 'cover' : (params.taskType || 'text2music');

  const args: string[] = [];

  // Model
  if (config.acestep.model) {
    args.push('--model', config.acestep.model);
  }

  // Core
  args.push('--prompt', prompt);
  if (lyrics) args.push('--lyrics', lyrics);
  if (params.instrumental) args.push('--instrumental');

  // Music parameters
  if (params.duration && params.duration > 0)  args.push('--duration',        String(params.duration));
  if (params.bpm && params.bpm > 0)            args.push('--bpm',             String(params.bpm));
  if (params.keyScale)                         args.push('--key-scale',       params.keyScale);
  if (params.timeSignature)                    args.push('--time-signature',  params.timeSignature);
  if (params.vocalLanguage)                    args.push('--vocal-language',  params.vocalLanguage);

  // Generation settings
  args.push('--infer-steps',     String(params.inferenceSteps ?? 8));
  args.push('--guidance-scale',  String(params.guidanceScale  ?? 7.0));
  args.push('--batch-size',      String(Math.min(Math.max(params.batchSize ?? 1, 1), 16)));
  args.push('--audio-format',    params.audioFormat || 'mp3');
  args.push('--shift',           String(params.shift ?? 3.0));
  args.push('--infer-method',    params.inferMethod || 'ode');
  args.push('--task-type',       taskType);

  if (params.randomSeed !== false) {
    args.push('--seed', '-1');
  } else if (params.seed !== undefined) {
    args.push('--seed', String(params.seed));
  }

  // LM
  args.push('--lm-temperature', String(params.lmTemperature ?? 0.85));
  args.push('--lm-cfg-scale',   String(params.lmCfgScale   ?? 2.0));
  if ((params.lmTopK ?? 0) > 0) args.push('--lm-top-k', String(params.lmTopK));
  args.push('--lm-top-p',       String(params.lmTopP ?? 0.9));
  if (params.lmNegativePrompt)  args.push('--lm-negative-prompt', params.lmNegativePrompt);

  // CoT
  if (isThinking)     args.push('--thinking');
  if (useCot) {
    if (params.useCotMetas    !== false) args.push('--use-cot-metas');
    if (params.useCotCaption  !== false) args.push('--use-cot-caption');
    if (params.useCotLanguage !== false) args.push('--use-cot-language');
  }

  // Expert
  if (params.useAdg)                                          args.push('--use-adg');
  if ((params.cfgIntervalStart ?? 0) > 0)                    args.push('--cfg-interval-start', String(params.cfgIntervalStart));
  if ((params.cfgIntervalEnd ?? 1) < 1)                      args.push('--cfg-interval-end',   String(params.cfgIntervalEnd));
  if (params.audioCoverStrength !== undefined && taskType !== 'text2music')
                                                              args.push('--audio-cover-strength', String(params.audioCoverStrength));
  if (params.repaintingStart && params.repaintingStart > 0)  args.push('--repainting-start', String(params.repaintingStart));
  if (params.repaintingEnd   && params.repaintingEnd   > 0)  args.push('--repainting-end',   String(params.repaintingEnd));
  if (params.audioCodes)                                      args.push('--audio-codes', params.audioCodes);
  if (params.autogen)                                         args.push('--autogen');

  // Audio inputs (resolved to absolute local paths)
  if (params.referenceAudioUrl) args.push('--reference-audio', resolveAudioPath(params.referenceAudioUrl));
  if (params.sourceAudioUrl)    args.push('--src-audio',       resolveAudioPath(params.sourceAudioUrl));

  // LoRA — state lives in lora.ts but is injected here at generation time
  if (loraState.loaded && loraState.active && loraState.path) {
    args.push('--lora',       loraState.path);
    args.push('--lora-scale', String(loraState.scale));
  }

  // Model variant override
  if (params.ditModel) args.push('--dit-model', params.ditModel);

  // Output
  args.push('--output-prefix', outputPrefix);
  args.push('--json');  // print result JSON on stdout

  return args;
}

// ---------------------------------------------------------------------------
// Spawn mode: run acestep-generate as a child process
// ---------------------------------------------------------------------------

async function runViaSpawn(
  jobId: string,
  params: GenerationParams,
  job: ActiveJob,
): Promise<void> {
  await mkdir(AUDIO_DIR, { recursive: true });

  const outputPrefix = path.join(AUDIO_DIR, jobId);
  const args = buildSpawnArgs(params, outputPrefix);
  const bin = config.acestep.bin!;

  console.log(`[Spawn] Job ${jobId}: ${bin} ${args.slice(0, 6).join(' ')} ...`);

  const result = await new Promise<{ stdout: string; stderr: string; code: number }>(
    (resolve) => {
      const proc = spawn(bin, args, {
        shell: false,                // ← no shell, safe from injection
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      proc.on('close', (code) => resolve({ stdout, stderr, code: code ?? 1 }));
      proc.on('error', (err) => {
        console.error(`[Spawn] Process error: ${err.message}`);
        resolve({ stdout, stderr, code: 1 });
      });
    },
  );

  if (result.code !== 0) {
    const msg = result.stderr || result.stdout || `exit code ${result.code}`;
    throw new Error(`acestep-generate failed: ${msg.slice(0, 500)}`);
  }

  // Parse JSON from stdout (last JSON object line wins)
  let parsed: { audio_paths?: string[]; bpm?: number; key_scale?: string; time_signature?: string; duration?: number } = {};
  for (const line of result.stdout.split('\n').reverse()) {
    const trimmed = line.trim();
    if (trimmed.startsWith('{')) {
      try { parsed = JSON.parse(trimmed); break; } catch { /* next */ }
    }
  }

  // Collect audio files — from JSON or by scanning with the job prefix
  let audioPaths: string[] = parsed.audio_paths ?? [];
  if (audioPaths.length === 0) {
    const { readdirSync } = await import('fs');
    const exts = new Set(['.mp3', '.flac', '.wav', '.ogg']);
    try {
      audioPaths = readdirSync(AUDIO_DIR)
        .filter(f => f.startsWith(path.basename(jobId)) && exts.has(path.extname(f).toLowerCase()))
        .map(f => path.join(AUDIO_DIR, f));
    } catch { /* ignore */ }
  }

  if (audioPaths.length === 0) {
    throw new Error('acestep-generate produced no audio files');
  }

  const audioUrls = audioPaths.map(p => {
    // If already inside AUDIO_DIR, expose as /audio/<filename>
    const rel = path.relative(AUDIO_DIR, p);
    return rel.startsWith('..') ? p : `/audio/${rel}`;
  });

  const actualDuration = getAudioDuration(audioPaths[0]);
  const finalDuration = actualDuration > 0 ? actualDuration : (parsed.duration || params.duration || 0);

  job.status = 'succeeded';
  job.result = {
    audioUrls,
    duration: finalDuration,
    bpm: parsed.bpm || params.bpm,
    keyScale: parsed.key_scale || params.keyScale,
    timeSignature: parsed.time_signature || params.timeSignature,
    status: 'succeeded',
  };
  job.rawResponse = parsed;
  console.log(`[Spawn] Job ${jobId}: completed with ${audioUrls.length} audio file(s)`);
}

// ---------------------------------------------------------------------------
// HTTP mode: call a separately running acestep-cpp server
// ---------------------------------------------------------------------------

function buildHttpRequest(params: GenerationParams): Record<string, unknown> {
  const caption = params.style || 'pop music';
  const prompt = params.customMode ? caption : (params.songDescription || caption);
  const lyrics = params.instrumental ? '' : (params.lyrics || '');
  const isThinking = params.thinking ?? false;
  const isEnhance  = params.enhance  ?? false;
  const useCot    = isEnhance || isThinking;
  const taskType  = params.taskType === 'audio2audio' ? 'cover' : (params.taskType || 'text2music');

  const body: Record<string, unknown> = {
    prompt,
    lyrics,
    instrumental:          params.instrumental ?? false,
    duration:              params.duration && params.duration > 0 ? params.duration : -1,
    bpm:                   params.bpm && params.bpm > 0 ? params.bpm : 0,
    key_scale:             params.keyScale || '',
    time_signature:        params.timeSignature || '',
    vocal_language:        params.vocalLanguage || 'en',
    infer_steps:           params.inferenceSteps ?? 8,
    guidance_scale:        params.guidanceScale  ?? 7.0,
    batch_size:            Math.min(Math.max(params.batchSize ?? 1, 1), 16),
    seed:                  params.randomSeed !== false ? -1 : (params.seed ?? -1),
    audio_format:          params.audioFormat || 'mp3',
    shift:                 params.shift ?? 3.0,
    infer_method:          params.inferMethod || 'ode',
    task_type:             taskType,
    audio_cover_strength:  params.audioCoverStrength ?? 1.0,
    thinking:              isThinking,
    lm_temperature:        params.lmTemperature ?? 0.85,
    lm_cfg_scale:          params.lmCfgScale    ?? 2.0,
    lm_top_k:              params.lmTopK        ?? 0,
    lm_top_p:              params.lmTopP        ?? 0.9,
    lm_negative_prompt:    params.lmNegativePrompt || '',
    use_cot_metas:         useCot ? (params.useCotMetas    ?? true) : false,
    use_cot_caption:       useCot ? (params.useCotCaption  ?? true) : false,
    use_cot_language:      useCot ? (params.useCotLanguage ?? true) : false,
    use_adg:               params.useAdg ?? false,
    cfg_interval_start:    params.cfgIntervalStart ?? 0.0,
    cfg_interval_end:      params.cfgIntervalEnd   ?? 1.0,
    audio_codes:           params.audioCodes || '',
    repainting_start:      params.repaintingStart ?? 0.0,
    repainting_end:        params.repaintingEnd   ?? -1,
    autogen:               params.autogen ?? false,
  };

  if (params.referenceAudioUrl) body.reference_audio = resolveAudioPath(params.referenceAudioUrl);
  if (params.sourceAudioUrl)    body.src_audio        = resolveAudioPath(params.sourceAudioUrl);
  if (params.ditModel)          body.dit_model        = params.ditModel;

  // Pass LoRA state as request fields
  if (loraState.loaded && loraState.active && loraState.path) {
    body.lora_path  = loraState.path;
    body.lora_scale = loraState.scale;
  }

  return body;
}

async function runViaHttp(
  jobId: string,
  params: GenerationParams,
  job: ActiveJob,
): Promise<void> {
  const url = `${config.acestep.apiUrl}/v1/generate`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildHttpRequest(params)),
    signal: AbortSignal.timeout(900_000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => `HTTP ${response.status}`);
    throw new Error(`acestep server error: ${response.status} ${errText}`);
  }

  const result = await response.json() as {
    audio_paths?: string[];
    bpm?: number;
    key_scale?: string;
    time_signature?: string;
    duration?: number;
    error?: string;
  };

  if (result.error) throw new Error(`acestep server: ${result.error}`);
  if (!result.audio_paths?.length) throw new Error('acestep server returned no audio files');

  await mkdir(AUDIO_DIR, { recursive: true });

  const audioUrls: string[] = [];
  let actualDuration = 0;
  const fmt = params.audioFormat ?? 'mp3';

  for (const remotePath of result.audio_paths) {
    const ext = remotePath.endsWith('.flac') ? '.flac' : `.${fmt}`;
    const filename = `${jobId}_${audioUrls.length}${ext}`;
    const destPath = path.join(AUDIO_DIR, filename);

    // Copy if local, download if remote
    if (remotePath.startsWith('/') && existsSync(remotePath)) {
      const { copyFile } = await import('fs/promises');
      await copyFile(remotePath, destPath);
    } else {
      const dlUrl = remotePath.startsWith('http')
        ? remotePath
        : `${config.acestep.apiUrl}/v1/audio?path=${encodeURIComponent(remotePath)}`;
      const dlRes = await fetch(dlUrl);
      if (!dlRes.ok) throw new Error(`Failed to download audio: ${dlRes.status}`);
      const buf = Buffer.from(await dlRes.arrayBuffer());
      if (buf.length === 0) throw new Error('Downloaded audio is empty');
      const tmp = destPath + '.tmp';
      await writeFile(tmp, buf);
      const { rename } = await import('fs/promises');
      await rename(tmp, destPath);
    }

    if (audioUrls.length === 0) actualDuration = getAudioDuration(destPath);
    audioUrls.push(`/audio/${filename}`);
  }

  const finalDuration = actualDuration > 0 ? actualDuration : (result.duration || params.duration || 0);

  job.status = 'succeeded';
  job.result = {
    audioUrls,
    duration: finalDuration,
    bpm: result.bpm || params.bpm,
    keyScale: result.key_scale || params.keyScale,
    timeSignature: result.time_signature || params.timeSignature,
    status: 'succeeded',
  };
  job.rawResponse = result;
  console.log(`[HTTP] Job ${jobId}: completed with ${audioUrls.length} audio file(s)`);
}

// ---------------------------------------------------------------------------
// LoRA state (shared with lora.ts route via exported reference)
// ---------------------------------------------------------------------------

export interface LoraState {
  loaded: boolean;
  active: boolean;
  scale: number;
  path: string;
}

export const loraState: LoraState = {
  loaded: false,
  active: false,
  scale: 1.0,
  path: '',
};

// ---------------------------------------------------------------------------
// Job queue
// ---------------------------------------------------------------------------

async function processQueue(): Promise<void> {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (jobQueue.length > 0) {
    const jobId = jobQueue[0];
    const job   = activeJobs.get(jobId);

    if (job?.status === 'queued') {
      try {
        await processGeneration(jobId, job.params, job);
      } catch (err) {
        console.error(`Queue error for ${jobId}:`, err);
      }
    }

    jobQueue.shift();
    jobQueue.forEach((id, idx) => {
      const q = activeJobs.get(id);
      if (q) q.queuePosition = idx + 1;
    });
  }

  isProcessingQueue = false;
}

export async function generateMusicViaAPI(params: GenerationParams): Promise<{ jobId: string }> {
  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  const job: ActiveJob = {
    params,
    startTime: Date.now(),
    status: 'queued',
    queuePosition: jobQueue.length + 1,
  };

  activeJobs.set(jobId, job);
  jobQueue.push(jobId);

  console.log(`Job ${jobId}: queued at position ${job.queuePosition}`);
  processQueue().catch(err => console.error('Queue error:', err));

  return { jobId };
}

// ---------------------------------------------------------------------------
// Core dispatch
// ---------------------------------------------------------------------------

async function processGeneration(
  jobId: string,
  params: GenerationParams,
  job: ActiveJob,
): Promise<void> {
  job.status = 'running';
  job.stage  = 'Starting generation...';

  if ((params.taskType === 'cover' || params.taskType === 'audio2audio') &&
      !params.sourceAudioUrl && !params.audioCodes) {
    job.status = 'failed';
    job.error  = `task_type='${params.taskType}' requires a source audio or audio codes`;
    return;
  }

  try {
    job.stage = 'Generating music...';
    if (useSpawnMode()) {
      await runViaSpawn(jobId, params, job);
    } else {
      await runViaHttp(jobId, params, job);
    }
  } catch (err) {
    console.error(`Job ${jobId} failed:`, err);
    job.status = 'failed';
    job.error  = err instanceof Error ? err.message : 'Generation failed';
  }
}

// ---------------------------------------------------------------------------
// Status / helpers
// ---------------------------------------------------------------------------

export async function getJobStatus(jobId: string): Promise<JobStatus> {
  const job = activeJobs.get(jobId);
  if (!job) return { status: 'failed', error: 'Job not found' };

  if (job.status === 'succeeded') return { status: 'succeeded', result: job.result };
  if (job.status === 'failed')    return { status: 'failed', error: job.error };

  const elapsed = Math.floor((Date.now() - job.startTime) / 1000);

  if (job.status === 'queued') {
    return {
      status: 'queued',
      queuePosition: job.queuePosition,
      etaSeconds: (job.queuePosition || 1) * 180,
    };
  }

  return {
    status: 'running',
    etaSeconds: Math.max(0, 180 - elapsed),
    progress: job.progress,
    stage: job.stage,
  };
}

export function getJobRawResponse(jobId: string): unknown | null {
  return activeJobs.get(jobId)?.rawResponse ?? null;
}

export async function discoverEndpoints(): Promise<unknown> {
  const mode = useSpawnMode() ? 'spawn' : 'http';
  return { provider: 'acestep-cpp', mode, bin: config.acestep.bin, apiUrl: config.acestep.apiUrl };
}

// ---------------------------------------------------------------------------
// Audio helpers
// ---------------------------------------------------------------------------

export async function getAudioStream(audioPath: string): Promise<Response> {
  // Local /audio/<file> path
  if (audioPath.startsWith('/audio/')) {
    const localPath = path.join(AUDIO_DIR, audioPath.replace('/audio/', ''));
    try {
      const buffer = await readFile(localPath);
      const ext = localPath.endsWith('.flac') ? 'flac' : localPath.endsWith('.wav') ? 'wav' : 'mpeg';
      return new Response(buffer, { status: 200, headers: { 'Content-Type': `audio/${ext}` } });
    } catch {
      return new Response(null, { status: 404 });
    }
  }

  // Absolute local path
  if (audioPath.startsWith('/') && existsSync(audioPath)) {
    const buffer = await readFile(audioPath);
    const ext = audioPath.endsWith('.flac') ? 'flac' : audioPath.endsWith('.wav') ? 'wav' : 'mpeg';
    return new Response(buffer, { status: 200, headers: { 'Content-Type': `audio/${ext}` } });
  }

  // Remote URL
  if (audioPath.startsWith('http')) return fetch(audioPath);

  // Fallback: ask the HTTP server
  return fetch(`${config.acestep.apiUrl}/v1/audio?path=${encodeURIComponent(audioPath)}`);
}

export async function downloadAudioToBuffer(url: string): Promise<{ buffer: Buffer; size: number }> {
  const res = await getAudioStream(url);
  if (!res.ok) throw new Error(`Failed to download audio: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { buffer: buf, size: buf.length };
}

export function cleanupJob(jobId: string): void { activeJobs.delete(jobId); }

export function cleanupOldJobs(maxAgeMs = 3600000): void {
  const now = Date.now();
  for (const [id, job] of activeJobs) {
    if (now - job.startTime > maxAgeMs) activeJobs.delete(id);
  }
}
