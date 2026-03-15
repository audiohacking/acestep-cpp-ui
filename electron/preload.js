/**
 * Electron preload script — ACE-Step UI
 *
 * Runs in the renderer process before any web content is loaded.
 * Exposes a minimal, read-only API to the renderer via contextBridge.
 *
 * The app communicates with the backend through HTTP on localhost, so this
 * preload is intentionally thin — no IPC channels needed.
 */

import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  /** Current OS platform string, e.g. 'darwin', 'linux', 'win32' */
  platform: process.platform,
  /** Electron and Node.js version strings for diagnostics */
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
  },
});
