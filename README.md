<h1 align="center">
  <img width="250" alt="image" src="https://github.com/user-attachments/assets/0b34f9e0-9323-4032-96d1-5837aaca18af" />
</h1>
<p align="center">
  <img width="800" height="431" alt="image" src="https://github.com/user-attachments/assets/89825300-2cef-4914-9ba7-46234ffe4084" />
</p>

<p align="center">
  <strong>Native C++ bundle for local AI music generation with 0% python</strong><br>
  <em>Powered by <a href="https://github.com/ServeurpersoCom/acestep.cpp">acestep.cpp</a> — the GGUF-native C++ inference engine for ACE-Step 1.5</em>
</p>

---

## 🎯 About This Fork

**acestep-cpp-ui** is a fork of the original ace-step-ui project that replaces the Python/Gradio backend with [acestep.cpp](https://github.com/ServeurpersoCom/acestep.cpp).

- **No Python environment to manage** — just build once and run
- **GGUF quantization** — run larger models with less VRAM
- **Broader GPU support** — CUDA, ROCm/HIP (AMD), Vulkan, and Metal (macOS)
- **Faster startup** — no Python interpreter or virtual environment overhead
- **Single bundle** — build script, model downloader, and UI in one repo

---

## 📋 Requirements

| Requirement | Specification |
|-------------|---------------|
| **Node.js** | 20 or higher (required by setup.sh; also ensures better-sqlite3 native addon builds cleanly) |
| **cmake** | 3.20+ (for building the C++ engine) |
| **git** | For cloning acestep.cpp and its submodules |
| **C++ compiler** | GCC 11+ / Clang 13+ / MSVC 2022+ |
| **GPU (optional)** | NVIDIA (CUDA), AMD (ROCm/HIP), Vulkan-capable, or Apple Silicon (Metal) |

> **No Python required.** The C++ engine runs standalone — just build it once and it stays ready.

---

## ⚡ Quick Start

### Linux / macOS
```bash
# 1. Clone this repository
git clone https://github.com/audiohacking/acestep-cpp-ui
cd acestep-cpp-ui

# 2. Run setup — builds acestep.cpp, downloads GGUF models, installs Node deps
./setup.sh

# 3. Launch — builds the UI and starts a single server for both API + UI
./start-all.sh
```

Open **http://localhost:3001**

### Windows
```batch
REM 1. Clone this repository
git clone https://github.com/audiohacking/acestep-cpp-ui
cd acestep-cpp-ui

REM 2. Run setup — builds acestep.cpp, downloads GGUF models, installs Node deps
setup.bat

REM 3. Launch
start-all.bat
```

Open **http://localhost:3001**

---

## 📦 Installation (Step-by-Step)

### Step 1: Clone the repository

```bash
git clone https://github.com/audiohacking/acestep-cpp-ui
cd acestep-cpp-ui
```

### Step 2: Build the C++ engine

The `build.sh` / `build.bat` script clones [acestep.cpp](https://github.com/audiohacking/acestep.cpp), auto-detects your GPU (CUDA / ROCm / Vulkan / Metal), and compiles the binaries into `./bin/`.

**Linux / macOS:**
```bash
./build.sh
```

**Windows:**
```batch
build.bat
```

**Build options:**

| Flag | Description |
|------|-------------|
| `--cuda` | Force CUDA (NVIDIA) build |
| `--rocm` | Force ROCm/HIP (AMD) build |
| `--vulkan` | Force Vulkan build |
| `--cpu` | CPU-only build (no GPU) |
| `--src DIR` | Custom source directory (default: `./acestep.cpp`) |
| `--bin DIR` | Custom binary output directory (default: `./bin`) |

After a successful build, three binaries are installed to `./bin/`:
- `ace-qwen3` — text encoder
- `dit-vae` — diffusion + VAE decoder
- `neural-codec` — audio codec

### Step 3: Download GGUF models

The `models.sh` / `models.bat` script downloads pre-quantized GGUF model files from HuggingFace into `./models/`. No Python required — uses `curl` or `wget` (Linux/macOS) or PowerShell (Windows).

**Linux / macOS:**
```bash
./models.sh
```

**Windows:**
```batch
models.bat
```

The default download is the **Q8_0 essential set** (~8 GB):
- `vae-BF16.gguf` — VAE (always BF16)
- `Qwen3-Embedding-0.6B-Q8_0.gguf` — text encoder
- `acestep-5Hz-lm-4B-Q8_0.gguf` — language model (4B)
- `acestep-v15-turbo-Q8_0.gguf` — DiT (turbo)

**Model download options:**

| Flag | Description |
|------|-------------|
| `--quant X` | Quantization: `Q4_K_M`, `Q5_K_M`, `Q6_K`, `Q8_0`, `BF16` (default: `Q8_0`) |
| `--lm SIZE` | LM size: `0.6B`, `1.7B`, `4B` (default: `4B`) |
| `--sft` | Also download SFT DiT variant |
| `--base` | Also download base DiT variant |
| `--shifts` | Also download shift1/shift3/continuous DiT variants |
| `--all` | Download all models and all quants |
| `--dir DIR` | Custom download directory (default: `./models`) |
| `--hf-token TOKEN` | HuggingFace token for private/gated repos |

### Step 4: Install Node.js dependencies

```bash
# Install frontend dependencies
npm install

# Install server dependencies
cd server && npm install && cd ..

# Rebuild native addon for your platform
cd server && npm rebuild better-sqlite3 && cd ..
```

Or run everything above in one step with `./setup.sh` / `setup.bat`.

### Step 5: Configure `.env`

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

```env
# Path to the acestep-generate binary built in Step 2
ACESTEP_BIN=./bin/acestep-generate

# Path to your primary DiT GGUF model downloaded in Step 3
ACESTEP_MODEL=./models/acestep-v15-turbo-Q8_0.gguf
```

See [⚙️ Configuration](#%EF%B8%8F-configuration) for all options.

---

## 🎮 Usage

### One-Command Launch

**Linux / macOS:**
```bash
./start-all.sh
```

**Windows:**
```batch
start-all.bat
```

This builds the React UI and starts a single Node.js server that serves both the API and the compiled frontend. No separate frontend dev server is needed. The PID file is written to `./logs/server.pid` for graceful shutdown.

| Service | URL |
|---------|-----|
| UI + API | http://localhost:3001 |
| LAN access | http://YOUR_IP:3001 |

To stop on Linux/macOS:
```bash
kill $(cat logs/server.pid)
```
On Windows, close the terminal window opened by `start-all.bat`.

### Manual Launch (development with hot-reload)

**Linux / macOS — backend:**
```bash
cd server && npm run dev
```

**Linux / macOS — frontend (separate terminal):**
```bash
npm run dev
```

---

## ⚙️ Configuration

Copy `.env.example` to `.env` and edit as needed. Most settings are auto-detected — no editing is required for a local install.

```env
# ── Server ────────────────────────────────────────────────────────────────────
PORT=3001
NODE_ENV=development

# ── Database ──────────────────────────────────────────────────────────────────
DATABASE_PATH=./data/acestep.db

# ── Model storage ─────────────────────────────────────────────────────────────
MODELS_DIR=./models

# ── acestep-cpp binaries — auto-detected from ./bin/ after ./build.sh ─────────
# Override only if your binaries live outside ./bin/:
# ACE_QWEN3_BIN=/path/to/ace-qwen3
# DIT_VAE_BIN=/path/to/dit-vae
# ACESTEP_MODEL=/path/to/models/acestep-v15-turbo-Q8_0.gguf  # override DiT model

# Mode 2 (advanced): connect to a separately running acestep-cpp HTTP server
# ACESTEP_API_URL=http://localhost:7860

# ── Storage ───────────────────────────────────────────────────────────────────
AUDIO_DIR=./public/audio

# ── Auth ──────────────────────────────────────────────────────────────────────
JWT_SECRET=ace-step-ui-local-secret

# ── Optional ──────────────────────────────────────────────────────────────────
# HF_TOKEN=hf_...          # HuggingFace token for private repos
# PEXELS_API_KEY=          # Pexels API key for video backgrounds
```

---

## 🎼 Generation Modes

### Simple Mode
Just describe what you want. ACE-Step handles the rest.

> "An upbeat pop song about summer adventures with catchy hooks"

### Custom Mode
Full control over every parameter:

| Parameter | Description |
|-----------|-------------|
| **Lyrics** | Full lyrics with `[Verse]`, `[Chorus]` tags |
| **Style** | Genre, mood, instruments, tempo |
| **Duration** | 30-240 seconds |
| **BPM** | 60-200 beats per minute |
| **Key** | Musical key (C major, A minor, etc.) |

---

## 🙏 Credits

- **[acestep.cpp](https://github.com/ServeurpersoCom/acestep.cpp)** — Native C++ inference engine for ACE-Step 1.5 (GGUF)
- **ace-step-ui** — Original React/TypeScript UI this fork is based on
- **[ACE-Step 1.5](https://github.com/ace-step/ACE-Step-1.5)** — The open source AI music generation model
- **[AudioMass](https://github.com/pkalogiros/AudioMass)** — Web audio editor
- **[Demucs](https://github.com/facebookresearch/demucs)** — Audio source separation
- **[Pexels](https://www.pexels.com)** — Stock video backgrounds

---

## 📄 License

This project is open source under the [MIT License](LICENSE). UI forked from [Ace-Step-UI](https://github.com/fspecii/ace-step-ui)

---

<p align="center">
  <em>Made with ❤️ for the open-source AI music community</em>
</p>
