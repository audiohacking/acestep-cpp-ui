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
import { writeFile, mkdir, readFile, mkdtemp, rm } from 'fs/promises';
import { execFileSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
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
 * - Cover/repaint/passthrough (sourceAudioUrl or audioCodes): only dit-vae is needed;
 *   ace-qwen3 is skipped because the audio is derived from the source audio or codes.
 * - Text-to-music: both ace-qwen3 (LLM) and dit-vae (synthesis) are required.
 */
function useSpawnMode(params?: Pick<GenerationParams, 'sourceAudioUrl' | 'audioCodes'>): boolean {
  if (!config.acestep.ditVaeBin) return false;
  // Cover / repaint / passthrough: only dit-vae is needed — no LLM step
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
// Model name → full path resolution
// ---------------------------------------------------------------------------

/**
 * Resolves a DiT model name sent by the frontend into an absolute file path.
 *
 * The UI only knows model names (e.g. "acestep-v15-turbo-Q8_0" or
 * "acestep-v15-turbo-shift3"). The backend owns the model directory and is
 * solely responsible for turning that name into a real path:
 *
 *   1. No name supplied → use the default from config (auto-detected or env).
 *   2. Already an absolute path → pass through unchanged.
 *   3. Exact filename match: look for "<name>.gguf" in the models dir.
 *   4. Prefix match: find any gguf whose name starts with "<name>-", preferring
 *      Q8_0 → Q6_K → Q5_K_M → Q4_K_M → BF16.
 *   5. Nothing found → fall back to the configured default.
 */
function resolveParamDitModel(name: string | undefined): string {
  if (!name) return config.acestep.ditModel;
  if (path.isAbsolute(name)) return name;

  const modelsDir = config.models.dir;
  if (existsSync(modelsDir)) {
    // Exact filename match (e.g. "acestep-v15-turbo-Q8_0" → "…Q8_0.gguf")
    const exact = path.join(modelsDir, `${name}.gguf`);
    if (existsSync(exact)) return exact;

    // Prefix match for variant names without quantization suffix
    try {
      const files = readdirSync(modelsDir).filter(
        f => f.endsWith('.gguf') && !f.endsWith('.part') && f.startsWith(`${name}-`),
      );
      if (files.length > 0) {
        const quants = ['Q8_0', 'Q6_K', 'Q5_K_M', 'Q4_K_M', 'BF16'];
        for (const q of quants) {
          const match = files.find(f => f === `${name}-${q}.gguf`);
          if (match) return path.join(modelsDir, match);
        }
        return path.join(modelsDir, files[0]);
      }
    } catch { /* ignore read errors */ }
  }

  return config.acestep.ditModel;
}

// ---------------------------------------------------------------------------
// Audio path resolution (for reference/source audio inputs)
// ---------------------------------------------------------------------------

/**
 * Resolves a UI audio URL (e.g. "/audio/reference-tracks/user/file.mp3") or
 * an absolute filesystem path to the local filesystem path that the spawned
 * binary can open.
 *
 * Supported input formats:
 *  • "/audio/<rest>"           — relative public URL; joined with AUDIO_DIR
 *                                (covers reference-tracks/, generated songs, etc.)
 *  • "http[s]://host/audio/…"  — absolute URL whose path starts with /audio/
 *  • Any other absolute path   — returned as-is
 */
function resolveAudioPath(audioUrl: string): string {
  // Relative public URL produced by the UI player or upload endpoint
  if (audioUrl.startsWith('/audio/')) {
    const resolved = path.join(AUDIO_DIR, audioUrl.slice('/audio/'.length));
    console.log(`[resolveAudio] ${audioUrl} → ${resolved}`);
    return resolved;
  }
  // Full HTTP URL — extract the path component and try again
  if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://')) {
    try {
      const parsed = new URL(audioUrl);
      if (parsed.pathname.startsWith('/audio/')) {
        const resolved = path.join(AUDIO_DIR, parsed.pathname.slice('/audio/'.length));
        console.log(`[resolveAudio] ${audioUrl} → ${resolved}`);
        return resolved;
      }
    } catch { /* fall through */ }
  }
  // Already an absolute filesystem path — pass through
  console.log(`[resolveAudio] ${audioUrl} → (absolute path, no change)`);
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

/** Build a human-readable error message from a failed binary run (max 2000 chars). */
function buildBinaryError(label: string, result: { exitCode: number | null; stdout: string; stderr: string }): Error {
  const msg = (result.stderr || result.stdout || `exit code ${result.exitCode}`).slice(0, 2000);
  return new Error(`${label} failed: ${msg}`);
}

/**
 * Run a binary, streaming stderr lines to an optional callback, and return
 * captured output. Throws with a detailed message on non-zero exit.
 */
function runBinary(
  bin: string,
  args: string[],
  label: string,
  env?: NodeJS.ProcessEnv,
  onLine?: (line: string) => void,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, {
      shell: false,
      env:   { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let lineBuf = '';

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      lineBuf += text;
      const lines = lineBuf.split('\n');
      lineBuf = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && onLine) onLine(trimmed);
      }
    });

    proc.on('close', (code) => {
      // Flush any partial last line that didn't end with a newline
      if (lineBuf.trim() && onLine) onLine(lineBuf.trim());
      lineBuf = '';

      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        // Always log the full binary output on failure so the error is visible
        console.error(`[${label}] exited with code ${code ?? 'null (terminated by signal)'}`);
        if (stderr) console.error(`[${label}] stderr:\n${stderr}`);
        if (stdout) console.error(`[${label}] stdout:\n${stdout}`);
        reject(buildBinaryError(label, { exitCode: code, stdout, stderr }));
      }
    });
    proc.on('error', (err) => reject(new Error(`${label} process error: ${err.message}`)));
  });
}

// ---------------------------------------------------------------------------
// Live progress parsing — translates binary stderr lines into job.stage /
// job.progress updates that the polling API can return to the frontend.
//
// ace-qwen3 progress lines (all on stderr):
//   [Phase1] step 100, 1 active, 19.0 tok/s   — lyrics LM decode
//   [Phase1] Decode 15871ms                    — Phase1 complete
//   [Phase2] max_tokens: 800, …               — captures audio-codes budget
//   [Decode] step 50, 1 active, 51 total codes, 20.1 tok/s — audio LM decode
//
// dit-vae progress lines (all on stderr):
//   [DiT] Starting: T=…, steps=8, …           — captures DiT step count
//   [DiT] step 1/8 t=1.000                    — DiT diffusion step N/M
//   [DiT] Total generation: …                 — DiT complete
//   [VAE] Tiled decode: 28 tiles …            — VAE starting
//   [VAE] Tiled decode done: 28 tiles → …    — VAE complete
//
// Progress scale:  0–50% ace-qwen3 | 50–100% dit-vae
// ---------------------------------------------------------------------------

// Progress budget across the two-binary pipeline (must sum to 100):
//   0–30%   ace-qwen3 Phase1  (lyrics LM decode — step count varies, ~200–400)
//  30–50%   ace-qwen3 Phase2  (audio-codes LM decode)
//  50–85%   dit-vae DiT       (diffusion steps — exact N/M known at runtime)
//  85–100%  dit-vae VAE       (tiled audio decode)
const PROGRESS_LM_PHASE1_MAX   = 30;  // % at end of Phase1
const PROGRESS_LM_PHASE2_END   = 50;  // % at end of Phase2 (= start of dit-vae)
const PROGRESS_DIT_END         = 85;  // % at end of DiT diffusion
const PROGRESS_VAE_END         = 98;  // % at end of VAE decode (100 set on job success)

/**
 * Returns an onLine callback for ace-qwen3 stderr that updates job.stage and
 * job.progress as the LM pipeline progresses (contributes 0–50% overall).
 */
function makeLmProgressHandler(job: ActiveJob): (line: string) => void {
  let phase2MaxTokens = 800;
  // Phase1 step ceiling: ace-qwen3 typically produces 200–350 lyrics tokens.
  // 400 is a generous upper bound so the bar reaches ~28% by the end of Phase1.
  const PHASE1_STEP_CEIL = 400;

  return (line: string) => {
    // Phase1 LM decode: "[Phase1] step 100, 1 active, 19.0 tok/s"
    const p1 = line.match(/^\[Phase1\] step (\d+),.*?([\d.]+) tok\/s/);
    if (p1) {
      const step = parseInt(p1[1], 10);
      const rate = p1[2];
      job.progress = Math.min(PROGRESS_LM_PHASE1_MAX - 2, Math.round((step / PHASE1_STEP_CEIL) * (PROGRESS_LM_PHASE1_MAX - 2)));
      job.stage    = `LLM: generating lyrics — step ${step} (${rate} tok/s)`;
      return;
    }
    // Phase1 done: "[Phase1] Decode 15871ms"
    if (/^\[Phase1\] Decode/.test(line)) {
      job.progress = PROGRESS_LM_PHASE1_MAX;
      job.stage    = 'LLM: lyrics complete — generating audio codes…';
      return;
    }
    // Phase2 max tokens: "[Phase2] max_tokens: 800, …"
    const p2m = line.match(/^\[Phase2\] max_tokens:\s*(\d+)/);
    if (p2m) {
      phase2MaxTokens = parseInt(p2m[1], 10) || 800;
      return;
    }
    // Phase2 audio-codes decode: "[Decode] step 50, 1 active, 51 total codes, 20.1 tok/s"
    const p2d = line.match(/^\[Decode\] step \d+,.*?(\d+) total codes,.*?([\d.]+) tok\/s/);
    if (p2d) {
      const codes = parseInt(p2d[1], 10);
      const rate  = p2d[2];
      const phase2Range = PROGRESS_LM_PHASE2_END - PROGRESS_LM_PHASE1_MAX;
      job.progress = PROGRESS_LM_PHASE1_MAX + Math.min(phase2Range, Math.round((codes / phase2MaxTokens) * phase2Range));
      job.stage    = `LLM: audio codes — ${codes}/${phase2MaxTokens} (${rate} tok/s)`;
      return;
    }
    // Any unrecognized line — log it so binary errors/warnings are always visible
    console.log(`[ace-qwen3] ${line}`);
  };
}

/**
 * Returns an onLine callback for dit-vae stderr that updates job.stage and
 * job.progress as the DiT+VAE pipeline progresses (contributes 50–100% overall).
 */
function makeDitVaeProgressHandler(job: ActiveJob): (line: string) => void {
  let ditTotalSteps = 8;

  return (line: string) => {
    // DiT starting — capture step count: "[DiT] Starting: T=3470, S=1735, …, steps=8, …"
    const ditStart = line.match(/^\[DiT\] Starting:.*?steps=(\d+)/);
    if (ditStart) {
      ditTotalSteps = parseInt(ditStart[1], 10) || 8;
      return;
    }
    // DiT step: "[DiT] step 1/8 t=1.000"
    const ditStep = line.match(/^\[DiT\] step (\d+)\/(\d+)/);
    if (ditStep) {
      const step  = parseInt(ditStep[1], 10);
      const total = parseInt(ditStep[2], 10);
      ditTotalSteps = total;
      const ditRange = PROGRESS_DIT_END - PROGRESS_LM_PHASE2_END;
      job.progress = PROGRESS_LM_PHASE2_END + Math.round((step / total) * ditRange);
      job.stage    = `DiT: step ${step}/${total}`;
      return;
    }
    // DiT complete: "[DiT] Total generation: 16200.0 ms …"
    if (/^\[DiT\] Total generation/.test(line)) {
      job.progress = PROGRESS_DIT_END;
      job.stage    = 'VAE: decoding audio…';
      return;
    }
    // VAE starting: "[VAE] Tiled decode: 28 tiles (chunk=256, overlap=64, stride=128)"
    const vaeStart = line.match(/^\[VAE\] Tiled decode:\s*(\d+) tiles/);
    if (vaeStart) {
      job.progress = PROGRESS_DIT_END;
      job.stage    = `VAE: decoding ${vaeStart[1]} tiles…`;
      return;
    }
    // VAE done: "[VAE] Tiled decode done: 28 tiles → T_audio=…"
    if (/^\[VAE\] Tiled decode done/.test(line)) {
      job.progress = PROGRESS_VAE_END;
      job.stage    = 'VAE: decode complete — writing audio…';
      return;
    }
    // Any unrecognized line — log it so binary errors/warnings are always visible
    console.log(`[dit-vae] ${line}`);
  };
}

async function runViaSpawn(
  jobId: string,
  params: GenerationParams,
  job: ActiveJob,
): Promise<void> {
  await mkdir(AUDIO_DIR, { recursive: true });

  const tmpDir = path.join(AUDIO_DIR, `_tmp_${jobId}`);
  await mkdir(tmpDir, { recursive: true });

  // ── Determine generation mode ────────────────────────────────────────────
  // Explicit task type drives mode selection; source audio / audio codes act
  // as secondary signals for backward compatibility.
  const taskType    = params.taskType || 'text2music';
  const isCover     = taskType === 'cover' || taskType === 'audio2audio';
  const isRepaint   = taskType === 'repaint';
  const isLego      = taskType === 'lego';
  // Passthrough: taskType explicitly set, or audio codes provided without
  // a source audio file (legacy callers that omit the taskType field).
  const isPassthru  = taskType === 'passthrough' || Boolean(params.audioCodes && !params.sourceAudioUrl);
  // LLM (ace-qwen3) is only needed for plain text-to-music generation.
  // Cover, repaint, lego, and passthrough all skip it.
  const skipLm      = isCover || isRepaint || isLego || isPassthru;

  // ── Debug: log what the UI/API client requested ──────────────────────────
  console.log(
    `[Job ${jobId}] Request received:` +
    `\n  mode          = ${taskType}` +
    `\n  customMode    = ${params.customMode}` +
    `\n  ditModel      = ${params.ditModel || '(default)'}` +
    `\n  sourceAudio   = ${params.sourceAudioUrl || 'none'}` +
    `\n  repaintRegion = [${params.repaintingStart ?? 'start'}, ${params.repaintingEnd ?? 'end'}]` +
    `\n  coverStrength = ${params.audioCoverStrength ?? 'n/a'}` +
    `\n  steps         = ${params.inferenceSteps ?? 8}` +
    `\n  guidance      = ${params.guidanceScale ?? 0.0}` +
    `\n  shift         = ${params.shift ?? 3.0}` +
    `\n  skipLm        = ${skipLm}` +
    `\n  lora          = ${loraState.loaded && loraState.active ? loraState.path : 'none'}` +
    `\n  loraScale     = ${loraState.loaded && loraState.active ? loraState.scale : 'n/a'}`
  );

  try {
    // ── Build request.json ─────────────────────────────────────────────────
    // The JSON file is read by ace-qwen3 (text2music) or dit-vae directly
    // (cover / repaint / passthrough).  Only include the fields each binary
    // actually understands so the format stays clean and predictable.
    const caption = params.style || 'pop music';
    const prompt  = params.customMode ? caption : (params.songDescription || caption);
    // Instrumental: pass the special "[Instrumental]" lyrics marker so the LLM
    // skips lyrics generation (as documented in the acestep.cpp README).
    const lyrics  = params.instrumental ? '[Instrumental]' : (params.lyrics || '');

    // Fields common to all modes (understood by both ace-qwen3 and dit-vae)
    const requestJson: Record<string, unknown> = {
      caption:         prompt,
      lyrics,
      seed:            params.randomSeed !== false ? -1 : (params.seed ?? -1),
      inference_steps: params.inferenceSteps ?? 8,
      guidance_scale:  params.guidanceScale  ?? 0.0,
      shift:           params.shift          ?? 3.0,
    };

    // Optional music metadata (0 / empty → binary fills it in)
    if (params.bpm && params.bpm > 0)           requestJson.bpm           = params.bpm;
    if (params.duration && params.duration > 0) requestJson.duration      = params.duration;
    if (params.keyScale)                        requestJson.keyscale      = params.keyScale;
    if (params.timeSignature)                   requestJson.timesignature = params.timeSignature;

    if (skipLm) {
      // ── Cover / repaint / lego / passthrough: ace-qwen3 is skipped ──────
      // Add only the mode-specific fields that dit-vae cares about.
      if (isPassthru) {
        if (!params.audioCodes) {
          // Passthrough requires pre-computed codes — fail early with a clear message
          throw new Error("task_type='passthrough' requires pre-computed audio_codes");
        }
        requestJson.audio_codes = params.audioCodes;
      } else if (isCover) {
        // Cover / audio-to-audio: strength of the source audio influence (0–1)
        if (params.audioCoverStrength !== undefined) {
          requestJson.audio_cover_strength = params.audioCoverStrength;
        }
      } else if (isRepaint) {
        // Repaint: regenerate only the specified time region; preserve the rest.
        // Both default to -1: start=-1 → 0 s, end=-1 → full source duration.
        // Note: sourceAudioUrl is guaranteed here — validated in processGeneration.
        requestJson.repainting_start = params.repaintingStart ?? -1;
        requestJson.repainting_end   = params.repaintingEnd   ?? -1;
      } else if (isLego) {
        // Lego: generate a new instrument track layered over an existing backing track.
        // Requires the base model (acestep-v15-base) and --src-audio.
        // The "lego" field holds the track name (e.g. "guitar", "drums").
        if (!params.trackName) {
          throw new Error("task_type='lego' requires a track name (e.g. 'guitar')");
        }
        requestJson.lego = params.trackName;
        // Use recommended base-model settings if the caller hasn't specified them.
        if (params.inferenceSteps === undefined || params.inferenceSteps === null) {
          requestJson.inference_steps = 50;
        }
        if (params.guidanceScale === undefined || params.guidanceScale === null) {
          requestJson.guidance_scale = 7.0;
        }
        if (params.shift === undefined || params.shift === null) {
          requestJson.shift = 1.0;
        }
      }
    } else {
      // ── Text-to-music: include LM parameters for ace-qwen3 ──────────────
      requestJson.vocal_language     = params.vocalLanguage    || 'unknown';
      requestJson.lm_temperature     = params.lmTemperature    ?? 0.85;
      requestJson.lm_cfg_scale       = params.lmCfgScale       ?? 2.0;
      requestJson.lm_top_p           = params.lmTopP           ?? 0.9;
      requestJson.lm_top_k           = params.lmTopK           ?? 0;
      requestJson.lm_negative_prompt = params.lmNegativePrompt || '';
    }

    const requestPath = path.join(tmpDir, 'request.json');
    await writeFile(requestPath, JSON.stringify(requestJson, null, 2));
    console.log(`[Job ${jobId}] Request JSON written to ${requestPath}:`);
    console.log(JSON.stringify(requestJson, null, 2));

    // ── Step 1: ace-qwen3 — LLM (lyrics + audio codes) ────────────────────
    // Skipped when:
    //   • taskType is cover / audio2audio / repaint — dit-vae derives tokens
    //     directly from the source audio; running ace-qwen3 is not needed
    //   • taskType is passthrough — audio codes are already provided
    let enrichedPaths: string[] = [];

    if (!skipLm) {
      job.stage = 'LLM: generating lyrics and audio codes…';

      const lmBin   = config.acestep.lmBin!;
      const lmModel = config.acestep.lmModel;
      if (!lmModel) throw new Error('LM model not found — run models.sh first');

      const lmArgs: string[] = ['--request', requestPath, '--model', lmModel];

      const batchSize = Math.min(Math.max(params.batchSize ?? 1, 1), 8);
      if (batchSize > 1) lmArgs.push('--batch', String(batchSize));
      lmArgs.push(...parseExtraArgs(process.env.ACE_QWEN3_EXTRA_ARGS));

      console.log(`[Job ${jobId}] Running ace-qwen3:\n  ${lmBin} ${lmArgs.join(' ')}`);
      await runBinary(lmBin, lmArgs, 'ace-qwen3', undefined, makeLmProgressHandler(job));

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
      console.log(`[Job ${jobId}] ace-qwen3 produced ${enrichedPaths.length} enriched file(s): ${enrichedPaths.join(', ')}`);
    } else {
      // Cover / repaint / passthrough: pass the original request.json directly
      // to dit-vae; no LLM enrichment step needed.
      enrichedPaths = [requestPath];
      console.log(`[Job ${jobId}] LLM step skipped (mode=${taskType}); passing request.json directly to dit-vae`);
    }

    // ── Step 2: dit-vae — DiT + VAE (audio synthesis) ──────────────────────
    job.stage = 'DiT+VAE: synthesising audio…';

    const ditVaeBin        = config.acestep.ditVaeBin!;
    const textEncoderModel = config.acestep.textEncoderModel;
    const ditModel         = resolveParamDitModel(params.ditModel);
    const vaeModel         = config.acestep.vaeModel;

    if (!textEncoderModel) throw new Error('Text-encoder model not found — run models.sh first');
    if (!ditModel)         throw new Error('DiT model not found — run models.sh first');
    if (!vaeModel)         throw new Error('VAE model not found — run models.sh first');

    console.log(
      `[Job ${jobId}] Resolved model paths:` +
      `\n  text-encoder = ${textEncoderModel}` +
      `\n  dit          = ${ditModel}` +
      `\n  vae          = ${vaeModel}`
    );

    const ditArgs: string[] = [
      '--request',      ...enrichedPaths,
      '--text-encoder', textEncoderModel,
      '--dit',          ditModel,
      '--vae',          vaeModel,
    ];

    const batchSize = Math.min(Math.max(params.batchSize ?? 1, 1), 8);
    if (batchSize > 1) ditArgs.push('--batch', String(batchSize));

    // Cover and repaint modes both require a source audio file.
    // dit-vae reads WAV or MP3 natively (via dr_wav / dr_mp3 in audio.h).
    if (params.sourceAudioUrl) {
      const srcAudioPath = resolveAudioPath(params.sourceAudioUrl);
      ditArgs.push('--src-audio', srcAudioPath);
    }

    // LoRA adapter: inject --lora and --lora-scale when a LoRA is loaded and active.
    if (loraState.loaded && loraState.active && loraState.path) {
      ditArgs.push('--lora', loraState.path);
      ditArgs.push('--lora-scale', String(loraState.scale));
    }

    ditArgs.push(...parseExtraArgs(process.env.DIT_VAE_EXTRA_ARGS));

    console.log(`[Job ${jobId}] Running dit-vae:\n  ${ditVaeBin} ${ditArgs.join(' ')}`);
    await runBinary(ditVaeBin, ditArgs, 'dit-vae', undefined, makeDitVaeProgressHandler(job));

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
    console.log(`[Job ${jobId}] Completed successfully with ${audioUrls.length} audio file(s): ${audioUrls.join(', ')}`);

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
  const resolvedDitModel = resolveParamDitModel(params.ditModel);
  if (resolvedDitModel)         body.dit_model        = resolvedDitModel;

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

  const mode = useSpawnMode(params) ? 'spawn' : 'http';
  console.log(
    `[Job ${jobId}] Starting generation (${mode} mode):` +
    `\n  taskType    = ${params.taskType || 'text2music'}` +
    `\n  customMode  = ${params.customMode}` +
    `\n  ditModel    = ${params.ditModel || '(default)'}` +
    `\n  sourceAudio = ${params.sourceAudioUrl || 'none'}` +
    `\n  audioCodes  = ${params.audioCodes ? '[provided]' : 'none'}`
  );

  if ((params.taskType === 'cover' || params.taskType === 'audio2audio') &&
      !params.sourceAudioUrl && !params.audioCodes) {
    job.status = 'failed';
    job.error  = `task_type='${params.taskType}' requires a source audio or audio codes`;
    console.error(`[Job ${jobId}] Validation failed: ${job.error}`);
    return;
  }

  if (params.taskType === 'repaint' && !params.sourceAudioUrl) {
    job.status = 'failed';
    job.error  = "task_type='repaint' requires a source audio (--src-audio)";
    console.error(`[Job ${jobId}] Validation failed: ${job.error}`);
    return;
  }

  if (params.taskType === 'lego' && !params.sourceAudioUrl) {
    job.status = 'failed';
    job.error  = "task_type='lego' requires a source audio (--src-audio)";
    console.error(`[Job ${jobId}] Validation failed: ${job.error}`);
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
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Job ${jobId}] Generation failed: ${errMsg}`);
    job.status = 'failed';
    job.error  = errMsg || 'Generation failed';
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

// ---------------------------------------------------------------------------
// Ace Understand — reverse pipeline: audio → metadata + lyrics
// ---------------------------------------------------------------------------

export interface UnderstandResult {
  caption?: string;
  lyrics?: string;
  bpm?: number;
  duration?: number;
  keyscale?: string;
  timesignature?: string;
  vocal_language?: string;
  seed?: number;
  inference_steps?: number;
  guidance_scale?: number;
  shift?: number;
  audio_cover_strength?: number;
  repainting_start?: number;
  repainting_end?: number;
  lm_temperature?: number;
  lm_cfg_scale?: number;
  lm_top_p?: number;
  lm_top_k?: number;
  lm_negative_prompt?: string;
  use_cot_caption?: boolean;
  audio_codes?: string;
  [key: string]: unknown;
}

/**
 * Run ace-understand on a source audio file and return the parsed result JSON.
 *
 * The binary performs a reverse pipeline: VAE-encodes the audio, FSQ-tokenises
 * the latent, then uses the LM to generate metadata (caption, lyrics, bpm, etc.)
 * — the same fields that ace-qwen3 would fill for generation.
 */
export async function runUnderstand(audioUrl: string): Promise<UnderstandResult> {
  const understandBin = config.acestep.understandBin;
  if (!understandBin) {
    throw new Error('ace-understand binary not found — rebuild acestep.cpp or set ACE_UNDERSTAND_BIN');
  }

  const lmModel         = config.acestep.lmModel;
  const ditModel        = config.acestep.ditModel;
  const vaeModel        = config.acestep.vaeModel;

  if (!lmModel)   throw new Error('LM model not found — run models.sh first');
  if (!ditModel)  throw new Error('DiT model not found — run models.sh first');
  if (!vaeModel)  throw new Error('VAE model not found — run models.sh first');

  const srcAudioPath = resolveAudioPath(audioUrl);
  if (!existsSync(srcAudioPath)) {
    throw new Error(`Audio file not found: ${srcAudioPath}`);
  }

  // Write output JSON to a temp file so we can parse it reliably.
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'ace-understand-'));
  const outJsonPath = path.join(tmpDir, 'understand.json');

  try {
    const args: string[] = [
      '--src-audio', srcAudioPath,
      '--dit',       ditModel,
      '--vae',       vaeModel,
      '--model',     lmModel,
      '-o',          outJsonPath,
    ];

    console.log(`[understand] Running ace-understand:\n  ${understandBin} ${args.join(' ')}`);

    await runBinary(understandBin, args, 'ace-understand');

    // Read and parse the output JSON
    const raw = await readFile(outJsonPath, 'utf-8');
    const result: UnderstandResult = JSON.parse(raw);
    console.log('[understand] Result:', JSON.stringify(result, null, 2));
    return result;
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => { /* best-effort */ });
  }
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
