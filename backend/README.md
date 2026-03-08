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

---

## Upstream C++ dependency: `audiohacking/acestep.cpp`

This UI depends on the custom fork at
[`audiohacking/acestep.cpp` branch `copilot/add-wav-mp3-conversion`](https://github.com/audiohacking/acestep.cpp/tree/copilot/add-wav-mp3-conversion)
which adds native MP3 decoding to the `dit-vae` binary via `dr_mp3.h`.

### Known issues in `src/audio.h` (pending upstream fix)

**Bug: mono audio is not upmixed to stereo before encoding**

`read_audio()` returns a native-channel-count buffer (`[T x n_channels]` floats),
but `vae_enc_compute()` in `vae-enc.h` always reads two channels:

```cpp
// vae-enc.h (hardcodes stereo access — UB when n_channels == 1)
for (int c = 0; c < 2; c++) {
    for (int t = 0; t < T_audio; t++) {
        m->scratch_in[c * T_audio + t] = audio[t * 2 + c];
    }
}
```

For stereo inputs (most user uploads) this works correctly.
For mono inputs the second channel index reads out-of-bounds memory.

**Required fix in `src/audio.h`** — always return interleaved stereo `[T x 2]`.
Add this block after resampling completes (before the final `return out`):

```c
// Upmix mono -> stereo, or use first two channels of N-ch audio.
if ((int) channels != 2) {
    int    n_ch_src = (int) channels;
    float *stereo   = (float *) malloc((size_t) T_raw * 2 * sizeof(float));
    if (!stereo) {
        fprintf(stderr, "[Audio] Out of memory converting to stereo\n");
        free(out);
        return NULL;
    }
    for (int t = 0; t < T_raw; t++) {
        float L = out[(size_t) t * n_ch_src + 0];
        float R = (n_ch_src > 1) ? out[(size_t) t * n_ch_src + 1] : L;
        stereo[t * 2 + 0] = L;
        stereo[t * 2 + 1] = R;
    }
    free(out);
    out = stereo;
    fprintf(stderr, "[Audio] Converted %dch -> stereo\n", n_ch_src);
}
*n_channels = 2;
```

**Also: replace `drwav_free(raw, NULL)` with `free(raw)`** in the resampling
branch — both `dr_wav` and `dr_mp3` use the system allocator by default, so
`free()` is always safe regardless of which decoder produced the buffer.
