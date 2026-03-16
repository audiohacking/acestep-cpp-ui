# ACE-Step CPP UI — API Reference

This document maps and describes the API surface used by the **acestep-cpp-ui** Electron app: how the UI talks to the backend, and how the backend talks to the acestep.cpp engine. It is intended to support migrations and future development.

**Scope:** API and IPC only. Build, packaging, and tooling are out of scope.

---

## 1. Architecture Overview

- **UI (React)** runs in the Electron renderer and loads `http://127.0.0.1:PORT` (or Vite proxy in dev).
- **Backend (Express)** runs on `PORT` (default `3001`). All UI calls use **same-origin relative URLs** (`API_BASE = ''` in `services/api.ts`).
- **acestep.cpp** is used in one of two ways:
  - **Spawn mode:** Backend runs `ace-lm`, `ace-synth`, and optionally `ace-understand` as child processes (no Node addons).
  - **HTTP mode:** Backend calls an external acestep-cpp server at `ACESTEP_API_URL` (e.g. `http://localhost:7860`).

There are **no WebSockets** for app logic; only one **SSE** stream (model download progress).

---

## 2. Electron IPC

Used only by the **loading/setup window** (`electron/loading.html`), not by the main React app.

| Channel       | Direction       | Description |
|---------------|-----------------|-------------|
| `setup:status` | Main → Renderer | Progress during startup and first-run model downloads. |

**Preload API** (`electron/preload.js`):

- **`setupAPI.onStatus(callback)`** — Registers a listener for `setup:status`. Payload: `{ msg, pct, label }`.
- **`electronAPI.platform`** — `process.platform` (e.g. `'darwin'`, `'linux'`, `'win32'`).
- **`electronAPI.versions`** — `{ electron, node }` (version strings).

The main React app does **not** use `invoke` or `send`; it talks to the backend only over HTTP.

---

## 3. HTTP API (UI → Express)

Base URL is the same origin (relative). All JSON request/response unless noted. Auth: `Authorization: Bearer <token>` where required.

### 3.1 Health (no auth)

| Method | Path           | Description |
|--------|----------------|-------------|
| GET    | `/health`      | App health. Response: `{ status, service }`. |
| GET    | `/api/generate/health` | Backend + acestep health. Response: `{ healthy, mode, lmBin?, ditVaeBin?, aceStepUrl }`. |

### 3.2 Auth (`/api/auth`)

| Method | Path           | Auth | Request | Response |
|--------|----------------|------|---------|----------|
| GET    | `/api/auth/auto` | No  | —       | `AuthResponse`: `{ user: User, token }`. |
| POST   | `/api/auth/setup` | No  | `{ username }` | `AuthResponse`. |
| GET    | `/api/auth/me`   | Yes | —       | `{ user: User }`. |
| POST   | `/api/auth/logout` | No  | —       | `{ success: boolean }`. |
| POST   | `/api/auth/refresh` | Yes | —     | `AuthResponse`. |
| PATCH  | `/api/auth/username` | Yes | `{ username }` | `AuthResponse`. |

**Types:** `User`: `{ id, username, isAdmin?, bio?, avatar_url?, banner_url?, createdAt? }`. `AuthResponse`: `{ user: User, token: string }`.

### 3.3 Songs (`/api/songs`)

| Method | Path | Auth | Request | Response |
|--------|------|------|---------|----------|
| GET | `/api/songs` | Yes | — | `{ songs: Song[] }`. |
| GET | `/api/songs/public` | No | Query: `limit`, `offset` | `{ songs: Song[] }`. |
| GET | `/api/songs/public/featured` | No | — | `{ songs: Song[] }`. |
| GET | `/api/songs/:id` | Optional | — | `{ song: Song }`. |
| GET | `/api/songs/:id/full` | Optional | — | `{ song: Song, comments: Comment[] }`. |
| POST | `/api/songs` | Yes | `Partial<Song>` | `{ song: Song }`. |
| PATCH | `/api/songs/:id` | Yes | `Partial<Song>` | `{ song: Song }`. |
| DELETE | `/api/songs/:id` | Yes | — | `{ success: boolean }`. |
| POST | `/api/songs/:id/like` | Yes | — | `{ liked: boolean }`. |
| GET | `/api/songs/liked/list` | Yes | — | `{ songs: Song[] }`. |
| PATCH | `/api/songs/:id/privacy` | Yes | — | `{ isPublic: boolean }`. |
| POST | `/api/songs/:id/play` | Optional | — | `{ viewCount: number }`. |
| GET | `/api/songs/:id/comments` | Optional | — | `{ comments: Comment[] }`. |
| POST | `/api/songs/:id/comments` | Yes | `{ content }` | `{ comment: Comment }`. |
| DELETE | `/api/songs/comments/:commentId` | Yes | — | `{ success: boolean }`. |

**Song** (main fields): `id`, `title`, `lyrics`, `style`, `caption?`, `cover_url?`, `audio_url?` / `audioUrl?`, `duration?`, `bpm?`, `key_scale?`, `time_signature?`, `tags`, `is_public`, `like_count?`, `view_count?`, `user_id?`, `created_at`, `creator?`, `ditModel?`, `generation_params?`.

### 3.4 Generation (`/api/generate`)

| Method | Path | Auth | Request | Response |
|--------|------|------|---------|----------|
| POST | `/api/generate` | Yes | `GenerationParams` (see below) | `GenerationJob` (jobId, status, queuePosition). |
| GET | `/api/generate/status/:jobId` | Yes | — | `GenerationJob` (full status, result when done). |
| GET | `/api/generate/history` | Yes | — | `{ jobs: GenerationJob[] }`. |
| POST | `/api/generate/upload-audio` | Yes | `FormData` field `audio` (file) | `{ url, key }`. |
| POST | `/api/generate/format` | Yes | Format body (see below) | Format response (see below). |
| GET | `/api/generate/random-description` | Yes | — | `{ description, instrumental, vocalLanguage }`. |
| GET | `/api/generate/models` | No | — | `{ models: Array<{ name, is_active?, is_preloaded? }> }`. |
| GET | `/api/generate/limits` | No | — | Limits object (e.g. `tier`, `gpu_memory_gb`, `max_duration_*`, `max_batch_size_*`). |
| GET | `/api/generate/health` | No | — | See §3.1. |
| GET | `/api/generate/endpoints` | Yes | — | `{ endpoints: { provider, mode, lmBin?, ditVaeBin?, apiUrl? } }`. |
| GET | `/api/generate/audio` | No | Query: `path` | Binary audio stream (proxy to acestep or local file). |
| GET | `/api/generate/logs` | Yes | — | `{ jobs: Array<{ jobId, status, startTime, stage?, logCount }> }`. |
| GET | `/api/generate/logs/:jobId` | Yes | Query: `after` (index) | `{ lines: string[], total, status }`. |
| GET | `/api/generate/debug/:taskId` | Yes | — | `{ rawResponse }`. |

**GenerationParams** (key fields): `customMode?`, `songDescription?`, `lyrics`, `style`, `title`, `instrumental`, `vocalLanguage?`, `duration?`, `bpm?`, `keyScale?`, `timeSignature?`, `inferenceSteps?`, `guidanceScale?`, `batchSize?`, `randomSeed?`, `seed?`, `thinking?`, `audioFormat?` ('wav' \| 'mp3'), `inferMethod?`, `shift?`, LM params (`lmTemperature?`, `lmCfgScale?`, `lmTopK?`, `lmTopP?`, `lmNegativePrompt?`, `lmBackend?`, `lmModel?`), `referenceAudioUrl?`, `sourceAudioUrl?`, `referenceAudioTitle?`, `sourceAudioTitle?`, `audioCodes?`, `repaintingStart?`, `repaintingEnd?`, `instruction?`, `audioCoverStrength?`, `taskType?` (e.g. `text2music`, `cover`, `audio2audio`, `repaint`, `lego`, `passthrough`), `useAdg?`, `cfgIntervalStart?`, `cfgIntervalEnd?`, `customTimesteps?`, `useCotMetas?`, `useCotCaption?`, `useCotLanguage?`, `autogen?`, `trackName?`, `completeTrackClasses?`, `isFormatCaption?`, `ditModel?`, and other expert options.

**GenerationJob:** `jobId`, `id?`, `status`: 'pending' \| 'queued' \| 'running' \| 'succeeded' \| 'failed', `queuePosition?`, `etaSeconds?`, `progress?`, `stage?`, `params?`, `created_at?`, `result?`: `{ audioUrls, bpm?, duration?, keyScale?, timeSignature? }`, `error?`.

**Format request:** `caption`, `lyrics?`, `bpm?`, `duration?`, `keyScale?`, `timeSignature?`, `temperature?`, `topK?`, `topP?`, `lmModel?`, `lmBackend?`. **Format response:** `caption?`, `lyrics?`, `bpm?`, `duration?`, `key_scale?`, `vocal_language?`, `time_signature?`, `status_message?`, `error?`.

### 3.5 LoRA (`/api/lora`)

| Method | Path | Auth | Request | Response |
|--------|------|------|---------|----------|
| POST | `/api/lora/load` | Yes | `{ lora_path }` | `{ message, lora_path?, loaded? }`. |
| POST | `/api/lora/unload` | Yes | — | `{ message }`. |
| POST | `/api/lora/scale` | Yes | `{ scale }` (0–1) | `{ message, scale? }`. |
| POST | `/api/lora/toggle` | Yes | `{ enabled }` | `{ message, active }`. |
| GET | `/api/lora/status` | Yes | — | `{ loaded, active, scale, path }`. |

### 3.6 Reference tracks (`/api/reference-tracks`)

| Method | Path | Auth | Request | Response |
|--------|------|------|---------|----------|
| GET | `/api/reference-tracks` | Yes | — | List of reference tracks. |
| POST | `/api/reference-tracks` | Yes | `FormData` field `audio` (file) | Created track. |
| PATCH | `/api/reference-tracks/:id` | Yes | Partial track (e.g. title) | Updated track. |
| POST | `/api/reference-tracks/:id/transcribe` | Yes | — | Transcription result. |
| POST | `/api/reference-tracks/:id/understand` | Yes | — | Understand result (metadata/lyrics from ace-understand). |
| POST | `/api/reference-tracks/understand-url` | Yes | `{ audioUrl }` | Same shape as understand. |
| DELETE | `/api/reference-tracks/:id` | Yes | — | Success. |

### 3.7 Models — GGUF catalog & downloads (`/api/models`)

| Method | Path | Auth | Request | Response |
|--------|------|------|---------|----------|
| GET | `/api/models/catalog` | No | — | `{ catalog: CatalogEntry[], repo }`. |
| GET | `/api/models/status` | No | — | `ModelStatus`: `{ modelsDir, activeModel, onDisk, catalog, queue }`. |
| POST | `/api/models/download` | Yes | `{ files: string[] }` (filenames) | `{ enqueued, queueLength }`. |
| GET | `/api/models/download/stream` | No | — | **SSE** stream: events e.g. `progress` with job data. |
| POST | `/api/models/active` | Yes | `{ filename }` | `{ message, filename, path }`. |

**CatalogEntry:** `filename`, `label`, `group` ('vae' \| 'encoder' \| 'lm' \| 'dit'), `quant`, `variant?`, `essential`, `approxSizeMB`, plus from status: `downloaded?`, `queued?`, `active?`. **DownloadJob:** `id`, `filename`, `status`, `downloadedBytes`, `totalBytes`, `error?`.

### 3.8 Users (`/api/users`)

| Method | Path | Auth | Request | Response |
|--------|------|------|---------|----------|
| GET | `/api/users/public/featured` | No | — | `{ creators: (UserProfile & { follower_count? })[] }`. |
| GET | `/api/users/:username` | Optional | — | `{ user: UserProfile }`. |
| GET | `/api/users/:username/songs` | No | — | `{ songs: Song[] }`. |
| GET | `/api/users/:username/playlists` | No | — | `{ playlists }`. |
| PATCH | `/api/users/me` | Yes | `Partial<User>` | `{ user: User }`. |
| POST | `/api/users/me/avatar` | Yes | `FormData` field `avatar` | `{ user, url }`. |
| POST | `/api/users/me/banner` | Yes | `FormData` field `banner` | `{ user, url }`. |
| POST | `/api/users/:username/follow` | Yes | — | `{ following, followerCount }`. |
| GET | `/api/users/:username/followers` | No | — | `{ followers: User[] }`. |
| GET | `/api/users/:username/following` | No | — | `{ following: User[] }`. |
| GET | `/api/users/:username/stats` | Optional | — | `{ followerCount, followingCount, isFollowing }`. |

### 3.9 Playlists (`/api/playlists`)

| Method | Path | Auth | Request | Response |
|--------|------|------|---------|----------|
| POST | `/api/playlists` | Yes | `{ name, description, isPublic }` | `{ playlist: Playlist }`. |
| GET | `/api/playlists` | Yes | — | `{ playlists: Playlist[] }`. |
| GET | `/api/playlists/public/featured` | No | — | `{ playlists }`. |
| GET | `/api/playlists/:id` | Optional | — | `{ playlist, songs }`. |
| POST | `/api/playlists/:id/songs` | Yes | `{ songId }` | `{ success }`. |
| DELETE | `/api/playlists/:id/songs/:songId` | Yes | — | `{ success }`. |
| PATCH | `/api/playlists/:id` | Yes | `Partial<Playlist>` | `{ playlist }`. |
| DELETE | `/api/playlists/:id` | Yes | — | Success. |

### 3.10 Search, contact, proxies

| Method | Path | Auth | Request | Response |
|--------|------|------|---------|----------|
| GET | `/api/search` | No | Query: `q`, optional `type` ('songs' \| 'creators' \| 'playlists' \| 'all') | `{ songs, creators, playlists }`. |
| POST | `/api/contact` | No | `ContactFormData`: `name`, `email`, `subject`, `message`, `category` | `{ success, message?, id? }`. |
| GET | `/api/oembed` | No | Query: `url` (song page URL) | oEmbed JSON. |
| GET | `/api/proxy/image` | No | Query: `url` | Proxied image binary. |
| GET | `/api/pexels/photos` | No | Query: `query`. Optional header `x-pexels-api-key` | Pexels API response. |
| GET | `/api/pexels/videos` | No | Same | Pexels API response. |

---

## 4. Backend → acestep.cpp (HTTP fallback only)

When **spawn mode** is not used (no `ace-lm` / `ace-synth` binaries), the server uses `config.acestep.apiUrl` (e.g. `http://localhost:7860`).

| Method | URL / path | Request | Response / notes |
|--------|------------|---------|-------------------|
| GET | `{apiUrl}/health` | — | Health check. |
| POST | `{apiUrl}/v1/generate` | JSON body from `buildHttpRequest(params)` (see `server/src/services/acestep.ts`) | `{ audio_paths?, bpm?, key_scale?, time_signature?, duration?, error? }`. |
| GET | `{apiUrl}/v1/audio?path=...` | — | Binary audio. |
| GET | `{apiUrl}/v1/models` | — | `{ models: [...] }` (or legacy `data.models`). |
| GET | `{apiUrl}/v1/limits` | — | Limits object. |
| POST | `{apiUrl}/format_input` | `{ prompt, lyrics, temperature, param_obj }` | Format/enhance response. |
| POST | `{apiUrl}/v1/lora/load` | `{ lora_path }` | — |
| POST | `{apiUrl}/v1/lora/unload` | — | — |
| POST | `{apiUrl}/v1/lora/scale` | `{ scale }` | — |
| POST | `{apiUrl}/v1/lora/toggle` | `{ enabled }` | — |

Spawn mode does not use these HTTP calls; it runs `ace-lm` and `ace-synth` with a JSON request file and reads output files from a temp directory.

---

## 5. Configuration and environment

Values that affect the API or backend behaviour (from `server/src/config/index.ts` and root/server `.env`):

| Variable | Default / note |
|----------|-----------------|
| `PORT` | `3001` — Express and UI server. |
| `ACESTEP_API_URL` | `http://localhost:7860` — Used only in HTTP fallback mode. |
| `MODELS_DIR` | `<APP_ROOT>/models` — GGUF models. |
| `AUDIO_DIR` | `<server_root>/public/audio` — Served at `/audio`. |
| `DATABASE_PATH` | `<APP_ROOT>/data/acestep.db`. |
| `JWT_SECRET` | Local default; set in production. |
| `ACE_LM_BIN`, `ACE_SYNTH_BIN`, `ACE_UNDERSTAND_BIN` | Optional; otherwise resolved from `bin/`. |
| `ACESTEP_MODEL`, `ACESTEP_BASE_MODEL`, `LM_MODEL`, `TEXT_ENCODER_MODEL`, `VAE_MODEL` | Optional overrides for model paths. |
| `PEXELS_API_KEY` | Optional; can be overridden per-request via `x-pexels-api-key`. |
| `FRONTEND_URL` | `http://localhost:PORT`. |

Electron sets `process.env.PORT`, `MODELS_DIR`, `AUDIO_DIR`, `DATABASE_PATH`, `JWT_SECRET`, and binary paths when starting the server; the UI still uses same-origin relative URLs.

---

## 6. Types and clients

- **UI API client:** `services/api.ts` — defines `authApi`, `songsApi`, `generateApi`, `usersApi`, `playlistsApi`, `searchApi`, `contactApi`, `modelsApi`, and the types referenced in this document (`User`, `AuthResponse`, `Song`, `GenerationParams`, `GenerationJob`, `CatalogEntry`, `DownloadJob`, `ModelStatus`, `UserProfile`, `Playlist`, `SearchResult`, `ContactFormData`).
- **Server route types:** `GenerateBody` in `server/src/routes/generate.ts` aligns with `GenerationParams`; `server/src/services/acestep.ts` defines `GenerationParams`, `GenerationResult`, `JobStatus`, `LoraState`, `UnderstandResult`, and the HTTP response type for `v1/generate`.

---

## 7. Static and special routes

- **Audio files:** `GET /audio/*` — Express static from `config.storage.audioDir`.
- **Editors:** `/editor` (AudioMass), `/demucs-web` (Demucs) — static with relaxed CSP where needed.
- **Song share / SEO:** `GET /song/:id` — Serves HTML meta for bots; redirects others to the app with `?song=:id`.
- **Contact admin** (not used by main UI): `GET/PATCH/DELETE /api/contact/admin/*`, `GET /api/contact/admin/unread-count` — admin-only.

This file is the single source of truth for the UI-facing and backend→acestep API surface as of the last update.
