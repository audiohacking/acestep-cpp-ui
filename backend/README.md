# acestep-cpp HTTP server

This directory contains a lightweight C++17 HTTP server that:

1. Wraps the **[acestep.cpp](https://github.com/ServeurpersoCom/acestep.cpp)** binary for music generation
2. Exposes the REST API consumed by the Node.js Express backend
3. Can optionally serve the pre-built React frontend in production

## Prerequisites

| Tool | Version |
|------|---------|
| CMake | ≥ 3.16 |
| C++ compiler | GCC ≥ 11 or Clang ≥ 14 (Linux/macOS) |
| Git | any recent |
| [acestep.cpp](https://github.com/ServeurpersoCom/acestep.cpp) | built separately |

> **Windows note:** the server uses POSIX `popen`/`pclose` for process management.
> On Windows, use WSL2 or MinGW-w64 with a POSIX compatibility layer.

The server fetches its own C++ dependencies (cpp-httplib, nlohmann/json) via CMake
`FetchContent` — no system-level library installs required.

## Build

```bash
# 1. Clone & build acestep.cpp (see its own README)
git clone https://github.com/ServeurpersoCom/acestep.cpp
cd acestep.cpp && cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j$(nproc)
cd ..

# 2. Build this server
cd acestep-cpp-ui/backend
cmake -B build \
  -DCMAKE_BUILD_TYPE=Release \
  -DACESTEP_CPP_DIR=../../acestep.cpp
cmake --build build -j$(nproc)
```

The resulting binary is `build/acestep-server`.

## Configuration

All settings are controlled via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `ACESTEP_BIN` | `./acestep-generate` | Path to the `acestep-generate` binary from these.cpp |
| `ACESTEP_MODEL` | `./models/acestep-v15-turbo.gguf` | Active GGUF model file |
| `AUDIO_DIR` | `./audio` | Directory where generated audio files are written |
| `SERVER_PORT` | `7860` | TCP port to listen on |
| `STATIC_DIR` | `../dist` | Optional path to pre-built React frontend assets |

## Running

```bash
# Development (Node.js frontend + C++ generation backend)
ACESTEP_BIN=/path/to/acestep-generate \
ACESTEP_MODEL=/path/to/model.gguf \
AUDIO_DIR=/path/to/audio \
./build/acestep-server

# Production (C++ server serves both API and frontend)
STATIC_DIR=/path/to/ace-step-ui/dist \
./build/acestep-server
```

## REST API

### `GET /health`
Returns `{ "status": "ok", "service": "acestep-cpp" }`.

### `GET /v1/models`
Returns the list of available models:
```json
{ "models": [{ "name": "acestep-v15-turbo.gguf", "is_active": true, "is_preloaded": true }] }
```

### `POST /v1/init`
Switch the active model:
```json
{ "model": "acestep-v15-base.gguf" }
```

### `POST /v1/generate`
Start a synchronous generation job.  The server blocks until the audio is ready
and returns the local file paths:

```json
{
  "prompt": "upbeat pop song with catchy hooks",
  "lyrics": "[verse]\nHello world...",
  "duration": 60,
  "batch_size": 1,
  "infer_steps": 8,
  "guidance_scale": 7.0,
  "seed": -1,
  "audio_format": "mp3"
}
```

Response:
```json
{ "audio_paths": ["/path/to/audio/job_abc123_0.mp3"] }
```

### `GET /v1/audio?path=<absolute-path>`
Stream an audio file by its absolute path on the server's filesystem.

### `POST /v1/lora/load` · `POST /v1/lora/unload` · `POST /v1/lora/scale` · `POST /v1/lora/toggle` · `GET /v1/lora/status`
LoRA adapter management (load/unload/scale/enable-disable/query).

### `POST /format_input`
Enhance a prompt and lyrics via the LLM component:
```json
{ "prompt": "rock song", "lyrics": "...", "temperature": 0.85 }
```

### `GET /v1/limits`
Returns GPU capability limits:
```json
{
  "tier": "medium",
  "gpu_memory_gb": 8,
  "max_duration_with_lm": 120,
  "max_duration_without_lm": 240,
  "max_batch_size_with_lm": 2,
  "max_batch_size_without_lm": 4
}
```

## Architecture

```
Browser / UI
     │
     │ HTTP
     ▼
Node.js Express (port 3001)   ←── handles auth, songs DB, playlists, etc.
     │
     │ HTTP  POST /v1/generate
     ▼
acestep-cpp server (port 7860)
     │
     │ subprocess / shared lib
     ▼
acestep-generate binary
     │
     ▼
GGUF model on GPU / CPU
```
