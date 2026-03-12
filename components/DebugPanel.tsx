import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { Trash2, RefreshCw, ChevronDown } from 'lucide-react';

interface JobSummary {
  jobId: string;
  status: string;
  startTime: number;
  stage?: string;
  logCount: number;
}

const POLL_INTERVAL_MS = 1500;

export const DebugPanel: React.FC = () => {
  const { token } = useAuth();

  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>('');
  const [lines, setLines] = useState<string[]>([]);
  const [lineOffset, setLineOffset] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isPolling, setIsPolling] = useState(false);

  const consoleRef = useRef<HTMLPreElement>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offsetRef = useRef(0);
  const selectedJobRef = useRef('');

  // Keep refs in sync
  useEffect(() => { offsetRef.current = lineOffset; }, [lineOffset]);
  useEffect(() => { selectedJobRef.current = selectedJobId; }, [selectedJobId]);

  const fetchJobList = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/generate/logs', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const jobList: JobSummary[] = data.jobs || [];
        setJobs(jobList);
        // Auto-select the most recent job if none is selected
        if (!selectedJobRef.current && jobList.length > 0) {
          setSelectedJobId(jobList[0].jobId);
        }
      }
    } catch { /* ignore */ }
  }, [token]);

  const fetchLogs = useCallback(async () => {
    const jobId = selectedJobRef.current;
    if (!token || !jobId) return;
    try {
      const res = await fetch(`/api/generate/logs/${jobId}?after=${offsetRef.current}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.lines && data.lines.length > 0) {
          setLines(prev => [...prev, ...data.lines]);
          const newOffset = offsetRef.current + data.lines.length;
          offsetRef.current = newOffset;
          setLineOffset(newOffset);
        }
      }
    } catch { /* ignore */ }
  }, [token]);

  // Poll loop
  const schedulePoll = useCallback(() => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = setTimeout(async () => {
      await fetchJobList();
      await fetchLogs();
      schedulePoll();
    }, POLL_INTERVAL_MS);
  }, [fetchJobList, fetchLogs]);

  useEffect(() => {
    setIsPolling(true);
    void fetchJobList();
    void fetchLogs();
    schedulePoll();
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [fetchJobList, fetchLogs, schedulePoll]);

  // Reset log view when job changes
  useEffect(() => {
    setLines([]);
    setLineOffset(0);
    offsetRef.current = 0;
  }, [selectedJobId]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  const handleScroll = () => {
    if (!consoleRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = consoleRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(atBottom);
  };

  const handleClear = () => {
    setLines([]);
    setLineOffset(0);
    offsetRef.current = 0;
  };

  const handleRefresh = async () => {
    await fetchJobList();
    await fetchLogs();
  };

  const scrollToBottom = () => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
    setAutoScroll(true);
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString();
  };

  const statusColor = (s: string) => {
    if (s === 'succeeded') return 'text-green-400';
    if (s === 'failed') return 'text-red-400';
    if (s === 'running') return 'text-amber-400';
    return 'text-zinc-400';
  };

  const colorize = (line: string) => {
    if (/^=== .* ===$/.test(line)) return 'text-cyan-300 font-bold';
    if (/^--- Running /.test(line) || /^\$ /.test(line)) return 'text-emerald-400 font-semibold';
    if (/error|Error|failed|Failed|FAILED/i.test(line)) return 'text-red-400';
    if (/warning|Warning/i.test(line)) return 'text-amber-400';
    if (/^\[DiT\]/.test(line)) return 'text-sky-300';
    if (/^\[VAE\]/.test(line)) return 'text-violet-300';
    if (/^\[Phase1\]|\[Phase2\]|\[Decode\]/.test(line)) return 'text-pink-300';
    if (/^\[stdout\]/.test(line)) return 'text-zinc-400';
    return 'text-green-300';
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-green-300 font-mono">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-zinc-900 border-b border-zinc-800 flex-shrink-0">
        <span className="text-xs font-bold text-zinc-300 uppercase tracking-widest">Debug Console</span>

        {/* Job selector */}
        <div className="relative flex-1 max-w-xs">
          <select
            value={selectedJobId}
            onChange={(e) => setSelectedJobId(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500 appearance-none pr-6 cursor-pointer"
          >
            {jobs.length === 0 && <option value="">No jobs yet</option>}
            {jobs.map(j => (
              <option key={j.jobId} value={j.jobId}>
                [{j.status.toUpperCase()}] {formatTime(j.startTime)} — {j.jobId.slice(-8)} ({j.logCount} lines)
              </option>
            ))}
          </select>
          <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
        </div>

        {/* Job status badge */}
        {selectedJobId && jobs.find(j => j.jobId === selectedJobId) && (
          <span className={`text-[10px] font-bold uppercase ${statusColor(jobs.find(j => j.jobId === selectedJobId)!.status)}`}>
            ● {jobs.find(j => j.jobId === selectedJobId)!.status}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {isPolling && (
            <span className="text-[9px] text-emerald-500 animate-pulse">● LIVE</span>
          )}
          <button
            onClick={handleRefresh}
            title="Refresh now"
            className="p-1.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <RefreshCw size={13} />
          </button>
          <button
            onClick={handleClear}
            title="Clear view (does not stop logging)"
            className="p-1.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Log output */}
      <pre
        ref={consoleRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-3 text-[11px] leading-[1.6] whitespace-pre-wrap break-all custom-scrollbar"
        style={{ fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace" }}
      >
        {lines.length === 0 ? (
          <span className="text-zinc-600">
            {selectedJobId
              ? 'Waiting for output…'
              : jobs.length === 0
                ? 'No generation jobs found. Start a generation to see debug output here.'
                : 'Select a job above to view its logs.'}
          </span>
        ) : (
          lines.map((line, i) => (
            <span key={i} className={`block ${colorize(line)}`}>{line}</span>
          ))
        )}
      </pre>

      {/* Footer: scroll-to-bottom hint */}
      {!autoScroll && lines.length > 0 && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-16 right-6 flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-[10px] font-medium px-3 py-1.5 rounded-full shadow-lg transition-colors"
        >
          <ChevronDown size={12} /> Scroll to bottom
        </button>
      )}
    </div>
  );
};
