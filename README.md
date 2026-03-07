<p align="center">
  <img src="https://img.shields.io/badge/🎵-ACE--Step_UI-ff69b4?style=for-the-badge&labelColor=1a1a1a" alt="ACE-Step UI" height="60">
</p>

<h1 align="center">acestep-cpp-ui</h1>

<p align="center">
  <img width="800" height="431" alt="image" src="https://github.com/user-attachments/assets/89825300-2cef-4914-9ba7-46234ffe4084" />
</p>

<p align="center">
  <strong>Native C++ bundle for local AI music generation — with 0% Python</strong><br>
  <em>Powered by <a href="https://github.com/audiohacking/acestep.cpp">acestep.cpp</a> — the GGUF-native C++ inference engine for ACE-Step 1.5</em>
</p>

<p align="center">
  <a href="#-about-this-fork">About</a> •
  <a href="#-features">Features</a> •
  <a href="#-requirements">Requirements</a> •
  <a href="#-installation">Installation</a> •
  <a href="#-usage">Usage</a> •
  <a href="#%EF%B8%8F-configuration">Configuration</a> •
  <a href="#-contributing">Contributing</a>
</p>

---

## 🎯 About This Fork

**acestep-cpp-ui** is a fork of the original ace-step-ui project that replaces the Python/Gradio backend with a native C++ inference engine — [acestep.cpp](https://github.com/ServeurpersoCom/acestep.cpp).

- **No Python environment to manage** — just build once and run
- **GGUF quantization** — run larger models with less VRAM
- **Broader GPU support** — CUDA, ROCm/HIP (AMD), Vulkan, and Metal (macOS)
- **Faster startup** — no Python interpreter or virtual environment overhead
- **Single bundle** — build script, model downloader, and UI in one repo

---

## ✨ Features

### 🎵 AI Music Generation
| Feature | Description |
|---------|-------------|
| **Full Song Generation** | Create complete songs with vocals and lyrics up to 4+ minutes |
| **Instrumental Mode** | Generate instrumental tracks without vocals |
| **Custom Mode** | Fine-tune BPM, key, time signature, and duration |
| **Style Tags** | Define genre, mood, tempo, and instrumentation |
| **Batch Generation** | Generate multiple variations at once |
| **AI Enhance** | Enrich genre tags into detailed captions with proper BPM/key/time |
| **Thinking Mode** | Let AI reason about structure and generate audio codes |

### 🎨 Advanced Parameters
| Feature | Description |
|---------|-------------|
| **Reference Audio** | Use any audio file as a style reference |
| **Audio Cover** | Transform existing audio with new styles |
| **Repainting** | Regenerate specific sections of a track |
| **Seed Control** | Reproduce exact generations for consistency |
| **Inference Steps** | Control quality vs speed tradeoff |

### 🎤 Lyrics & Prompts
| Feature | Description |
|---------|-------------|
| **Lyrics Editor** | Write and format lyrics with structure tags |
| **Format Assistant** | AI-powered caption and lyrics formatting |
| **Prompt Templates** | Quick-start with genre presets |
| **Reuse Prompts** | Clone settings from any previous generation |

### 🎧 Interface
| Feature | Description |
|---------|-------------|
| **Clean UI** | Modern design with dark/light mode |
| **Bottom Player** | Full-featured player with waveform and progress |
| **Library Management** | Browse, search, and organize all your tracks |
| **Likes & Playlists** | Organize favorites into custom playlists |
| **Real-time Progress** | Live generation progress with queue position |
| **LAN Access** | Use from any device on your local network |
| **Models Tab** | Download and manage GGUF model files from the UI |

### 🛠️ Built-in Tools
| Feature | Description |
|---------|-------------|
| **Audio Editor** | Trim, fade, and apply effects with AudioMass |
| **Stem Extraction** | Separate vocals, drums, bass, and other with Demucs |
| **Video Generator** | Create music videos with Pexels backgrounds |
| **Gradient Covers** | Beautiful procedural album art (no internet needed) |

---

## 💻 Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Frontend** | React 19, TypeScript, TailwindCSS, Vite |
| **Backend** | Express.js, SQLite, better-sqlite3 |
| **AI Engine** | [acestep.cpp](https://github.com/ServeurpersoCom/acestep.cpp) (native C++ binary, GGUF models) |
| **Audio Tools** | AudioMass, Demucs, FFmpeg |

---

## 📋 Requirements

| Requirement | Specification |
|-------------|---------------|
| **Node.js** | 20 or higher (required by setup.sh; also ensures better-sqlite3 native addon builds cleanly) |
| **cmake** | 3.20+ (for building the C++ engine) |
| **git** | For cloning acestep.cpp and its submodules |
| **C++ compiler** | GCC 11+ / Clang 13+ / MSVC 2022+ |
| **GPU (optional)** | NVIDIA (CUDA), AMD (ROCm/HIP), Vulkan-capable, or Apple Silicon (Metal) |
| **FFmpeg** | For audio processing |

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

### AI Enhance & Thinking Mode

| Mode | What it does | Speed impact |
|------|-------------|--------------|
| **AI Enhance OFF** | Sends your style tags directly to the model | Fastest |
| **AI Enhance ON** | LLM enriches your tags into a detailed caption and generates proper BPM, key, time signature | +10-20s |
| **Thinking Mode** | Full LLM reasoning with audio code generation | Slowest, best quality |

### Batch Size & Bulk Generation

| Setting | Description |
|---------|-------------|
| **Batch Size** | Number of variations generated per job (1-4). Default is **1** for broad GPU compatibility. Higher values generate more variations but use more VRAM. |
| **Bulk Generate** | Queue multiple independent generation jobs (1-10). Each job runs sequentially. |

---

## 🔧 Built-in Tools

| Tool | Description |
|------|-------------|
| **🎚️ Audio Editor** | Cut, trim, fade, and apply effects |
| **🎤 Stem Extraction** | Separate vocals, drums, bass, other |
| **🎬 Video Generator** | Create music videos with stock footage |
| **🎨 Album Art** | Auto-generated gradient covers |

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| **No binaries found in `./bin/`** | Run `./build.sh` (or `build.bat`) to compile the C++ engine |
| **Build fails: cmake not found** | Install cmake: `sudo apt install cmake` (Linux), `brew install cmake` (macOS), or from cmake.org (Windows) |
| **Build fails: no C++ compiler** | Install build tools: `sudo apt install build-essential` (Linux), Xcode Command Line Tools (macOS), or Visual Studio 2022 with C++ workload (Windows) |
| **CUDA out of memory** | Use a lower quantization (e.g. `Q4_K_M`), reduce duration, or disable Thinking Mode |
| **No GPU detected — CPU build** | Pass `--cuda`, `--rocm`, or `--vulkan` to `build.sh` to force a GPU backend |
| **Songs show 0:00 duration** | Install FFmpeg: `sudo apt install ffmpeg` (Linux) or download from [ffmpeg.org](https://ffmpeg.org) (Windows) |
| **LAN access not working** | Check firewall allows port 3001 |
| **`better-sqlite3` fails to load** | Run `cd server && npm rebuild better-sqlite3` with build tools installed |

---

## 🤝 Contributing

Contributions are welcome! Whether you're fixing bugs, adding features, improving documentation, or sharing ideas — every contribution counts.

### Ways to Contribute

- 🐛 **Report bugs** — Found an issue? Open a GitHub issue
- 💡 **Suggest features** — Have an idea? We'd love to hear it
- 🔧 **Submit PRs** — Code contributions are always welcome
- 📖 **Improve docs** — Help others get started

### How to Contribute

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 🙏 Credits

- **[acestep.cpp](https://github.com/audiohacking/acestep.cpp)** — Native C++ inference engine for ACE-Step 1.5 (GGUF)
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
