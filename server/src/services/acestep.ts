/**
 * acestep.ts — Music generation service
 *
 * Primary mode:  spawn `ace-qwen3` (LLM) + `dit-vae` (synthesis) binaries directly
 *                (auto-detected from bin/ or set ACE_QWEN3_BIN / DIT_VAE_BIN in .env)
 *
 * Fallback mode: HTTP calls to a running acestep-cpp server
 *                (set ACESTEP_API_URL in .env when spawn mode binaries are not found)
 */

import { spawn } from 'child_process';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { execFileSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
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

/**
 * Returns true when the spawn-mode binaries satisfy the requirements for
 * the given generation parameters.
 *
 * - Cover/passthrough (sourceAudioUrl or audioCodes): only dit-vae is needed;
 *   ace-qwen3 is skipped because the audio codes come from the source audio.
 * - Text-to-music: both ace-qwen3 (LLM) and dit-vae (synthesis) are required.
 */
function useSpawnMode(params?: Pick<GenerationParams, 'sourceAudioUrl' | 'audioCodes'>): boolean {
  if (!config.acestep.ditVaeBin) return false;
  // Cover / passthrough: only dit-vae is needed — no LLM step
  if (params?.sourceAudioUrl || params?.audioCodes) return true;
  // Text-to-music: need ace-qwen3 too
  return Boolean(config.acestep.lmBin);
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

export async function checkSpaceHealth(): Promise<boolean> {
  if (useSpawnMode()) {
    // Spawn mode: check both binaries exist and are accessible
    return existsSync(config.acestep.lmBin!) && existsSync(config.acestep.ditVaeBin!);
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
// Spawn mode: run these step.cpp binaries in a two-step pipeline
//   Step 1: ace-qwen3  — LLM generates lyrics + audio codes from caption
//   Step 2: dit-vae    — DiT + VAE synthesises stereo 48 kHz WAV
//
// The binaries communicate via a JSON request file placed in a per-job
// temporary directory:
//   <tmpDir>/request.json  → ace-qwen3 → <tmpDir>/request0.json
//   <tmpDir>/request0.json → dit-vae   → <tmpDir>/request00.wav
// ---------------------------------------------------------------------------

/**
 * Parse a space-separated list of extra CLI arguments from an env variable.
 * Supports simple quoting: "hello world" is treated as a single argument.
 * Example: ACE_QWEN3_EXTRA_ARGS="--threads 4" → ['--threads', '4']
 */
function parseExtraArgs(envVar: string | undefined): string[] {
  if (!envVar?.trim()) return [];
  const args: string[] = [];
  const re = /(?:[^\s"']+|"[^"]*"|'[^']*')+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(envVar)) !== null) {
    args.push(m[0].replace(/^["']|["']$/g, ''));
  }
  return args;
}

// Sentinel text emitted by ggml-metal when the device is pre-M5 / pre-A19.
// Seeing this in stderr on a non-zero exit means GPU init failed; we retry
// with -ngl 0 so the binary falls back to CPU-only execution.
const METAL_TENSOR_API_DISABLED_MSG = 'tensor API disabled for pre-M5 and pre-A19 devices';

/** Build a human-readable error message from a failed binary run (max 2000 chars). */
function buildBinaryError(label: string, result: { exitCode: number | null; stdout: string; stderr: string }): Error {
  const msg = (result.stderr || result.stdout || `exit code ${result.exitCode}`).slice(0, 2000);
  return new Error(`${label} failed: ${msg}`);
}

/** Returns true when the args already include a GPU-layers disable flag. */
function hasNglFlag(args: string[]): boolean {
  return args.includes('-ngl') || args.includes('--n-gpu-layers') || args.includes('--ngl');
}

/** Run a binary and return its captured stdout/stderr. Throws on non-zero exit. */
async function runBinary(
  bin: string,
  args: string[],
  label: string,
  env?: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
  const result = await runBinaryOnce(bin, args, label, env);

  // Auto-retry without GPU layers when the Metal tensor API is unavailable
  // (affects Apple Silicon M1–M4 with newer ggml builds).
  // Note: extra args from DIT_VAE_EXTRA_ARGS / ACE_QWEN3_EXTRA_ARGS are already
  // included in `args`, so hasNglFlag() correctly covers user-supplied flags too.
  if (
    result.exitCode !== 0 &&
    result.stderr.includes(METAL_TENSOR_API_DISABLED_MSG) &&
    !hasNglFlag(args)
  ) {
    console.warn(
      `[Spawn] ${label}: Metal tensor API unavailable on this device — retrying with -ngl 0 (CPU-only)`,
    );
    const retry = await runBinaryOnce(bin, ['-ngl', '0', ...args], label, env);
    if (retry.exitCode !== 0) throw buildBinaryError(label, retry);
    return { stdout: retry.stdout, stderr: retry.stderr };
  }

  if (result.exitCode !== 0) throw buildBinaryError(label, result);

  return { stdout: result.stdout, stderr: result.stderr };
}

/** Internal: spawn once and collect output. Never throws on non-zero exit. */
function runBinaryOnce(
  bin: string,
  args: string[],
  label: string,
  env?: NodeJS.ProcessEnv,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, {
      shell: false,
      env:   { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('close', (code) => resolve({ exitCode: code, stdout, stderr }));
    proc.on('error', (err) => reject(new Error(`${label} process error: ${err.message}`)));
  });
}

async function runViaSpawn(
  jobId: string,
  params: GenerationParams,
  job: ActiveJob,
): Promise<void> {
  await mkdir(AUDIO_DIR, { recursive: true });

  const tmpDir = path.join(AUDIO_DIR, `_tmp_${jobId}`);
  await mkdir(tmpDir, { recursive: true });

  try {
    // ── Build request.json ─────────────────────────────────────────────────
    // ace-qwen3 reads generation parameters from a JSON file. Only `caption`
    // is strictly required; all other fields default to sensible values.
    const caption = params.style || 'pop music';
    const prompt  = params.customMode ? caption : (params.songDescription || caption);
    // Instrumental: pass the special "[Instrumental]" lyrics string so the LLM
    // skips lyrics generation (as documented in the acestep.cpp README).
    const lyrics  = params.instrumental ? '[Instrumental]' : (params.lyrics || '');

    const requestJson: Record<string, unknown> = {
      caption: prompt,
      lyrics,
      vocal_language:    params.vocalLanguage    || 'unknown',
      seed:              params.randomSeed !== false ? -1 : (params.seed ?? -1),
      lm_temperature:    params.lmTemperature    ?? 0.85,
      lm_cfg_scale:      params.lmCfgScale       ?? 2.0,
      lm_top_p:          params.lmTopP           ?? 0.9,
      lm_top_k:          params.lmTopK           ?? 0,
      lm_negative_prompt: params.lmNegativePrompt || '',
      inference_steps:   params.inferenceSteps   ?? 8,
      guidance_scale:    params.guidanceScale     ?? 0.0,
      shift:             params.shift             ?? 3.0,
    };
    // Optional metadata (0 / empty = let the LLM fill it)
    if (params.bpm && params.bpm > 0)     requestJson.bpm           = params.bpm;
    if (params.duration && params.duration > 0) requestJson.duration = params.duration;
    if (params.keyScale)                  requestJson.keyscale      = params.keyScale;
    if (params.timeSignature)             requestJson.timesignature = params.timeSignature;
    // Passthrough: skip the LLM when audio codes are already provided
    if (params.audioCodes)                requestJson.audio_codes   = params.audioCodes;
    // Cover/audio-to-audio: strength of the source audio influence on the output
    if (params.audioCoverStrength !== undefined) requestJson.audio_cover_strength = params.audioCoverStrength;

    const requestPath = path.join(tmpDir, 'request.json');
    await writeFile(requestPath, JSON.stringify(requestJson, null, 2));

    // ── Step 1: ace-qwen3 — LLM (lyrics + audio codes) ────────────────────
    // Skipped when:
    //   • audio_codes are provided (passthrough) — codes are already known
    //   • sourceAudioUrl is provided (cover/audio-to-audio) — dit-vae derives
    //     codes directly from the source audio; running ace-qwen3 is not needed
    let enrichedPaths: string[] = [];

    if (!params.audioCodes && !params.sourceAudioUrl) {
      job.stage = 'LLM: generating lyrics and audio codes…';

      const lmBin   = config.acestep.lmBin!;
      const lmModel = config.acestep.lmModel;
      if (!lmModel) throw new Error('LM model not found — run models.sh first');

      const lmArgs: string[] = ['--request', requestPath, '--model', lmModel];

      const batchSize = Math.min(Math.max(params.batchSize ?? 1, 1), 8);
      if (batchSize > 1) lmArgs.push('--batch', String(batchSize));
      lmArgs.push(...parseExtraArgs(process.env.ACE_QWEN3_EXTRA_ARGS));

      console.log(`[Spawn] Job ${jobId}: ace-qwen3 ${lmArgs.slice(0, 6).join(' ')} …`);
      await runBinary(lmBin, lmArgs, 'ace-qwen3');

      // Collect enriched JSON files produced by ace-qwen3:
      // request.json → request0.json [, request1.json, …] (placed alongside request.json)
      try {
        enrichedPaths = readdirSync(tmpDir)
          .filter(f => /^request\d+\.json$/.test(f))
          .sort()
          .map(f => path.join(tmpDir, f));
      } catch { /* ignore */ }

      if (enrichedPaths.length === 0) {
        throw new Error('ace-qwen3 produced no enriched request files');
      }
    } else {
      // Passthrough: use the original request.json directly
      // (audio codes provided, or source audio supplied for cover/audio-to-audio mode)
      enrichedPaths = [requestPath];
    }

    // ── Step 2: dit-vae — DiT + VAE (audio synthesis) ──────────────────────
    job.stage = 'DiT+VAE: synthesising audio…';

    const ditVaeBin          = config.acestep.ditVaeBin!;
    const textEncoderModel   = config.acestep.textEncoderModel;
    const ditModel           = params.ditModel ? params.ditModel : config.acestep.ditModel;
    const vaeModel           = config.acestep.vaeModel;

    if (!textEncoderModel) throw new Error('Text-encoder model not found — run models.sh first');
    if (!ditModel)         throw new Error('DiT model not found — run models.sh first');
    if (!vaeModel)         throw new Error('VAE model not found — run models.sh first');

    const ditArgs: string[] = [
      '--request',      ...enrichedPaths,
      '--text-encoder', textEncoderModel,
      '--dit',          ditModel,
      '--vae',          vaeModel,
    ];

    const batchSize = Math.min(Math.max(params.batchSize ?? 1, 1), 8);
    if (batchSize > 1) ditArgs.push('--batch', String(batchSize));

    if (params.referenceAudioUrl)  ditArgs.push('--reference-audio', resolveAudioPath(params.referenceAudioUrl));
    if (params.sourceAudioUrl)     ditArgs.push('--src-audio',       resolveAudioPath(params.sourceAudioUrl));
    if (params.repaintingStart && params.repaintingStart > 0)
                                   ditArgs.push('--repainting-start', String(params.repaintingStart));
    if (params.repaintingEnd && params.repaintingEnd > 0)
                                   ditArgs.push('--repainting-end',   String(params.repaintingEnd));
    ditArgs.push(...parseExtraArgs(process.env.DIT_VAE_EXTRA_ARGS));

    console.log(`[Spawn] Job ${jobId}: dit-vae ${ditArgs.slice(0, 6).join(' ')} …`);
    await runBinary(ditVaeBin, ditArgs, 'dit-vae');

    // ── Collect generated WAV files ─────────────────────────────────────────
    // dit-vae places output WAVs alongside each enriched JSON:
    //   request0.json → request00.wav, request01.wav, …
    //   request1.json → request10.wav, request11.wav, …
    const { copyFile, rm } = await import('fs/promises');
    let rawAudioPaths: string[] = [];
    try {
      rawAudioPaths = readdirSync(tmpDir)
        .filter(f => /^request\d+\.wav$/.test(f))
        .sort()
        .map(f => path.join(tmpDir, f));
    } catch { /* ignore */ }

    if (rawAudioPaths.length === 0) {
      throw new Error('dit-vae produced no audio files');
    }

    // Move WAVs to AUDIO_DIR with a stable, job-scoped name
    const audioPaths: string[] = [];
    for (let i = 0; i < rawAudioPaths.length; i++) {
      const dest = path.join(AUDIO_DIR, `${jobId}_${i}.wav`);
      await copyFile(rawAudioPaths[i], dest);
      audioPaths.push(dest);
    }

    // Read metadata from the first enriched JSON (bpm, key, duration, etc.)
    let enrichedMeta: { bpm?: number; keyscale?: string; timesignature?: string; duration?: number } = {};
    try {
      const text = await (await import('fs/promises')).readFile(enrichedPaths[0], 'utf-8');
      enrichedMeta = JSON.parse(text);
    } catch { /* optional */ }

    const audioUrls   = audioPaths.map(p => `/audio/${path.relative(AUDIO_DIR, p)}`);
    const actualDur   = getAudioDuration(audioPaths[0]);
    const finalDur    = actualDur > 0 ? actualDur : (enrichedMeta.duration ?? params.duration ?? 0);

    job.status = 'succeeded';
    job.result = {
      audioUrls,
      duration:      finalDur,
      bpm:           enrichedMeta.bpm           || params.bpm,
      keyScale:      enrichedMeta.keyscale      || params.keyScale,
      timeSignature: enrichedMeta.timesignature || params.timeSignature,
      status: 'succeeded',
    };
    job.rawResponse = enrichedMeta;
    console.log(`[Spawn] Job ${jobId}: completed with ${audioUrls.length} audio file(s)`);

    // Clean up tmp directory
    await rm(tmpDir, { recursive: true, force: true }).catch(() => { /* best-effort */ });

  } catch (err) {
    // Best-effort cleanup on failure
    try {
      const { rm } = await import('fs/promises');
      await rm(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
    throw err;
  }
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
    if (useSpawnMode(params)) {
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
  return {
    provider: 'acestep-cpp',
    mode,
    lmBin:    config.acestep.lmBin,
    ditVaeBin: config.acestep.ditVaeBin,
    apiUrl:   config.acestep.apiUrl,
  };
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
