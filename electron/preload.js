/**
 * Electron preload script — ACE-Step UI
 *
 * Shared by both the loading/setup window (electron/loading.html) and the
 * main app window (http://localhost:PORT).
 *
 * Exposes two namespaces via contextBridge:
 *   • setupAPI   — used by loading.html to receive setup-progress events
 *   • electronAPI — read-only platform info available to the main React app
 *
 * The React app communicates with the backend through HTTP on localhost, so
 * no additional IPC channels are needed for the main window.
 */

import { contextBridge, ipcRenderer } from 'electron';

// ── Setup / loading window API ────────────────────────────────────────────────
// Receives status events sent from the main process during startup and
// first-run model downloads.
contextBridge.exposeInMainWorld('setupAPI', {
  /**
   * Register a callback that receives `{ msg, pct, label }` objects
   * whenever the main process calls `win.webContents.send('setup:status', …)`.
   */
  onStatus: (callback) => {
    ipcRenderer.on('setup:status', (_event, data) => callback(data));
  },
});

// ── Main app API ──────────────────────────────────────────────────────────────
contextBridge.exposeInMainWorld('electronAPI', {
  /** Current OS platform string, e.g. 'darwin', 'linux', 'win32' */
  platform: process.platform,
  /** Electron and Node.js version strings for diagnostics */
  versions: {
    electron: process.versions.electron,
    node:     process.versions.node,
  },
});
