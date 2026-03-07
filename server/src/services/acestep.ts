import { writeFile, mkdir, readFile } from 'fs/promises';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUDIO_DIR = path.join(__dirname, '../../public/audio');

const ACESTEP_API = config.acestep.apiUrl;

// Get audio duration using ffprobe
function getAudioDuration(filePath: string): number {
  try {
    const result = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    const duration = parseFloat(result.trim());
    return isNaN(duration) ? 0 : Math.round(duration);
  } catch (error) {
    console.warn('Failed to get audio duration:', error);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------

export interface GenerationParams {
  // Mode
  customMode: boolean;

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
  enhance?: boolean;
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

// Periodic cleanup of old jobs (every 10 minutes, remove jobs older than 1 hour)
setInterval(() => cleanupOldJobs(3600000), 600000);

// Job queue for sequential processing (GPU can only handle one job at a time)
const jobQueue: string[] = [];
let isProcessingQueue = false;

// ---------------------------------------------------------------------------
// Health check — verify acestep-cpp server is reachable
// ---------------------------------------------------------------------------

export async function checkSpaceHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${ACESTEP_API}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Resolve an audio URL to an absolute local file path
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
// Build the JSON request body for the acestep-cpp /v1/generate endpoint
// ---------------------------------------------------------------------------

function buildGenerateRequest(params: GenerationParams): Record<string, unknown> {
  const caption = params.style || 'pop music';
  const prompt = params.customMode ? caption : (params.songDescription || caption);
  const lyrics = params.instrumental ? '' : (params.lyrics || '');
  const isThinking = params.thinking ?? false;
  const isEnhance = params.enhance ?? false;
  const useCot = isEnhance || isThinking;
  const taskType = params.taskType === 'audio2audio' ? 'cover' : (params.taskType || 'text2music');

  const body: Record<string, unknown> = {
    prompt,
    lyrics,
    instrumental: params.instrumental ?? false,
    duration: params.duration && params.duration > 0 ? params.duration : -1,
    bpm: params.bpm && params.bpm > 0 ? params.bpm : 0,
    key_scale: params.keyScale || '',
    time_signature: params.timeSignature || '',
    vocal_language: params.vocalLanguage || 'en',
    infer_steps: params.inferenceSteps ?? 8,
    guidance_scale: params.guidanceScale ?? 7.0,
    batch_size: Math.min(Math.max(params.batchSize ?? 1, 1), 16),
    seed: params.randomSeed !== false ? -1 : (params.seed ?? -1),
    audio_format: params.audioFormat || 'mp3',
    shift: params.shift ?? 3.0,
    infer_method: params.inferMethod || 'ode',
    task_type: taskType,
    audio_cover_strength: params.audioCoverStrength ?? 1.0,
    instruction: params.instruction || 'Fill the audio semantic mask with the style described in the text prompt.',
    thinking: isThinking,
    lm_temperature: params.lmTemperature ?? 0.85,
    lm_cfg_scale: params.lmCfgScale ?? 2.0,
    lm_top_k: params.lmTopK ?? 0,
    lm_top_p: params.lmTopP ?? 0.9,
    lm_negative_prompt: params.lmNegativePrompt || 'NO USER INPUT',
    use_cot_metas: useCot ? (params.useCotMetas ?? true) : false,
    use_cot_caption: useCot ? (params.useCotCaption ?? true) : false,
    use_cot_language: useCot ? (params.useCotLanguage ?? true) : false,
    use_adg: params.useAdg ?? false,
    cfg_interval_start: params.cfgIntervalStart ?? 0.0,
    cfg_interval_end: params.cfgIntervalEnd ?? 1.0,
    audio_codes: params.audioCodes || '',
    repainting_start: params.repaintingStart ?? 0.0,
    repainting_end: params.repaintingEnd ?? -1,
    autogen: params.autogen ?? false,
  };

  // Reference / source audio: resolve to absolute local path for the C++ server
  if (params.referenceAudioUrl) {
    body.reference_audio = resolveAudioPath(params.referenceAudioUrl);
  }
  if (params.sourceAudioUrl) {
    body.src_audio = resolveAudioPath(params.sourceAudioUrl);
  }

  // Model selection
  if (params.ditModel) {
    body.dit_model = params.ditModel;
  }

  return body;
}

// ---------------------------------------------------------------------------
// Download a generated audio file from the acestep-cpp server
// ---------------------------------------------------------------------------

async function downloadGeneratedAudio(
  remotePathOrUrl: string,
  destPath: string,
): Promise<void> {
  await mkdir(path.dirname(destPath), { recursive: true });

  // If the path is a local absolute path accessible to this process, copy directly
  if (remotePathOrUrl.startsWith('/') && existsSync(remotePathOrUrl)) {
    const { copyFile } = await import('fs/promises');
    await copyFile(remotePathOrUrl, destPath);
    return;
  }

  // Download from the acestep-cpp server
  const url = remotePathOrUrl.startsWith('http')
    ? remotePathOrUrl
    : `${ACESTEP_API}/v1/audio?path=${encodeURIComponent(remotePathOrUrl)}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download audio from ${url}: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) {
    throw new Error('Downloaded audio file is empty');
  }
  const tmpPath = destPath + '.tmp';
  await writeFile(tmpPath, buffer);
  const { rename } = await import('fs/promises');
  await rename(tmpPath, destPath);
}

// ---------------------------------------------------------------------------
// Model switching — call /v1/init to change the active DiT model
// ---------------------------------------------------------------------------

async function getActiveModel(): Promise<string | null> {
  try {
    const res = await fetch(`${ACESTEP_API}/v1/models`);
    if (!res.ok) return null;
    const data = await res.json() as any;
    // Support both { models: [...] } (acestep-cpp) and { data: { models: [...] } } (legacy Gradio shape)
    const models = data?.models || data?.data?.models || [];
    return models[0]?.name || null;
  } catch {
    return null;
  }
}

async function switchModelIfNeeded(ditModel: string): Promise<void> {
  const activeModel = await getActiveModel();
  if (activeModel === ditModel) return;

  console.log(`[Model] Switching from '${activeModel ?? 'unknown'}' to '${ditModel}'`);
  const res = await fetch(`${ACESTEP_API}/v1/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: ditModel }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Model switch to '${ditModel}' failed: ${res.status} ${err}`);
  }
  console.log(`[Model] Switched to '${ditModel}'`);
}

// Discover endpoints (for compatibility)
export async function discoverEndpoints(): Promise<unknown> {
  return { provider: 'acestep-cpp', endpoint: ACESTEP_API };
}

// ---------------------------------------------------------------------------
// Job queue
// ---------------------------------------------------------------------------

async function processQueue(): Promise<void> {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (jobQueue.length > 0) {
    const jobId = jobQueue[0];
    const job = activeJobs.get(jobId);

    if (job && job.status === 'queued') {
      try {
        await processGeneration(jobId, job.params, job);
      } catch (error) {
        console.error(`Queue processing error for ${jobId}:`, error);
      }
    }

    jobQueue.shift();

    jobQueue.forEach((id, index) => {
      const queuedJob = activeJobs.get(id);
      if (queuedJob) {
        queuedJob.queuePosition = index + 1;
      }
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

  console.log(`Job ${jobId}: Queued at position ${job.queuePosition}`);

  processQueue().catch(err => console.error('Queue processing error:', err));

  return { jobId };
}

// ---------------------------------------------------------------------------
// processGeneration — calls acestep-cpp POST /v1/generate
// ---------------------------------------------------------------------------

async function processGeneration(
  jobId: string,
  params: GenerationParams,
  job: ActiveJob,
): Promise<void> {
  job.status = 'running';
  job.stage = 'Starting generation...';

  // Guard: cover/audio2audio requires source audio or audio codes
  if ((params.taskType === 'cover' || params.taskType === 'audio2audio') &&
      !params.sourceAudioUrl && !params.audioCodes) {
    job.status = 'failed';
    job.error = `task_type='${params.taskType}' requires a source audio or audio codes`;
    return;
  }

  try {
    await processGenerationViaCpp(jobId, params, job);
  } catch (error) {
    console.error(`Job ${jobId}: Generation failed`, error);
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : 'Generation failed';
  }
}

async function processGenerationViaCpp(
  jobId: string,
  params: GenerationParams,
  job: ActiveJob,
): Promise<void> {
  // Switch DiT model if a specific one was requested
  if (params.ditModel) {
    job.stage = `Loading model ${params.ditModel}...`;
    await switchModelIfNeeded(params.ditModel);
  }

  const requestBody = buildGenerateRequest(params);

  const caption = params.style || 'pop music';
  const prompt = params.customMode ? caption : (params.songDescription || caption);

  console.log(`Job ${jobId}: Calling acestep-cpp /v1/generate`, {
    prompt: prompt.slice(0, 50),
    duration: params.duration,
    batchSize: params.batchSize,
  });

  job.stage = 'Generating music...';

  // POST to acestep-cpp — the C++ server handles its own internal queue
  const response = await fetch(`${ACESTEP_API}/v1/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(900_000), // 15 min max
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => `HTTP ${response.status}`);
    throw new Error(`acestep-cpp generation failed: ${response.status} ${errText}`);
  }

  const result = await response.json() as {
    audio_paths?: string[];
    bpm?: number;
    key_scale?: string;
    time_signature?: string;
    duration?: number;
    error?: string;
  };

  if (result.error) {
    throw new Error(`acestep-cpp error: ${result.error}`);
  }

  if (!result.audio_paths || result.audio_paths.length === 0) {
    throw new Error('acestep-cpp returned no audio files');
  }

  job.stage = 'Saving audio files...';

  const audioUrls: string[] = [];
  let actualDuration = 0;
  const audioFormat = params.audioFormat ?? 'mp3';

  await mkdir(AUDIO_DIR, { recursive: true });

  for (const remotePath of result.audio_paths) {
    const ext = remotePath.endsWith('.flac') ? '.flac' : `.${audioFormat}`;
    const filename = `${jobId}_${audioUrls.length}${ext}`;
    const destPath = path.join(AUDIO_DIR, filename);

    await downloadGeneratedAudio(remotePath, destPath);

    if (audioUrls.length === 0) {
      actualDuration = getAudioDuration(destPath);
    }

    audioUrls.push(`/audio/${filename}`);
  }

  const finalDuration = actualDuration > 0
    ? actualDuration
    : (result.duration || params.duration || 0);

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
  console.log(`Job ${jobId}: Completed via acestep-cpp with ${audioUrls.length} audio files`);
}

// ---------------------------------------------------------------------------
// Job status
// ---------------------------------------------------------------------------

export async function getJobStatus(jobId: string): Promise<JobStatus> {
  const job = activeJobs.get(jobId);

  if (!job) {
    return { status: 'failed', error: 'Job not found' };
  }

  if (job.status === 'succeeded' && job.result) {
    return { status: 'succeeded', result: job.result };
  }

  if (job.status === 'failed') {
    return { status: 'failed', error: job.error || 'Generation failed' };
  }

  const elapsed = Math.floor((Date.now() - job.startTime) / 1000);

  if (job.status === 'queued') {
    return {
      status: 'queued',
      queuePosition: job.queuePosition,
      etaSeconds: (job.queuePosition || 1) * 180,
    };
  }

  return {
    status: job.status as 'running',
    etaSeconds: Math.max(0, 180 - elapsed),
    progress: job.progress,
    stage: job.stage,
  };
}

export function getJobRawResponse(jobId: string): unknown | null {
  const job = activeJobs.get(jobId);
  return job?.rawResponse || null;
}

// ---------------------------------------------------------------------------
// Audio helpers
// ---------------------------------------------------------------------------

export async function getAudioStream(audioPath: string): Promise<Response> {
  if (audioPath.startsWith('http')) {
    return fetch(audioPath);
  }

  if (audioPath.startsWith('/audio/')) {
    const localPath = path.join(AUDIO_DIR, audioPath.replace('/audio/', ''));
    try {
      const buffer = await readFile(localPath);
      const ext = localPath.endsWith('.flac') ? 'flac' : localPath.endsWith('.wav') ? 'wav' : 'mpeg';
      return new Response(buffer, {
        status: 200,
        headers: { 'Content-Type': `audio/${ext}` }
      });
    } catch (err) {
      console.error('Failed to read local audio file:', localPath, err);
      return new Response(null, { status: 404 });
    }
  }

  // Absolute path — try reading directly from disk
  if (audioPath.startsWith('/')) {
    try {
      const buffer = await readFile(audioPath);
      const ext = audioPath.endsWith('.flac') ? 'flac' : audioPath.endsWith('.wav') ? 'wav' : 'mpeg';
      return new Response(buffer, {
        status: 200,
        headers: { 'Content-Type': `audio/${ext}` }
      });
    } catch {
      // Fall through
    }
  }

  const url = `${ACESTEP_API}/v1/audio?path=${encodeURIComponent(audioPath)}`;
  return fetch(url);
}

export async function downloadAudioToBuffer(remoteUrl: string): Promise<{ buffer: Buffer; size: number }> {
  const response = await getAudioStream(remoteUrl);
  if (!response.ok) {
    throw new Error(`Failed to download audio: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  return { buffer, size: buffer.length };
}

export function cleanupJob(jobId: string): void {
  activeJobs.delete(jobId);
}

export function cleanupOldJobs(maxAgeMs: number = 3600000): void {
  const now = Date.now();
  for (const [jobId, job] of activeJobs) {
    if (now - job.startTime > maxAgeMs) {
      activeJobs.delete(jobId);
    }
  }
}
