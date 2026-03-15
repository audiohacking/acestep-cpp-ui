# Electron Build — Manual Pre-merge Test Instructions

These steps let you validate the macOS and Linux Electron builds **locally** before merging, without waiting for CI to produce a full installer.  They specifically verify:

- The precompiled binary archive is correctly extracted into `bin/`
- All required `libggml` shared libraries are present alongside the binaries
- The symlink chain is intact (macOS `.0.dylib` / `.dylib`; Linux `.so.0`)
- `DYLD_LIBRARY_PATH` (macOS) or `LD_LIBRARY_PATH` (Linux) is correctly set to `bin/` at runtime
- The Electron app starts, shows the loading screen, and opens the UI
- First-run model dialog offers Download, Browse, and Skip options
- Browsing to an existing models folder persists the choice across restarts
- `MODELS_DIR` env var is respected and takes priority over saved preferences

---

## Prerequisites

| Tool | Minimum version | Check |
|------|----------------|-------|
| Node.js | 20 | `node -v` |
| npm | 10 | `npm -v` |
| curl | any | `curl --version` |
| macOS (Apple Silicon) | 14 (Sonoma) | `sw_vers` |
| Linux (x86_64) | any glibc ≥ 2.31 | `ldd --version` |

Clone the branch and install dependencies:

```bash
# After merge this will be on the main branch; use the appropriate branch/tag:
git clone https://github.com/audiohacking/acestep-cpp-ui
cd acestep-cpp-ui

npm ci
npm ci --prefix server
```

---

## Step 1 — Download and extract the precompiled binaries

Both archives are flat tarballs (no subdirectory).  Run the command for your platform:

### macOS (Apple Silicon)

```bash
mkdir -p bin

curl -fsSL --retry 3 \
  https://github.com/audiohacking/acestep.cpp/releases/download/v0.0.1/acestep-macos-arm64-metal.tar.gz \
  -o acestep-macos-arm64-metal.tar.gz

echo "Archive contents:"
tar -tzf acestep-macos-arm64-metal.tar.gz

echo ""
echo "Extracting …"
tar -xzf acestep-macos-arm64-metal.tar.gz -C bin/

echo ""
echo "bin/ after extraction:"
ls -lh bin/
```

### Linux (x86_64)

```bash
mkdir -p bin

curl -fsSL --retry 3 \
  https://github.com/audiohacking/acestep.cpp/releases/download/v0.0.1/acestep-linux-x64.tar.gz \
  -o acestep-linux-x64.tar.gz

echo "Archive contents:"
tar -tzf acestep-linux-x64.tar.gz

echo ""
echo "Extracting …"
tar -xzf acestep-linux-x64.tar.gz -C bin/

echo ""
echo "bin/ after extraction:"
ls -lh bin/
```

---

## Step 2 — Verify binaries and libraries are present

### macOS — expected output

Run:

```bash
GGML_VER="0.9.7"
ok=1
for bin in ace-qwen3 dit-vae neural-codec; do
  [ -f "bin/$bin" ] && [ -x "bin/$bin" ] \
    && echo "✅  bin/$bin" \
    || { echo "❌  bin/$bin — missing or not executable"; ok=0; }
done
for lib_base in libggml libggml-base libggml-metal libggml-cpu libggml-blas; do
  for lib_name in "${lib_base}.${GGML_VER}.dylib" "${lib_base}.0.dylib" "${lib_base}.dylib"; do
    [ -e "bin/${lib_name}" ] \
      && echo "✅  bin/${lib_name}" \
      || { echo "❌  bin/${lib_name} — missing"; ok=0; }
  done
done
[ "$ok" = "1" ] && echo "" && echo "All checks passed." || echo "" && echo "FAILURES — see above."
```

**Expected:** every line shows ✅.  The archive ships the real `.0.9.7.dylib` files plus a two-level symlink chain (`.0.dylib` → `.0.9.7.dylib` and `.dylib` → `.0.dylib`).  If any symlinks are missing, `fixMacosDylibLinks()` in `electron/main.js` will recreate them at app startup.

### Linux — expected output

Run:

```bash
ok=1
for bin in ace-qwen3 dit-vae neural-codec; do
  [ -f "bin/$bin" ] && [ -x "bin/$bin" ] \
    && echo "✅  bin/$bin" \
    || { echo "❌  bin/$bin — missing or not executable"; ok=0; }
done
for lib in libggml.so libggml-base.so; do
  [ -f "bin/$lib" ] \
    && echo "✅  bin/$lib" \
    || { echo "❌  bin/$lib — missing"; ok=0; }
done
[ "$ok" = "1" ] && echo "" && echo "All checks passed." || echo "" && echo "FAILURES — see above."
```

> **Note:** `libggml.so.0` / `libggml-base.so.0` symlinks are created by `fixSonameLinks()` at first run; at this point only the unversioned names need to be present.

---

## Step 3 — Build the frontend and server

```bash
# Frontend (Vite → dist/)
npm run build

# Server (TypeScript → server/dist/)
npm run build --prefix server
```

Both should complete without errors.

---

## Step 4 — Rebuild native modules for Electron

```bash
npx @electron/rebuild --module-dir server --only better-sqlite3
```

This rebuilds `better-sqlite3` against Electron's bundled Node.js ABI.  Expect a success line like:
```
✔ Rebuild Complete
```

---

## Step 5 — Run the Electron app in development mode

```bash
npm run electron:dev
```

### What to observe

| # | Expected behaviour |
|---|--------------------|
| 1 | A dark frameless **loading window** appears with a progress bar |
| 2 | Status text shows *"Checking models…"* **before** *"Starting server…"* (model check now runs first so the resolved path is passed to the server) |
| 3 | If **no `.gguf` files** exist in the models directory, a native dialog appears: *"ACE-Step models not found"* with **three** buttons: *"Download now (~8 GB)"*, *"Browse for existing models…"*, and *"Skip — I'll add models manually"* — click **Skip** for now |
| 4 | The main browser window opens at `http://127.0.0.1:3001` and shows the ACE-Step UI |
| 5 | No crash / black screen / *"library not found"* errors in the terminal |

**Models directory locations:**

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/ACE-Step UI/models/` |
| Linux | `~/.config/ACE-Step UI/models/` |

---

## Step 6 — Verify library path environment variables

While the app is running, open a second terminal and confirm the environment variables are set by checking the server process:

### macOS

```bash
# Find the ace-qwen3 / dit-vae child process (if a generation is running) or
# inspect the Electron main process env via the logs directory:
cat ~/Library/Application\ Support/ACE-Step\ UI/logs/server.log | grep -i "DYLD"
```

Alternatively, add a temporary `console.log` in `electron/main.js` after `setupLibraryPaths()`:
```js
console.log('DYLD_LIBRARY_PATH:', process.env.DYLD_LIBRARY_PATH);
```
The value must contain the absolute path to `bin/` (dev mode: `<repo>/bin`).

### Linux

```bash
cat ~/.config/ACE-Step\ UI/logs/server.log | grep -i "LD_LIBRARY"
```

Or add temporarily:
```js
console.log('LD_LIBRARY_PATH:', process.env.LD_LIBRARY_PATH);
```

---

## Step 7 — Verify dylib / soname symlinks at runtime (macOS)

After launching the app once, check that `fixMacosDylibLinks()` has created the symlinks if they were missing:

```bash
ls -la bin/*.dylib | grep " -> "
```

Expected: 10 symlinks total (2 per library × 5 libraries):
```
libggml-base.0.dylib      -> libggml-base.0.9.7.dylib
libggml-base.dylib        -> libggml-base.0.dylib
libggml-blas.0.dylib      -> libggml-blas.0.9.7.dylib
libggml-blas.dylib        -> libggml-blas.0.dylib
libggml-cpu.0.dylib       -> libggml-cpu.0.9.7.dylib
libggml-cpu.dylib         -> libggml-cpu.0.dylib
libggml-metal.0.dylib     -> libggml-metal.0.9.7.dylib
libggml-metal.dylib       -> libggml-metal.0.dylib
libggml.0.dylib           -> libggml.0.9.7.dylib
libggml.dylib             -> libggml.0.dylib
```

### Linux soname symlinks

After first launch:

```bash
ls -la bin/*.so* | grep " -> "
```

Expected:
```
libggml.so.0      -> libggml.so
libggml-base.so.0 -> libggml-base.so
```

---

## Step 8 — Smoke test: trigger a generation

1. With models present (or after downloading them), enter a short prompt such as `upbeat electronic music`
2. Set **Duration** to `5s` in the Advanced panel to keep the test fast
3. Click **Generate**
4. Watch the Debug tab — you should see `ace-qwen3` and `dit-vae` output lines appear
5. The generated audio file should appear in the Songs list and be playable

If the binaries fail to load their shared libraries you will see an error like:
- macOS: `dyld: Library not loaded: @rpath/libggml.dylib` or `image not found`
- Linux: `error while loading shared libraries: libggml.so.0: cannot open shared object file`

Either error means the library path setup is not working — check Steps 5–7 above.

---

## Step 9 — (macOS) Test the packaged `.dmg`

To fully validate the packaged release (as CI produces it):

```bash
npm run electron:build:mac
```

Open `release/*.dmg`, mount it, and drag **ACE-Step UI.app** to `/Applications`.  Launch it and repeat Steps 5–8.  The packaged app uses `process.resourcesPath/bin` instead of the dev-mode `bin/` directory — `fixMacosDylibLinks()` recreates any symlinks electron-builder may have dropped.

---

## Step 10 — Test the models path feature

This step validates the new first-run UX for users who already have ACE-Step models locally.

### 10a — Browse dialog

1. Remove (or temporarily rename) the models directory so the app treats this as a first run:

   ```bash
   # macOS
   mv ~/Library/Application\ Support/ACE-Step\ UI/models \
      ~/Library/Application\ Support/ACE-Step\ UI/models.bak

   # Linux
   mv ~/.config/ACE-Step\ UI/models ~/.config/ACE-Step\ UI/models.bak
   ```

2. Clear any saved preference so the dialog triggers:

   ```bash
   # macOS
   rm -f ~/Library/Application\ Support/ACE-Step\ UI/prefs.json

   # Linux
   rm -f ~/.config/ACE-Step\ UI/prefs.json
   ```

3. Run the app:

   ```bash
   npm run electron:dev
   ```

4. The first-run dialog should appear with **three** buttons:
   - `Download now (~8 GB)`
   - `Browse for existing models…`
   - `Skip — I'll add models manually`

5. Click **Browse for existing models…** and navigate to the `.bak` folder (or any folder containing `.gguf` files).

6. **Expected**: the app starts normally and the models folder in the loading status shows the path you selected.

7. Quit and relaunch — the dialog should **not** appear again; the persisted path is used automatically.

8. Verify the saved preference:

   ```bash
   # macOS
   cat ~/Library/Application\ Support/ACE-Step\ UI/prefs.json

   # Linux
   cat ~/.config/ACE-Step\ UI/prefs.json
   ```

   Expected content:
   ```json
   {
     "modelsDir": "/path/to/the/folder/you/selected"
   }
   ```

9. **Edge case — empty folder**: repeat from step 3, click Browse, and select a folder that contains **no** `.gguf` files.  A warning dialog should appear, the app should start without models (no crash), and `prefs.json` should **not** be updated.

### 10b — `MODELS_DIR` environment variable

The env var takes priority over saved preferences.

```bash
# macOS / Linux
MODELS_DIR=/path/to/your/models npm run electron:dev
```

**Expected**:
- The first-run dialog does **not** appear (models found via env var)
- The server uses the specified directory for model lookups
- The saved `prefs.json` (if any) is ignored in favour of the env var

To verify the server received the correct path, check the log:

```bash
# macOS
grep -i "MODELS_DIR\|models" ~/Library/Application\ Support/ACE-Step\ UI/logs/server.log | head -5

# Linux
grep -i "MODELS_DIR\|models" ~/.config/ACE-Step\ UI/logs/server.log | head -5
```

---

## Quick checklist

Copy this into a PR comment to report results:

```
### Electron pre-merge test results

**Platform:** macOS arm64 / Linux x64 (circle one)

- [ ] Step 1: Binary archive downloaded and extracted without errors
- [ ] Step 2: All binaries executable; all libggml dylibs / .so files present
- [ ] Step 3: Frontend and server builds succeed
- [ ] Step 4: `@electron/rebuild` succeeds for `better-sqlite3`
- [ ] Step 5: App starts — loading window shows "Checking models…" first, then "Starting server…"; UI opens; no library errors
- [ ] Step 6: `DYLD_LIBRARY_PATH` / `LD_LIBRARY_PATH` points to `bin/`
- [ ] Step 7: All expected dylib / soname symlinks present after first launch
- [ ] Step 8: Generation smoke test completes and audio is playable
- [ ] Step 9 (macOS): Packaged `.dmg` installs and runs correctly
- [ ] Step 10a: Browse dialog — picking a valid folder persists path; invalid folder shows warning; preference survives relaunch
- [ ] Step 10b: `MODELS_DIR` env var overrides saved preference; dialog skipped when models found

**Notes / failures:**
<!-- describe anything unexpected -->
```
