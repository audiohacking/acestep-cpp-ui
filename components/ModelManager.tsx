import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Download, CheckCircle2, Circle, AlertCircle, Loader2,
  ChevronDown, ChevronUp, RefreshCw, Star, HardDrive, Zap,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { modelsApi, CatalogEntry, DownloadJob, ModelStatus } from '../services/api';

// ── Quant quality labels ─────────────────────────────────────────────────────
const QUANT_INFO: Record<string, { label: string; vram: string; quality: string }> = {
  'BF16':   { label: 'BF16 (Full)',  vram: 'Most VRAM',   quality: 'Reference quality' },
  'Q8_0':   { label: 'Q8 (High)',    vram: 'High VRAM',   quality: 'Near-lossless' },
  'Q6_K':   { label: 'Q6 (Good)',    vram: 'Medium VRAM', quality: 'Excellent quality' },
  'Q5_K_M': { label: 'Q5 (Balanced)',vram: 'Medium VRAM', quality: 'Great quality' },
  'Q4_K_M': { label: 'Q4 (Small)',   vram: 'Low VRAM',    quality: 'Good quality' },
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

function formatMB(mb: number): string {
  return mb >= 1000 ? `~${(mb / 1024).toFixed(1)} GB` : `~${mb} MB`;
}

// Group ordering for display
const GROUP_ORDER = ['vae', 'encoder', 'lm', 'dit'] as const;
const GROUP_LABEL: Record<string, string> = {
  vae:     'VAE',
  encoder: 'Text Encoder',
  lm:      'Language Model (LM)',
  dit:     'DiT (Music Generator)',
};

// ── Component ─────────────────────────────────────────────────────────────────
export function ModelManager() {
  const { token } = useAuth();
  const [status, setStatus]           = useState<ModelStatus | null>(null);
  const [queue, setQueue]             = useState<DownloadJob[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [selectedQuant, setSelectedQuant] = useState<string>('Q8_0');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['dit', 'lm']));
  const [showOptional, setShowOptional] = useState(false);
  const [activeMsg, setActiveMsg]     = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  // ── Fetch disk status ──────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    try {
      const s = await modelsApi.getStatus();
      setStatus(s);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // ── SSE progress stream ────────────────────────────────────────────────────
  useEffect(() => {
    const es = modelsApi.streamProgress();
    esRef.current = es;

    es.addEventListener('queue', (e: MessageEvent) => {
      setQueue(JSON.parse(e.data));
    });
    es.addEventListener('progress', (e: MessageEvent) => {
      const job: DownloadJob = JSON.parse(e.data);
      setQueue(prev => {
        const idx = prev.findIndex(j => j.id === job.id);
        if (idx === -1) return [...prev, job];
        const next = [...prev];
        next[idx] = job;
        return next;
      });
    });
    es.addEventListener('done', () => { refresh(); });
    es.addEventListener('queue_empty', () => { refresh(); });

    return () => { es.close(); esRef.current = null; };
  }, [refresh]);

  // ── Download helpers ───────────────────────────────────────────────────────
  const enqueueDownload = useCallback(async (files: string[]) => {
    if (!token) return;
    try {
      await modelsApi.download(files, token);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [token, refresh]);

  const downloadEssentials = useCallback(() => {
    if (!status) return;
    const missing = status.catalog
      .filter(f => f.essential && f.quant === selectedQuant && !f.downloaded && !f.queued)
      .map(f => f.filename);
    // VAE is always BF16
    const vae = status.catalog.find(f => f.group === 'vae');
    const files = [...new Set([
      ...(vae && !vae.downloaded ? [vae.filename] : []),
      ...missing,
    ])];
    if (files.length > 0) enqueueDownload(files);
  }, [status, selectedQuant, enqueueDownload]);

  const setActiveModel = useCallback(async (filename: string) => {
    if (!token) return;
    try {
      const res = await modelsApi.setActive(filename, token);
      setActiveMsg(`Active model → ${res.filename}`);
      setTimeout(() => setActiveMsg(null), 3000);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [token, refresh]);

  // ── Job lookup helper ──────────────────────────────────────────────────────
  const jobFor = useCallback((filename: string) =>
    queue.find(j => j.filename === filename), [queue]);

  // ── Render helpers ─────────────────────────────────────────────────────────
  const toggleGroup = (g: string) =>
    setExpandedGroups(prev => { const n = new Set(prev); n.has(g) ? n.delete(g) : n.add(g); return n; });

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-gray-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Loading model status…
      </div>
    );
  }

  const catalog = status?.catalog ?? [];
  const essentialsDone = catalog.filter(f => f.essential).every(f => f.downloaded);
  const essentialsMissing = catalog.filter(f => f.essential && !f.downloaded && !f.queued);

  // Group catalog entries
  const grouped = GROUP_ORDER.reduce((acc, g) => {
    acc[g] = catalog.filter(f => f.group === g && (showOptional || f.essential || f.downloaded));
    return acc;
  }, {} as Record<string, CatalogEntry[]>);

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-100">Model Manager</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            GGUF models from{' '}
            <a href="https://huggingface.co/Serveurperso/ACE-Step-1.5-GGUF"
               target="_blank" rel="noopener noreferrer"
               className="text-purple-400 hover:underline">
              Serveurperso/ACE-Step-1.5-GGUF
            </a>
          </p>
        </div>
        <button onClick={refresh} className="p-2 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {activeMsg && (
        <div className="flex items-center gap-2 p-3 bg-green-900/30 border border-green-700 rounded-lg text-green-300 text-sm">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          {activeMsg}
        </div>
      )}

      {/* Storage location */}
      {status && (
        <div className="flex items-center gap-2 p-3 bg-gray-800 rounded-lg text-sm text-gray-400">
          <HardDrive className="w-4 h-4 flex-shrink-0" />
          <span className="font-mono truncate">{status.modelsDir}</span>
          <span className="text-gray-500 ml-auto whitespace-nowrap">
            {status.onDisk.length} file{status.onDisk.length !== 1 ? 's' : ''} on disk
          </span>
        </div>
      )}

      {/* Quick download strip */}
      <div className="p-4 bg-gray-800 rounded-xl border border-gray-700 space-y-3">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-yellow-400" />
          <span className="font-medium text-gray-200 text-sm">Quick Setup — Essential Models</span>
          {essentialsDone && (
            <span className="ml-auto flex items-center gap-1 text-green-400 text-xs">
              <CheckCircle2 className="w-3.5 h-3.5" /> All downloaded
            </span>
          )}
        </div>
        <p className="text-xs text-gray-400">
          Downloads VAE + Text Encoder + LM-4B + DiT-Turbo — the minimum needed to generate music.
        </p>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Quant selector */}
          <select
            value={selectedQuant}
            onChange={e => setSelectedQuant(e.target.value)}
            className="text-sm bg-gray-700 border border-gray-600 rounded-lg px-2 py-1.5 text-gray-200 focus:outline-none focus:ring-1 focus:ring-purple-500"
          >
            {Object.entries(QUANT_INFO).map(([q, info]) => (
              <option key={q} value={q}>{info.label} — {info.vram}</option>
            ))}
          </select>

          {essentialsMissing.length > 0 && (
            <button
              onClick={downloadEssentials}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-sm rounded-lg transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Download {essentialsMissing.length} missing file{essentialsMissing.length !== 1 ? 's' : ''}
            </button>
          )}
        </div>

        {/* Active download progress */}
        {queue.filter(j => j.status === 'downloading' || j.status === 'queued').length > 0 && (
          <div className="space-y-2 pt-1">
            {queue.map(job => (
              <div key={job.id} className="space-y-1">
                <div className="flex items-center justify-between text-xs text-gray-400">
                  <span className="font-mono truncate max-w-xs">{job.filename}</span>
                  <span>
                    {job.status === 'queued' ? 'Queued' :
                     job.status === 'downloading' && job.totalBytes > 0
                       ? `${formatBytes(job.downloadedBytes)} / ${formatBytes(job.totalBytes)}`
                       : job.status === 'done' ? 'Done'
                       : job.error ?? job.status}
                  </span>
                </div>
                {job.status === 'downloading' && job.totalBytes > 0 && (
                  <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-purple-500 transition-all duration-300"
                      style={{ width: `${Math.round((job.downloadedBytes / job.totalBytes) * 100)}%` }}
                    />
                  </div>
                )}
                {job.status === 'downloading' && job.totalBytes === 0 && (
                  <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div className="h-full bg-purple-500 animate-pulse w-1/3" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Show optional toggle */}
      <button
        onClick={() => setShowOptional(!showOptional)}
        className="text-sm text-purple-400 hover:text-purple-300 flex items-center gap-1"
      >
        {showOptional ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        {showOptional ? 'Hide optional models' : 'Show all models'}
      </button>

      {/* Model groups */}
      {GROUP_ORDER.map(group => {
        const entries = grouped[group];
        if (!entries || entries.length === 0) return null;
        const isExpanded = expandedGroups.has(group);

        return (
          <div key={group} className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
            {/* Group header */}
            <button
              onClick={() => toggleGroup(group)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-750 transition-colors"
            >
              <span className="font-medium text-gray-200 text-sm">{GROUP_LABEL[group]}</span>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span>{entries.filter(f => f.downloaded).length}/{entries.length} downloaded</span>
                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </div>
            </button>

            {/* Entries */}
            {isExpanded && (
              <div className="divide-y divide-gray-700/50">
                {entries.map(entry => {
                  const job = jobFor(entry.filename);
                  const isDownloading = job?.status === 'downloading';
                  const isQueued      = job?.status === 'queued';
                  const progress      = isDownloading && job.totalBytes > 0
                    ? Math.round((job.downloadedBytes / job.totalBytes) * 100) : null;

                  return (
                    <div key={entry.filename}
                         className={`flex items-center gap-3 px-4 py-2.5 ${entry.active ? 'bg-purple-900/20' : ''}`}>

                      {/* Status icon */}
                      <div className="flex-shrink-0 w-5">
                        {entry.active ? (
                          <Star className="w-4 h-4 text-purple-400" />
                        ) : entry.downloaded ? (
                          <CheckCircle2 className="w-4 h-4 text-green-500" />
                        ) : isDownloading || isQueued ? (
                          <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
                        ) : (
                          <Circle className="w-4 h-4 text-gray-600" />
                        )}
                      </div>

                      {/* Label + filename */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm text-gray-200">{entry.label}</span>
                          {entry.essential && (
                            <span className="text-xs px-1.5 py-0.5 bg-purple-900/50 text-purple-300 rounded">
                              essential
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 font-mono truncate">{entry.filename}</div>
                        {isDownloading && progress !== null && (
                          <div className="mt-1 h-1 bg-gray-700 rounded-full overflow-hidden w-48">
                            <div className="h-full bg-purple-500 transition-all" style={{ width: `${progress}%` }} />
                          </div>
                        )}
                      </div>

                      {/* Size */}
                      <span className="text-xs text-gray-500 whitespace-nowrap hidden sm:block">
                        {formatMB(entry.approxSizeMB)}
                      </span>

                      {/* Actions */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {entry.downloaded && !entry.active && entry.group === 'dit' && (
                          <button
                            onClick={() => setActiveModel(entry.filename)}
                            title="Set as active model"
                            className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
                          >
                            Use
                          </button>
                        )}
                        {!entry.downloaded && !isDownloading && !isQueued && (
                          <button
                            onClick={() => enqueueDownload([entry.filename])}
                            title="Download"
                            className="p-1.5 text-gray-400 hover:text-purple-300 hover:bg-gray-700 rounded transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {isQueued && (
                          <span className="text-xs text-gray-500">Queued</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Command-line alternative */}
      <div className="p-4 bg-gray-800/50 rounded-xl border border-gray-700 space-y-2">
        <p className="text-xs font-medium text-gray-400">Or download via command line (no Python required):</p>
        <pre className="text-xs text-gray-300 font-mono bg-gray-900 rounded p-3 overflow-x-auto">
{`# Default Q8_0 essentials
./models.sh

# Choose a different quant
./models.sh --quant Q6_K

# All models
./models.sh --all`}
        </pre>
      </div>
    </div>
  );
}
