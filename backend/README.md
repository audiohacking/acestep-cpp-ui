# backend/ — design note

## Why there is no custom C++ HTTP server here

An earlier design wrapped `acestep-generate` in a second C++ HTTP server process.
That was removed because it added unnecessary complexity:

| Problem | Impact |
|---------|--------|
| Two processes to manage (Node.js + C++ server) | harder to deploy, restart, monitor |
| C++ server used `popen()` with shell-built strings | fragile, platform-specific, injection surface |
| LoRA state split across two processes | race conditions, stale cache |
| Extra HTTP hop for every generation request | added latency and error surface |
| Users need to build *two* C++ projects | poor DX |

## Current architecture

```
Browser
  │
  │ HTTP
  ▼
Node.js Express (port 3001)
  │  handles: auth, songs DB, playlists, audio storage, job queue
  │
  │ child_process.spawn(bin, args, { shell: false })
  ▼
acestep-generate  ←── GGUF model on GPU/CPU
  │
  └─► writes audio files → ./public/audio/
```

The Node.js server reads `ACESTEP_BIN` from `.env` and spawns `acestep-generate`
directly — the same pattern used by llama.cpp, whisper.cpp, and similar tools.
No shell is involved, so there is no injection risk.

## When a separate HTTP server *would* make sense

If `acestep.cpp` ever ships a **built-in** HTTP server mode (like `llama-server`),
you can point `ACESTEP_API_URL` at it and leave `ACESTEP_BIN` empty.
The Node.js service already has an HTTP-client fallback for exactly this case.

See `server/src/services/acestep.ts` for the dual-mode implementation.
