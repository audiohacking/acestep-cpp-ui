import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Sparkles, ChevronDown, Settings2, Trash2, Music2, Sliders, Dices, Hash, RefreshCw, Plus, Upload, Play, Pause, Loader2, AlertTriangle, CheckCircle2, ExternalLink, Info } from 'lucide-react';
import { GenerationParams, Song } from '../types';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/I18nContext';
import { generateApi } from '../services/api';
import { MAIN_STYLES } from '../data/genres';
import { EditableSlider } from './EditableSlider';

interface ReferenceTrack {
  id: string;
  filename: string;
  storage_key: string;
  duration: number | null;
  file_size_bytes: number | null;
  tags: string[] | null;
  created_at: string;
  audio_url: string;
}

interface CreatePanelProps {
  onGenerate: (params: GenerationParams) => void;
  isGenerating: boolean;
  initialData?: { song: Song, timestamp: number } | null;
  createdSongs?: Song[];
  pendingAudioSelection?: { target: 'reference' | 'source'; url: string; title?: string } | null;
  onAudioSelectionApplied?: () => void;
}

const KEY_SIGNATURES = [
  '',
  'C major', 'C minor',
  'C# major', 'C# minor',
  'Db major', 'Db minor',
  'D major', 'D minor',
  'D# major', 'D# minor',
  'Eb major', 'Eb minor',
  'E major', 'E minor',
  'F major', 'F minor',
  'F# major', 'F# minor',
  'Gb major', 'Gb minor',
  'G major', 'G minor',
  'G# major', 'G# minor',
  'Ab major', 'Ab minor',
  'A major', 'A minor',
  'A# major', 'A# minor',
  'Bb major', 'Bb minor',
  'B major', 'B minor'
];

const TIME_SIGNATURES = ['', '2', '3', '4', '6', 'N/A'];

const TRACK_NAMES = [
  'woodwinds', 'brass', 'fx', 'synth', 'strings', 'percussion',
  'keyboard', 'guitar', 'bass', 'drums', 'backing_vocals', 'vocals',
];

const VOCAL_LANGUAGE_KEYS = [
  { value: 'unknown', key: 'autoInstrumental' as const },
  { value: 'ar', key: 'vocalArabic' as const },
  { value: 'az', key: 'vocalAzerbaijani' as const },
  { value: 'bg', key: 'vocalBulgarian' as const },
  { value: 'bn', key: 'vocalBengali' as const },
  { value: 'ca', key: 'vocalCatalan' as const },
  { value: 'cs', key: 'vocalCzech' as const },
  { value: 'da', key: 'vocalDanish' as const },
  { value: 'de', key: 'vocalGerman' as const },
  { value: 'el', key: 'vocalGreek' as const },
  { value: 'en', key: 'vocalEnglish' as const },
  { value: 'es', key: 'vocalSpanish' as const },
  { value: 'fa', key: 'vocalPersian' as const },
  { value: 'fi', key: 'vocalFinnish' as const },
  { value: 'fr', key: 'vocalFrench' as const },
  { value: 'he', key: 'vocalHebrew' as const },
  { value: 'hi', key: 'vocalHindi' as const },
  { value: 'hr', key: 'vocalCroatian' as const },
  { value: 'ht', key: 'vocalHaitianCreole' as const },
  { value: 'hu', key: 'vocalHungarian' as const },
  { value: 'id', key: 'vocalIndonesian' as const },
  { value: 'is', key: 'vocalIcelandic' as const },
  { value: 'it', key: 'vocalItalian' as const },
  { value: 'ja', key: 'vocalJapanese' as const },
  { value: 'ko', key: 'vocalKorean' as const },
  { value: 'la', key: 'vocalLatin' as const },
  { value: 'lt', key: 'vocalLithuanian' as const },
  { value: 'ms', key: 'vocalMalay' as const },
  { value: 'ne', key: 'vocalNepali' as const },
  { value: 'nl', key: 'vocalDutch' as const },
  { value: 'no', key: 'vocalNorwegian' as const },
  { value: 'pa', key: 'vocalPunjabi' as const },
  { value: 'pl', key: 'vocalPolish' as const },
  { value: 'pt', key: 'vocalPortuguese' as const },
  { value: 'ro', key: 'vocalRomanian' as const },
  { value: 'ru', key: 'vocalRussian' as const },
  { value: 'sa', key: 'vocalSanskrit' as const },
  { value: 'sk', key: 'vocalSlovak' as const },
  { value: 'sr', key: 'vocalSerbian' as const },
  { value: 'sv', key: 'vocalSwedish' as const },
  { value: 'sw', key: 'vocalSwahili' as const },
  { value: 'ta', key: 'vocalTamil' as const },
  { value: 'te', key: 'vocalTelugu' as const },
  { value: 'th', key: 'vocalThai' as const },
  { value: 'tl', key: 'vocalTagalog' as const },
  { value: 'tr', key: 'vocalTurkish' as const },
  { value: 'uk', key: 'vocalUkrainian' as const },
  { value: 'ur', key: 'vocalUrdu' as const },
  { value: 'vi', key: 'vocalVietnamese' as const },
  { value: 'yue', key: 'vocalCantonese' as const },
  { value: 'zh', key: 'vocalChineseMandarin' as const },
];

export const CreatePanel: React.FC<CreatePanelProps> = ({
  onGenerate,
  isGenerating,
  initialData,
  createdSongs = [],
  pendingAudioSelection,
  onAudioSelectionApplied,
}) => {
  const { isAuthenticated, token, user } = useAuth();
  const { t } = useI18n();

  // Randomly select 6 music tags from MAIN_STYLES
  const [musicTags, setMusicTags] = useState<string[]>(() => {
    const shuffled = [...MAIN_STYLES].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 6);
  });

  // Function to refresh music tags
  const refreshMusicTags = useCallback(() => {
    const shuffled = [...MAIN_STYLES].sort(() => Math.random() - 0.5);
    setMusicTags(shuffled.slice(0, 6));
  }, []);

  // Mode
  // Unified mode: always use the full-featured panel (no simple/custom split)
  const customMode = true;

  // Workspace ID: read from URL ?wid= query param, generate if absent
  const workspaceId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    let wid = params.get('wid');
    if (!wid) {
      wid = (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2, 12)));
      const newParams = new URLSearchParams(window.location.search);
      newParams.set('wid', wid);
      window.history.replaceState({}, '', window.location.pathname + '?' + newParams.toString());
    }
    return wid;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  // Load persisted settings once at mount (before any useState calls)
  const savedSettings = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('ace-settings-' + workspaceId) || '{}'); } catch { return {}; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // empty dep array: run once on mount only

  // Custom Mode
  const [lyrics, setLyrics] = useState<string>(savedSettings.lyrics ?? '');
  const [style, setStyle] = useState<string>(savedSettings.style ?? '');
  const [title, setTitle] = useState<string>(savedSettings.title ?? '');

  // Common
  const [instrumental, setInstrumental] = useState<boolean>(savedSettings.instrumental ?? false);
  const [vocalLanguage, setVocalLanguage] = useState<string>(savedSettings.vocalLanguage ?? 'en');
  const [vocalGender, setVocalGender] = useState<'male' | 'female' | ''>(savedSettings.vocalGender ?? '');

  // Music Parameters
  const [bpm, setBpm] = useState<number>(savedSettings.bpm ?? 0);
  const [keyScale, setKeyScale] = useState<string>(savedSettings.keyScale ?? '');
  const [timeSignature, setTimeSignature] = useState<string>(savedSettings.timeSignature ?? '');

  // Advanced Settings
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [duration, setDuration] = useState<number>(savedSettings.duration ?? -1);
  const [batchSize, setBatchSize] = useState(() => {
    const stored = localStorage.getItem('ace-batchSize');
    return stored ? Number(stored) : 1;
  });
  const [bulkCount, setBulkCount] = useState(() => {
    const stored = localStorage.getItem('ace-bulkCount');
    return stored ? Number(stored) : 1;
  });
  const [guidanceScale, setGuidanceScale] = useState<number>(savedSettings.guidanceScale ?? 9.0);
  const [randomSeed, setRandomSeed] = useState<boolean>(savedSettings.randomSeed ?? true);
  const [seed, setSeed] = useState<number>(savedSettings.seed ?? -1);
  const [thinking, setThinking] = useState<boolean>(savedSettings.thinking ?? false); // Default false for GPU compatibility
  const [enhance, setEnhance] = useState<boolean>(savedSettings.enhance ?? false); // AI Enhance: uses LLM to enrich caption & generate metadata
  const [audioFormat, setAudioFormat] = useState<'mp3' | 'flac'>(savedSettings.audioFormat ?? 'mp3');
  const [inferenceSteps, setInferenceSteps] = useState<number>(savedSettings.inferenceSteps ?? 12);
  const [inferMethod, setInferMethod] = useState<'ode' | 'sde'>(savedSettings.inferMethod ?? 'ode');
  const [lmBackend, setLmBackend] = useState<'pt' | 'vllm'>(savedSettings.lmBackend ?? 'pt');
  const [lmModel, setLmModel] = useState(() => {
    return localStorage.getItem('ace-lmModel') || 'acestep-5Hz-lm-0.6B';
  });
  const [shift, setShift] = useState<number>(savedSettings.shift ?? 3.0);

  // LM Parameters (under Expert)
  const [showLmParams, setShowLmParams] = useState(false);
  const [lmTemperature, setLmTemperature] = useState<number>(savedSettings.lmTemperature ?? 0.8);
  const [lmCfgScale, setLmCfgScale] = useState<number>(savedSettings.lmCfgScale ?? 2.2);
  const [lmTopK, setLmTopK] = useState<number>(savedSettings.lmTopK ?? 0);
  const [lmTopP, setLmTopP] = useState<number>(savedSettings.lmTopP ?? 0.92);
  const [lmNegativePrompt, setLmNegativePrompt] = useState<string>(savedSettings.lmNegativePrompt ?? 'NO USER INPUT');

  // Expert Parameters (now in Advanced section)
  // Note: audio URLs are NOT persisted — they may point to deleted/temporary files
  const [referenceAudioUrl, setReferenceAudioUrl] = useState('');
  const [sourceAudioUrl, setSourceAudioUrl] = useState('');
  const [referenceAudioTitle, setReferenceAudioTitle] = useState('');
  const [sourceAudioTitle, setSourceAudioTitle] = useState('');
  const [audioCodes, setAudioCodes] = useState('');
  const [repaintingStart, setRepaintingStart] = useState(0);
  const [repaintingEnd, setRepaintingEnd] = useState(-1);
  const [instruction, setInstruction] = useState('Fill the audio semantic mask based on the given conditions:');
  const [audioCoverStrength, setAudioCoverStrength] = useState<number>(savedSettings.audioCoverStrength ?? 1.0);
  const [taskType, setTaskType] = useState<string>(savedSettings.taskType ?? 'text2music');
  const [useAdg, setUseAdg] = useState(false);
  const [cfgIntervalStart, setCfgIntervalStart] = useState(0.0);
  const [cfgIntervalEnd, setCfgIntervalEnd] = useState(1.0);
  const [customTimesteps, setCustomTimesteps] = useState('');
  const [useCotMetas, setUseCotMetas] = useState(true);
  const [useCotCaption, setUseCotCaption] = useState(true);
  const [useCotLanguage, setUseCotLanguage] = useState(true);
  const [autogen, setAutogen] = useState(false);
  const [constrainedDecodingDebug, setConstrainedDecodingDebug] = useState(false);
  const [allowLmBatch, setAllowLmBatch] = useState(true);
  const [getScores, setGetScores] = useState(false);
  const [getLrc, setGetLrc] = useState(false);
  const [scoreScale, setScoreScale] = useState(0.5);
  const [lmBatchChunkSize, setLmBatchChunkSize] = useState(8);
  const [trackName, setTrackName] = useState<string>(savedSettings.trackName ?? '');
  const [completeTrackClasses, setCompleteTrackClasses] = useState<string>(savedSettings.completeTrackClasses ?? '');
  const [isFormatCaption, setIsFormatCaption] = useState(false);
  // Parsed array — memoised so the split doesn't run on every render
  const completeTrackClassesParsed = useMemo(
    () => completeTrackClasses.split(',').map(s => s.trim()).filter(Boolean),
    [completeTrackClasses]
  );
  const [maxDurationWithLm, setMaxDurationWithLm] = useState(240);
  const [maxDurationWithoutLm, setMaxDurationWithoutLm] = useState(240);

  // LoRA Parameters
  const [showLoraPanel, setShowLoraPanel] = useState(false);
  const [loraPath, setLoraPath] = useState('./lora_output/final/adapter');
  const [loraLoaded, setLoraLoaded] = useState(false);
  const [loraEnabled, setLoraEnabled] = useState(true);
  const [loraScale, setLoraScale] = useState(1.0);
  const [loraError, setLoraError] = useState<string | null>(null);
  const [isLoraLoading, setIsLoraLoading] = useState(false);

  // Model selection
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    return localStorage.getItem('ace-model') || 'acestep-v15-turbo-shift3';
  });
  const [showModelMenu, setShowModelMenu] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const previousModelRef = useRef<string>(selectedModel);
  
  // Available models fetched from backend
  const [fetchedModels, setFetchedModels] = useState<{ name: string; is_active: boolean; is_preloaded: boolean }[]>([]);

  // The SFT DiT model name — required for repaint mode
  const SFT_MODEL_NAME = 'acestep-v15-sft';
  // The SFT model GGUF file to download when not present (Q8_0 is the default quality tier)
  const SFT_MODEL_FILE = 'acestep-v15-sft-Q8_0.gguf';

  // The base DiT model name — required for lego mode
  const BASE_MODEL_NAME = 'acestep-v15-base';

  // Fallback model list when backend is unavailable
  const availableModels = useMemo(() => {
    if (fetchedModels.length > 0) {
      return fetchedModels.map(m => ({ id: m.name, name: m.name }));
    }
    return [
      { id: 'acestep-v15-base', name: 'acestep-v15-base' },
      { id: SFT_MODEL_NAME, name: SFT_MODEL_NAME },
      { id: 'acestep-v15-turbo', name: 'acestep-v15-turbo' },
      { id: 'acestep-v15-turbo-shift1', name: 'acestep-v15-turbo-shift1' },
      { id: 'acestep-v15-turbo-shift3', name: 'acestep-v15-turbo-shift3' },
      { id: 'acestep-v15-turbo-continuous', name: 'acestep-v15-turbo-continuous' },
    ];
  }, [fetchedModels]);

  // Map model ID to short display name
  const getModelDisplayName = (modelId: string): string => {
    const mapping: Record<string, string> = {
      'acestep-v15-base': '1.5B',
      'acestep-v15-sft': '1.5S',
      'acestep-v15-turbo-shift1': '1.5TS1',
      'acestep-v15-turbo-shift3': '1.5TS3',
      'acestep-v15-turbo-continuous': '1.5TC',
      'acestep-v15-turbo': '1.5T',
    };
    return mapping[modelId] || modelId;
  };

  // Check if model is a turbo variant
  const isTurboModel = (modelId: string): boolean => {
    return modelId.includes('turbo');
  };

  // Check if model is an SFT variant (required for repaint)
  const isSftModel = (modelId: string): boolean => {
    return modelId.includes('sft');
  };

  // Check if model is the base variant (required for lego)
  const isBaseModel = (modelId: string): boolean => {
    return modelId.startsWith('acestep-v15-base');
  };

  // SFT model download/availability state for repaint mode
  type SftStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'unavailable';
  const [sftStatus, setSftStatus] = useState<SftStatus>('idle');
  const sftSseRef = useRef<EventSource | null>(null);

  // Understand state — per audio target
  type UnderstandStatus = 'idle' | 'running' | 'done' | 'error';
  const [understandStatus, setUnderstandStatus] = useState<Record<'reference' | 'source', UnderstandStatus>>({ reference: 'idle', source: 'idle' });
  const [understandResult, setUnderstandResult] = useState<Record<'reference' | 'source', Record<string, unknown> | null>>({ reference: null, source: null });
  const [understandError, setUnderstandError] = useState<Record<'reference' | 'source', string | null>>({ reference: null, source: null });

  const [isUploadingReference, setIsUploadingReference] = useState(false);
  const [isUploadingSource, setIsUploadingSource] = useState(false);
  const [isTranscribingReference, setIsTranscribingReference] = useState(false);
  const transcribeAbortRef = useRef<AbortController | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isFormattingStyle, setIsFormattingStyle] = useState(false);
  const [isFormattingLyrics, setIsFormattingLyrics] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [dragKind, setDragKind] = useState<'file' | 'audio' | null>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [showAudioModal, setShowAudioModal] = useState(false);
  const [audioModalTarget, setAudioModalTarget] = useState<'reference' | 'source'>('reference');
  const [tempAudioUrl, setTempAudioUrl] = useState('');
  const [audioTab, setAudioTab] = useState<'reference' | 'source' | 'lego'>('reference');
  const referenceAudioRef = useRef<HTMLAudioElement>(null);
  const sourceAudioRef = useRef<HTMLAudioElement>(null);
  const [referencePlaying, setReferencePlaying] = useState(false);
  const [sourcePlaying, setSourcePlaying] = useState(false);
  const [referenceTime, setReferenceTime] = useState(0);
  const [sourceTime, setSourceTime] = useState(0);
  const [referenceDuration, setReferenceDuration] = useState(0);
  const [sourceDuration, setSourceDuration] = useState(0);

  // Reference tracks modal state
  const [referenceTracks, setReferenceTracks] = useState<ReferenceTrack[]>([]);
  const [isLoadingTracks, setIsLoadingTracks] = useState(false);
  const [playingTrackId, setPlayingTrackId] = useState<string | null>(null);
  const [playingTrackSource, setPlayingTrackSource] = useState<'uploads' | 'created' | null>(null);
  const modalAudioRef = useRef<HTMLAudioElement>(null);
  const [modalTrackTime, setModalTrackTime] = useState(0);
  const [modalTrackDuration, setModalTrackDuration] = useState(0);
  const [libraryTab, setLibraryTab] = useState<'uploads' | 'created'>('uploads');

  const createdTrackOptions = useMemo(() => {
    return createdSongs
      .filter(song => !song.isGenerating)
      .filter(song => (user ? song.userId === user.id : true))
      .filter(song => Boolean(song.audioUrl))
      .map(song => ({
        id: song.id,
        title: song.title || 'Untitled',
        audio_url: song.audioUrl!,
        duration: song.duration,
      }));
  }, [createdSongs, user]);

  const getAudioLabel = (url: string) => {
    try {
      const parsed = new URL(url);
      const name = decodeURIComponent(parsed.pathname.split('/').pop() || parsed.hostname);
      return name.replace(/\.[^/.]+$/, '') || name;
    } catch {
      const parts = url.split('/');
      const name = decodeURIComponent(parts[parts.length - 1] || url);
      return name.replace(/\.[^/.]+$/, '') || name;
    }
  };

  // Resize Logic
  const [lyricsHeight, setLyricsHeight] = useState(() => {
    const saved = localStorage.getItem('acestep_lyrics_height');
    return saved ? parseInt(saved, 10) : 144; // Default h-36 is 144px (9rem * 16)
  });
  const [isResizing, setIsResizing] = useState(false);
  const lyricsRef = useRef<HTMLDivElement>(null);


  // Close model menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(event.target as Node)) {
        setShowModelMenu(false);
      }
    };

    if (showModelMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showModelMenu]);

  // Auto-unload LoRA when model changes
  useEffect(() => {
    if (previousModelRef.current !== selectedModel && loraLoaded) {
      void handleLoraUnload();
    }
    previousModelRef.current = selectedModel;
  }, [selectedModel, loraLoaded]);

  // Auto-disable thinking and ADG when LoRA is loaded
  useEffect(() => {
    if (loraLoaded) {
      if (thinking) setThinking(false);
      if (useAdg) setUseAdg(false);
    }
  }, [loraLoaded]);

  // LoRA API handlers
  const handleLoraToggle = async () => {
    if (!token) {
      setLoraError('Please sign in to use LoRA');
      return;
    }
    if (!loraPath.trim()) {
      setLoraError('Please enter a LoRA path');
      return;
    }

    setIsLoraLoading(true);
    setLoraError(null);

    try {
      if (loraLoaded) {
        await handleLoraUnload();
      } else {
        const result = await generateApi.loadLora({ lora_path: loraPath }, token);
        setLoraLoaded(true);
        console.log('LoRA loaded:', result?.message);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'LoRA operation failed';
      setLoraError(message);
      console.error('LoRA error:', err);
    } finally {
      setIsLoraLoading(false);
    }
  };

  const handleLoraUnload = async () => {
    if (!token) return;
    
    setIsLoraLoading(true);
    setLoraError(null);

    try {
      const result = await generateApi.unloadLora(token);
      setLoraLoaded(false);
      console.log('LoRA unloaded:', result?.message);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to unload LoRA';
      setLoraError(message);
      console.error('Unload error:', err);
    } finally {
      setIsLoraLoading(false);
    }
  };

  const handleLoraScaleChange = async (newScale: number) => {
    setLoraScale(newScale);

    if (!token || !loraLoaded) return;

    try {
      await generateApi.setLoraScale({ scale: newScale }, token);
    } catch (err) {
      console.error('Failed to set LoRA scale:', err);
    }
  };

  const handleLoraEnabledToggle = async () => {
    if (!token || !loraLoaded) return;
    const newEnabled = !loraEnabled;
    setLoraEnabled(newEnabled);
    try {
      await generateApi.toggleLora({ enabled: newEnabled }, token);
    } catch (err) {
      console.error('Failed to toggle LoRA:', err);
      setLoraEnabled(!newEnabled); // revert on error
    }
  };

  // Load generation parameters from JSON file
  const handleLoadParamsFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        if (data.lyrics !== undefined) setLyrics(data.lyrics);
        if (data.style !== undefined) setStyle(data.style);
        if (data.title !== undefined) setTitle(data.title);
        if (data.caption !== undefined) setStyle(data.caption);
        if (data.instrumental !== undefined) setInstrumental(data.instrumental);
        if (data.vocal_language !== undefined) setVocalLanguage(data.vocal_language);
        if (data.bpm !== undefined) setBpm(data.bpm);
        if (data.key_scale !== undefined) setKeyScale(data.key_scale);
        if (data.time_signature !== undefined) setTimeSignature(data.time_signature);
        if (data.duration !== undefined) setDuration(data.duration);
        if (data.inference_steps !== undefined) setInferenceSteps(data.inference_steps);
        if (data.guidance_scale !== undefined) setGuidanceScale(data.guidance_scale);
        if (data.audio_format !== undefined) setAudioFormat(data.audio_format);
        if (data.infer_method !== undefined) setInferMethod(data.infer_method);
        if (data.seed !== undefined) { setSeed(data.seed); setRandomSeed(false); }
        if (data.shift !== undefined) setShift(data.shift);
        if (data.lm_temperature !== undefined) setLmTemperature(data.lm_temperature);
        if (data.lm_cfg_scale !== undefined) setLmCfgScale(data.lm_cfg_scale);
        if (data.lm_top_k !== undefined) setLmTopK(data.lm_top_k);
        if (data.lm_top_p !== undefined) setLmTopP(data.lm_top_p);
        if (data.lm_negative_prompt !== undefined) setLmNegativePrompt(data.lm_negative_prompt);
        if (data.task_type !== undefined) setTaskType(data.task_type);
        if (data.audio_codes !== undefined) setAudioCodes(data.audio_codes);
        if (data.repainting_start !== undefined) setRepaintingStart(data.repainting_start);
        if (data.repainting_end !== undefined) setRepaintingEnd(data.repainting_end);
        if (data.instruction !== undefined) setInstruction(data.instruction);
        if (data.audio_cover_strength !== undefined) setAudioCoverStrength(data.audio_cover_strength);
      } catch {
        console.error('Failed to parse parameters JSON');
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // reset so same file can be reloaded
  };

  // Reuse Effect - must be after all state declarations
  useEffect(() => {
    if (initialData) {
      setLyrics(initialData.song.lyrics);
      setStyle(initialData.song.style);
      setTitle(initialData.song.title);
      setInstrumental(initialData.song.lyrics.length === 0);
    }
  }, [initialData]);

  useEffect(() => {
    if (!pendingAudioSelection) return;
    applyAudioTargetUrl(
      pendingAudioSelection.target,
      pendingAudioSelection.url,
      pendingAudioSelection.title
    );
    onAudioSelectionApplied?.();
  }, [pendingAudioSelection, onAudioSelectionApplied]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      // Calculate new height based on mouse position relative to the lyrics container top
      // We can't easily get the container top here without a ref to it, 
      // but we can use dy (delta y) from the previous position if we tracked it,
      // OR simpler: just update based on movement if we track the start.
      //
      // Better approach for absolute sizing: 
      // 1. Get the bounding rect of the textarea wrapper on mount/resize start? 
      //    We can just rely on the fact that we are dragging the bottom.
      //    So new height = currentMouseY - topOfElement.

      if (lyricsRef.current) {
        const rect = lyricsRef.current.getBoundingClientRect();
        const newHeight = e.clientY - rect.top;
        // detailed limits: min 96px (h-24), max 600px
        if (newHeight > 96 && newHeight < 600) {
          setLyricsHeight(newHeight);
        }
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
      // Save height to localStorage
      localStorage.setItem('acestep_lyrics_height', String(lyricsHeight));
    };

    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none'; // Prevent text selection while dragging
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    };
  }, [isResizing]);

  const refreshModels = useCallback(async () => {
    try {
      const modelsRes = await fetch('/api/generate/models');
      if (modelsRes.ok) {
        const data = await modelsRes.json();
        const models = data.models || [];
        if (models.length > 0) {
          setFetchedModels(models);
          // Always sync to the backend's active model
          const active = models.find((m: any) => m.is_active);
          if (active) {
            setSelectedModel(active.name);
            localStorage.setItem('ace-model', active.name);
          }
        }
      }
    } catch {
      // ignore - will use fallback model list
    }
  }, []);

  // Check if the SFT model is on disk and download it if needed.
  // Called automatically when repaint mode is selected.
  const checkAndEnsureSftModel = useCallback(async () => {
    setSftStatus('checking');
    try {
      const statusRes = await fetch('/api/models/status');
      if (!statusRes.ok) { setSftStatus('unavailable'); return; }
      const statusData = await statusRes.json();
      const onDisk: string[] = statusData.onDisk || [];
      const hasSft = onDisk.some((f: string) => f.startsWith(SFT_MODEL_NAME));

      if (hasSft) {
        setSftStatus('available');
        return;
      }

      // SFT model not on disk — trigger download if authenticated
      if (!token) { setSftStatus('unavailable'); return; }

      setSftStatus('downloading');
      // Enqueue download of the Q8_0 SFT DiT model
      await fetch('/api/models/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ files: [SFT_MODEL_FILE] }),
      });

      // Subscribe to SSE stream to detect when download completes
      if (sftSseRef.current) sftSseRef.current.close();
      const es = new EventSource('/api/models/download/stream');
      sftSseRef.current = es;
      const onDone = (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          if (data.filename?.startsWith(SFT_MODEL_NAME)) {
            setSftStatus('available');
            es.close();
            sftSseRef.current = null;
          }
        } catch { /* ignore */ }
      };
      const onError = () => {
        setSftStatus('unavailable');
        es.close();
        sftSseRef.current = null;
      };
      es.addEventListener('done', onDone);
      es.addEventListener('error', onError);
    } catch {
      setSftStatus('unavailable');
    }
  }, [token]);

  // Auto-switch to SFT model when repaint mode is selected and back to previous model otherwise
  const prevTaskTypeRef = useRef(taskType);
  const prevModelBeforeRepaintRef = useRef<string | null>(null);
  useEffect(() => {
    const prevTaskType = prevTaskTypeRef.current;
    prevTaskTypeRef.current = taskType;

    if (taskType === 'repaint') {
      // Entering repaint mode: switch to SFT model if not already on one
      if (!isSftModel(selectedModel)) {
        prevModelBeforeRepaintRef.current = selectedModel;
        setSelectedModel(SFT_MODEL_NAME);
        localStorage.setItem('ace-model', SFT_MODEL_NAME);
      }
      // Check/download SFT model
      void checkAndEnsureSftModel();
    } else if (prevTaskType === 'repaint') {
      // Leaving repaint mode: restore previous model if it was switched
      if (sftSseRef.current) { sftSseRef.current.close(); sftSseRef.current = null; }
      setSftStatus('idle');
      if (prevModelBeforeRepaintRef.current && isSftModel(selectedModel)) {
        setSelectedModel(prevModelBeforeRepaintRef.current);
        localStorage.setItem('ace-model', prevModelBeforeRepaintRef.current);
        prevModelBeforeRepaintRef.current = null;
      }
    } else if (taskType === 'lego') {
      // Entering lego mode: switch to base model if not already on one
      if (!isBaseModel(selectedModel)) {
        prevModelBeforeRepaintRef.current = selectedModel;
        setSelectedModel(BASE_MODEL_NAME);
        localStorage.setItem('ace-model', BASE_MODEL_NAME);
      }
    } else if (prevTaskType === 'lego') {
      // Leaving lego mode: restore previous model if it was switched
      if (prevModelBeforeRepaintRef.current && isBaseModel(selectedModel)) {
        setSelectedModel(prevModelBeforeRepaintRef.current);
        localStorage.setItem('ace-model', prevModelBeforeRepaintRef.current);
        prevModelBeforeRepaintRef.current = null;
      }
    }
  }, [taskType, checkAndEnsureSftModel]);

  // Clean up SSE on unmount
  useEffect(() => () => { sftSseRef.current?.close(); }, []);

  useEffect(() => {
    const loadModelsAndLimits = async () => {
      await refreshModels();

      // Fetch limits
      try {
        const response = await fetch('/api/generate/limits');
        if (!response.ok) return;
        const data = await response.json();
        if (typeof data.max_duration_with_lm === 'number') {
          setMaxDurationWithLm(data.max_duration_with_lm);
        }
        if (typeof data.max_duration_without_lm === 'number') {
          setMaxDurationWithoutLm(data.max_duration_without_lm);
        }
      } catch {
        // ignore limits fetch failures
      }
    };

    loadModelsAndLimits();
  }, []);

  // Re-fetch models after generation completes to update active model
  const prevIsGeneratingRef = useRef(isGenerating);
  useEffect(() => {
    if (prevIsGeneratingRef.current && !isGenerating) {
      void refreshModels();
    }
    prevIsGeneratingRef.current = isGenerating;
  }, [isGenerating, refreshModels]);

  // Persist all main settings to localStorage (debounced 500ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem('ace-settings-' + workspaceId, JSON.stringify({
          lyrics, style, title,
          instrumental, vocalLanguage, vocalGender,
          bpm, keyScale, timeSignature,
          duration,
          guidanceScale, randomSeed, seed,
          thinking, enhance, audioFormat,
          inferenceSteps, inferMethod, lmBackend, shift,
          lmTemperature, lmCfgScale, lmTopK, lmTopP, lmNegativePrompt,
          audioCoverStrength, taskType,
          trackName, completeTrackClasses,
        }));
      } catch { /* ignore quota errors */ }
    }, 500);
    return () => clearTimeout(timer);
  }, [
    lyrics, style, title,
    instrumental, vocalLanguage, vocalGender,
    bpm, keyScale, timeSignature,
    duration,
    guidanceScale, randomSeed, seed,
    thinking, enhance, audioFormat,
    inferenceSteps, inferMethod, lmBackend, shift,
    lmTemperature, lmCfgScale, lmTopK, lmTopP, lmNegativePrompt,
    audioCoverStrength, taskType,
    trackName, completeTrackClasses,
  ]);

  const activeMaxDuration = thinking ? maxDurationWithLm : maxDurationWithoutLm;

  useEffect(() => {
    if (duration > activeMaxDuration) {
      setDuration(activeMaxDuration);
    }
  }, [duration, activeMaxDuration]);

  useEffect(() => {
    const getDragKind = (e: DragEvent): 'file' | 'audio' | null => {
      if (!e.dataTransfer) return null;
      const types = Array.from(e.dataTransfer.types);
      if (types.includes('Files')) return 'file';
      if (types.includes('application/x-ace-audio')) return 'audio';
      return null;
    };

    const handleDragEnter = (e: DragEvent) => {
      const kind = getDragKind(e);
      if (!kind) return;
      dragDepthRef.current += 1;
      setIsDraggingFile(true);
      setDragKind(kind);
      e.preventDefault();
    };

    const handleDragOver = (e: DragEvent) => {
      const kind = getDragKind(e);
      if (!kind) return;
      setDragKind(kind);
      e.preventDefault();
    };

    const handleDragLeave = (e: DragEvent) => {
      const kind = getDragKind(e);
      if (!kind) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setIsDraggingFile(false);
        setDragKind(null);
      }
    };

    const handleDrop = (e: DragEvent) => {
      const kind = getDragKind(e);
      if (!kind) return;
      e.preventDefault();
      dragDepthRef.current = 0;
      setIsDraggingFile(false);
      setDragKind(null);
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, []);

  const startResizing = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, target: 'reference' | 'source') => {
    const file = e.target.files?.[0];
    if (file) {
      void uploadReferenceTrack(file, target);
    }
    e.target.value = '';
  };

  // Format handler - uses LLM to enhance style/lyrics and auto-fill parameters
  const handleFormat = async (target: 'style' | 'lyrics') => {
    if (!token || !style.trim()) return;
    if (target === 'style') {
      setIsFormattingStyle(true);
    } else {
      setIsFormattingLyrics(true);
    }
    try {
      const result = await generateApi.formatInput({
        caption: style,
        lyrics: lyrics,
        bpm: bpm > 0 ? bpm : undefined,
        duration: duration > 0 ? duration : undefined,
        keyScale: keyScale || undefined,
        timeSignature: timeSignature || undefined,
        temperature: lmTemperature,
        topK: lmTopK > 0 ? lmTopK : undefined,
        topP: lmTopP,
        lmModel: lmModel || 'acestep-5Hz-lm-0.6B',
        lmBackend: lmBackend || 'pt',
      }, token);

      if (result.caption || result.lyrics || result.bpm || result.duration) {
        // Update fields with LLM-generated values
        if (target === 'style' && result.caption) setStyle(result.caption);
        if (target === 'lyrics' && result.lyrics) setLyrics(result.lyrics);
        if (result.bpm && result.bpm > 0) setBpm(result.bpm);
        if (result.duration && result.duration > 0) setDuration(result.duration);
        if (result.key_scale) setKeyScale(result.key_scale);
        if (result.time_signature) {
          const ts = String(result.time_signature);
          setTimeSignature(ts.includes('/') ? ts : `${ts}/4`);
        }
        if (result.vocal_language) setVocalLanguage(result.vocal_language);
        if (target === 'style') setIsFormatCaption(true);
      } else {
        console.error('Format failed:', result.error || result.status_message);
        alert(result.error || result.status_message || 'Format failed. Make sure the LLM is initialized.');
      }
    } catch (err) {
      console.error('Format error:', err);
      alert('Format failed. The LLM may not be available.');
    } finally {
      if (target === 'style') {
        setIsFormattingStyle(false);
      } else {
        setIsFormattingLyrics(false);
      }
    }
  };

  const openAudioModal = (target: 'reference' | 'source', tab: 'uploads' | 'created' = 'uploads') => {
    setAudioModalTarget(target);
    setTempAudioUrl('');
    setLibraryTab(tab);
    setShowAudioModal(true);
    void fetchReferenceTracks();
  };

  const fetchReferenceTracks = useCallback(async () => {
    if (!token) return;
    setIsLoadingTracks(true);
    try {
      const response = await fetch('/api/reference-tracks', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setReferenceTracks(data.tracks || []);
      }
    } catch (err) {
      console.error('Failed to fetch reference tracks:', err);
    } finally {
      setIsLoadingTracks(false);
    }
  }, [token]);

  const uploadReferenceTrack = async (file: File, target?: 'reference' | 'source') => {
    if (!token) {
      setUploadError('Please sign in to upload audio.');
      return;
    }
    setUploadError(null);
    setIsUploadingReference(true);
    try {
      const formData = new FormData();
      formData.append('audio', file);

      const response = await fetch('/api/reference-tracks', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Upload failed');
      }

      const data = await response.json();
      setReferenceTracks(prev => [data.track, ...prev]);

      // Also set as current reference/source
      const selectedTarget = target ?? audioModalTarget;
      applyAudioTargetUrl(selectedTarget, data.track.audio_url, data.track.filename);
      if (data.whisper_available && data.track?.id) {
        void transcribeReferenceTrack(data.track.id).then(() => undefined);
      } else {
        setShowAudioModal(false);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setUploadError(message);
    } finally {
      setIsUploadingReference(false);
    }
  };

  const transcribeReferenceTrack = async (trackId: string) => {
    if (!token) return;
    setIsTranscribingReference(true);
    const controller = new AbortController();
    transcribeAbortRef.current = controller;
    try {
      const response = await fetch(`/api/reference-tracks/${trackId}/transcribe`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error('Failed to transcribe');
      }
      const data = await response.json();
      if (data.lyrics) {
        setLyrics(prev => prev || data.lyrics);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error('Transcription failed:', err);
    } finally {
      if (transcribeAbortRef.current === controller) {
        transcribeAbortRef.current = null;
      }
      setIsTranscribingReference(false);
    }
  };

  const cancelTranscription = () => {
    if (transcribeAbortRef.current) {
      transcribeAbortRef.current.abort();
      transcribeAbortRef.current = null;
    }
    setIsTranscribingReference(false);
  };

  /** Run ace-understand on the audio at the given URL and store the result. */
  const handleUnderstand = async (target: 'reference' | 'source', audioUrl: string) => {
    if (!token || !audioUrl) return;
    setUnderstandStatus(prev => ({ ...prev, [target]: 'running' }));
    setUnderstandResult(prev => ({ ...prev, [target]: null }));
    setUnderstandError(prev => ({ ...prev, [target]: null }));
    try {
      const result = await generateApi.understandAudioUrl(audioUrl, token);
      setUnderstandResult(prev => ({ ...prev, [target]: result }));
      setUnderstandStatus(prev => ({ ...prev, [target]: 'done' }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Analysis failed';
      setUnderstandError(prev => ({ ...prev, [target]: msg }));
      setUnderstandStatus(prev => ({ ...prev, [target]: 'error' }));
    }
  };

  /** Apply understand result fields to the generation form. */
  const applyUnderstandResult = (result: Record<string, unknown>) => {
    if (typeof result.caption === 'string' && result.caption) setStyle(result.caption);
    if (typeof result.lyrics === 'string' && result.lyrics) setLyrics(result.lyrics);
    if (typeof result.bpm === 'number' && result.bpm > 0) setBpm(result.bpm);
    if (typeof result.duration === 'number' && result.duration > 0) setDuration(Math.round(result.duration));
    if (typeof result.keyscale === 'string' && result.keyscale) setKeyScale(result.keyscale);
    if (typeof result.timesignature === 'string' && result.timesignature) setTimeSignature(result.timesignature);
    if (typeof result.vocal_language === 'string' && result.vocal_language) setVocalLanguage(result.vocal_language);
  };

  const deleteReferenceTrack = async (trackId: string) => {
    if (!token) return;
    try {
      const response = await fetch(`/api/reference-tracks/${trackId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        setReferenceTracks(prev => prev.filter(t => t.id !== trackId));
        if (playingTrackId === trackId && playingTrackSource === 'uploads') {
          setPlayingTrackId(null);
          setPlayingTrackSource(null);
          if (modalAudioRef.current) {
            modalAudioRef.current.pause();
          }
        }
      }
    } catch (err) {
      console.error('Failed to delete track:', err);
    }
  };

  const useReferenceTrack = (track: { audio_url: string; title?: string }) => {
    applyAudioTargetUrl(audioModalTarget, track.audio_url, track.title);
    setShowAudioModal(false);
    setPlayingTrackId(null);
    setPlayingTrackSource(null);
  };

  const toggleModalTrack = (track: { id: string; audio_url: string; source: 'uploads' | 'created' }) => {
    if (playingTrackId === track.id) {
      if (modalAudioRef.current) {
        modalAudioRef.current.pause();
      }
      setPlayingTrackId(null);
      setPlayingTrackSource(null);
    } else {
      setPlayingTrackId(track.id);
      setPlayingTrackSource(track.source);
      if (modalAudioRef.current) {
        modalAudioRef.current.src = track.audio_url;
        modalAudioRef.current.play().catch(() => undefined);
      }
    }
  };

  const applyAudioUrl = () => {
    if (!tempAudioUrl.trim()) return;
    applyAudioTargetUrl(audioModalTarget, tempAudioUrl.trim());
    setShowAudioModal(false);
    setTempAudioUrl('');
  };

  const applyAudioTargetUrl = (target: 'reference' | 'source', url: string, title?: string) => {
    const derivedTitle = title ? title.replace(/\.[^/.]+$/, '') : getAudioLabel(url);
    if (target === 'reference') {
      setReferenceAudioUrl(url);
      setReferenceAudioTitle(derivedTitle);
      setReferenceTime(0);
      setReferenceDuration(0);
    } else {
      setSourceAudioUrl(url);
      setSourceAudioTitle(derivedTitle);
      setSourceTime(0);
      setSourceDuration(0);
      if (taskType === 'text2music') {
        setTaskType('cover');
      }
    }
  };

  const formatTime = (time: number) => {
    if (!Number.isFinite(time) || time <= 0) return '0:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  };

  /** Clear the source audio and reset task type if it was cover/repaint/lego. */
  const handleClearSourceAudio = () => {
    setSourceAudioUrl('');
    setSourceAudioTitle('');
    setSourcePlaying(false);
    setSourceTime(0);
    setSourceDuration(0);
    if (taskType === 'cover' || taskType === 'repaint' || taskType === 'lego') setTaskType('text2music');
    // If we're on the lego tab, switch away since there's no source audio anymore
    if (audioTab === 'lego') setAudioTab('reference');
  };

  /**
   * Returns a green overlay element indicating the repaint region on the seekbar.
   * Rendered only when taskType === 'repaint' and sourceDuration > 0.
   */
  const renderRepaintRegionOverlay = () => {
    if (taskType !== 'repaint' || sourceDuration <= 0) return null;
    const regionStart = Math.max(0, repaintingStart >= 0 ? repaintingStart : 0);
    const regionEnd   = Math.min(sourceDuration, repaintingEnd >= 0 ? repaintingEnd : sourceDuration);
    return (
      <div
        className="absolute inset-y-0 bg-emerald-400/40 dark:bg-emerald-400/30 rounded-full pointer-events-none"
        style={{
          left:  `${(regionStart / sourceDuration) * 100}%`,
          width: `${Math.max(0, (regionEnd - regionStart) / sourceDuration) * 100}%`,
        }}
      />
    );
  };

  const toggleAudio = (target: 'reference' | 'source') => {
    const audio = target === 'reference' ? referenceAudioRef.current : sourceAudioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, target: 'reference' | 'source') => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void uploadReferenceTrack(file, target);
      return;
    }
    const payload = e.dataTransfer.getData('application/x-ace-audio');
    if (payload) {
      try {
        const data = JSON.parse(payload);
        if (data?.url) {
          applyAudioTargetUrl(target, data.url, data.title);
        }
      } catch {
        // ignore
      }
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleWorkspaceDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.files?.length || e.dataTransfer.types.includes('application/x-ace-audio')) {
      // Lego tab uses source audio slot for the backing track
      handleDrop(e, audioTab === 'lego' ? 'source' : audioTab);
    }
  };

  const handleWorkspaceDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('application/x-ace-audio')) {
      e.preventDefault();
    }
  };

  /** Switch the audio tab; automatically syncs the taskType when entering/leaving lego. */
  const handleAudioTabChange = (tab: 'reference' | 'source' | 'lego') => {
    setAudioTab(tab);
    if (tab === 'lego') {
      setTaskType('lego');
    } else if (taskType === 'lego') {
      setTaskType('text2music');
    }
  };

  const handleGenerate = () => {
    const styleWithGender = (() => {
      if (!vocalGender) return style;
      const genderHint = vocalGender === 'male' ? 'Male vocals' : 'Female vocals';
      const trimmed = style.trim();
      return trimmed ? `${trimmed}\n${genderHint}` : genderHint;
    })();

    // Bulk generation: loop bulkCount times
    for (let i = 0; i < bulkCount; i++) {
      // Seed handling: first job uses user's seed, rest get random seeds
      let jobSeed = -1;
      if (!randomSeed && i === 0) {
        jobSeed = seed;
      } else if (!randomSeed && i > 0) {
        // Subsequent jobs get random seeds for variety
        jobSeed = Math.floor(Math.random() * 4294967295);
      }

      onGenerate({
        prompt: lyrics,
        lyrics,
        style: styleWithGender,
        title: bulkCount > 1 ? `${title} (${i + 1})` : title,
        ditModel: selectedModel,
        instrumental,
        vocalLanguage,
        bpm,
        keyScale,
        timeSignature,
        duration,
        inferenceSteps,
        guidanceScale,
        batchSize,
        randomSeed: randomSeed || i > 0, // Force random for subsequent bulk jobs
        seed: jobSeed,
        thinking,
        enhance,
        audioFormat,
        inferMethod,
        lmBackend,
        lmModel,
        shift,
        lmTemperature,
        lmCfgScale,
        lmTopK,
        lmTopP,
        lmNegativePrompt,
        referenceAudioUrl: referenceAudioUrl.trim() || undefined,
        sourceAudioUrl: sourceAudioUrl.trim() || undefined,
        referenceAudioTitle: referenceAudioTitle.trim() || undefined,
        sourceAudioTitle: sourceAudioTitle.trim() || undefined,
        audioCodes: audioCodes.trim() || undefined,
        repaintingStart,
        repaintingEnd,
        instruction,
        audioCoverStrength,
        taskType,
        useAdg,
        cfgIntervalStart,
        cfgIntervalEnd,
        customTimesteps: customTimesteps.trim() || undefined,
        useCotMetas,
        useCotCaption,
        useCotLanguage,
        autogen,
        constrainedDecodingDebug,
        allowLmBatch,
        getScores,
        getLrc,
        scoreScale,
        lmBatchChunkSize,
        trackName: trackName.trim() || undefined,
        completeTrackClasses: completeTrackClassesParsed.length ? completeTrackClassesParsed : undefined,
        isFormatCaption,
        loraLoaded,
      });
    }

    // Reset bulk count after generation
    if (bulkCount > 1) {
      setBulkCount(1);
    }
  };

  return (
    <div
      className="relative flex flex-col h-full bg-zinc-50 dark:bg-suno-panel w-full overflow-y-auto custom-scrollbar transition-colors duration-300"
      onDrop={handleWorkspaceDrop}
      onDragOver={handleWorkspaceDragOver}
    >
      {isDraggingFile && (
        <div className="absolute inset-0 z-[90] pointer-events-none">
          <div className="absolute inset-0 bg-white/70 dark:bg-black/50 backdrop-blur-sm" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-zinc-200 dark:border-white/10 bg-white/90 dark:bg-zinc-900/90 px-6 py-5 shadow-xl">
              {dragKind !== 'audio' && (
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 text-white flex items-center justify-center shadow-lg">
                  <Upload size={22} />
                </div>
              )}
              <div className="text-sm font-semibold text-zinc-900 dark:text-white">
                {dragKind === 'audio' ? t('dropToUseAudio') : t('dropToUpload')}
              </div>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                {dragKind === 'audio'
                  ? (audioTab === 'reference' ? t('usingAsReference') : t('usingAsCover'))
                  : (audioTab === 'reference' ? t('uploadingAsReference') : t('uploadingAsCover'))}
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="p-4 pt-14 md:pt-4 pb-24 lg:pb-32 space-y-5">
        <input
          ref={referenceInputRef}
          type="file"
          accept="audio/*"
          onChange={(e) => handleFileSelect(e, 'reference')}
          className="hidden"
        />
        <input
          ref={sourceInputRef}
          type="file"
          accept="audio/*"
          onChange={(e) => handleFileSelect(e, 'source')}
          className="hidden"
        />
        <audio
          ref={referenceAudioRef}
          src={referenceAudioUrl || undefined}
          onPlay={() => setReferencePlaying(true)}
          onPause={() => setReferencePlaying(false)}
          onEnded={() => setReferencePlaying(false)}
          onTimeUpdate={(e) => setReferenceTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setReferenceDuration(e.currentTarget.duration || 0)}
        />
        <audio
          ref={sourceAudioRef}
          src={sourceAudioUrl || undefined}
          onPlay={() => setSourcePlaying(true)}
          onPause={() => setSourcePlaying(false)}
          onEnded={() => setSourcePlaying(false)}
          onTimeUpdate={(e) => setSourceTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setSourceDuration(e.currentTarget.duration || 0)}
        />

        {/* Header - Mode Toggle & Model Selection */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">ACE-Step v1.5</span>
          </div>

          <div className="flex items-center gap-2">
            {/* Model Selection */}
            <div className="relative" ref={modelMenuRef}>
              <button
                onClick={() => setShowModelMenu(!showModelMenu)}
                className="bg-zinc-200 dark:bg-black/40 border border-zinc-300 dark:border-white/5 rounded-md px-2 py-1 text-[11px] font-medium text-zinc-900 dark:text-white hover:bg-zinc-300 dark:hover:bg-black/50 transition-colors flex items-center gap-1"
                disabled={availableModels.length === 0}
              >
                {availableModels.length === 0 ? '...' : getModelDisplayName(selectedModel)}
                <ChevronDown size={10} className="text-zinc-600 dark:text-zinc-400" />
              </button>
              
              {/* Floating Model Menu */}
              {showModelMenu && availableModels.length > 0 && (
                <div className="absolute top-full right-0 mt-1 w-72 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-2xl z-50 overflow-hidden">
                  <div className="max-h-96 overflow-y-auto custom-scrollbar">
                    {availableModels.map(model => (
                      <button
                        key={model.id}
                        onClick={() => {
                          setSelectedModel(model.id);
                          localStorage.setItem('ace-model', model.id);
                          // Apply acestep-cpp model presets automatically
                          if (isTurboModel(model.id)) {
                            // Turbo: 8 steps, shift=3.0, guidance_scale=0.0 (auto → 1.0)
                            setInferenceSteps(8);
                            setShift(3.0);
                            setGuidanceScale(0.0);
                          } else if (isSftModel(model.id)) {
                            // SFT: 50 steps, shift=1.0, guidance_scale=1.0
                            setInferenceSteps(50);
                            setShift(1.0);
                            setGuidanceScale(1.0);
                          } else {
                            // Base: 50 steps, shift=1.0, guidance_scale=7.0 (lego default)
                            setInferenceSteps(50);
                            setShift(1.0);
                            setGuidanceScale(7.0);
                          }
                          setShowModelMenu(false);
                        }}
                        className={`w-full px-4 py-3 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors border-b border-zinc-100 dark:border-zinc-800 last:border-b-0 ${
                          selectedModel === model.id ? 'bg-zinc-50 dark:bg-zinc-800/50' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-zinc-900 dark:text-white">
                              {getModelDisplayName(model.id)}
                            </span>
                            {fetchedModels.find(m => m.name === model.id)?.is_preloaded && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                                {fetchedModels.find(m => m.name === model.id)?.is_active ? '● Active' : '● Ready'}
                              </span>
                            )}
                          </div>
                          {selectedModel === model.id && (
                            <div className="w-4 h-4 rounded-full bg-pink-500 flex items-center justify-center">
                              <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            </div>
                          )}
                        </div>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">{model.id}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>


        {/* UNIFIED PANEL */}
        <div className="space-y-5">
          {/* Title Input */}
          <div className="bg-white dark:bg-suno-card rounded-xl border border-zinc-200 dark:border-white/5 overflow-hidden">
            <div className="px-3 py-2.5 text-xs font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/5">
              {t('title')}
            </div>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('nameSong')}
              className="w-full bg-transparent p-3 text-sm text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none"
            />
          </div>

          {/* Style Input */}
          <div className="bg-white dark:bg-suno-card rounded-xl border border-zinc-200 dark:border-white/5 overflow-hidden transition-colors group focus-within:border-zinc-400 dark:focus-within:border-white/20">
            <div className="flex items-center justify-between px-3 py-2.5 bg-zinc-50 dark:bg-white/5 border-b border-zinc-100 dark:border-white/5">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">{t('styleOfMusic')}</span>
                  <button
                    onClick={() => setEnhance(!enhance)}
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-all cursor-pointer ${enhance ? 'bg-violet-100 dark:bg-violet-500/20 text-violet-600 dark:text-violet-400' : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300'}`}
                    title={t('enhanceTooltip')}
                  >
                    <Sparkles size={9} />
                    <span>{enhance ? 'ON' : 'OFF'}</span>
                  </button>
                </div>
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">{t('genreMoodInstruments')}</p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  className="p-1.5 hover:bg-zinc-200 dark:hover:bg-white/10 rounded transition-colors text-zinc-500 hover:text-black dark:hover:text-white"
                  title={t('refreshGenres')}
                  onClick={refreshMusicTags}
                >
                  <Dices size={14} />
                </button>
                <button
                  className="p-1.5 hover:bg-zinc-200 dark:hover:bg-white/10 rounded text-zinc-500 hover:text-black dark:hover:text-white transition-colors"
                  onClick={() => setStyle('')}
                >
                  <Trash2 size={14} />
                </button>
                <button
                  className={`p-1.5 hover:bg-zinc-200 dark:hover:bg-white/10 rounded transition-colors ${isFormattingStyle ? 'text-pink-500' : 'text-zinc-500 hover:text-black dark:hover:text-white'}`}
                  title="AI Format - Enhance style & auto-fill parameters"
                  onClick={() => handleFormat('style')}
                  disabled={isFormattingStyle || !style.trim()}
                >
                  {isFormattingStyle ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                </button>
              </div>
            </div>
            <textarea
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              placeholder={t('stylePlaceholder')}
              className="w-full h-20 bg-transparent p-3 text-sm text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none resize-none"
            />
            <div className="px-3 pb-3 space-y-3">
              {/* Quick Tags */}
              <div className="flex flex-wrap gap-2">
                {musicTags.map(tag => (
                  <button
                    key={tag}
                    onClick={() => setStyle(prev => prev ? `${prev}, ${tag}` : tag)}
                    className="text-[10px] font-medium bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white px-2.5 py-1 rounded-full transition-colors border border-zinc-200 dark:border-white/5"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Lyrics Input */}
          <div
            ref={lyricsRef}
            className="bg-white dark:bg-suno-card rounded-xl border border-zinc-200 dark:border-white/5 overflow-hidden transition-colors group focus-within:border-zinc-400 dark:focus-within:border-white/20 relative flex flex-col"
            style={{ height: 'auto' }}
          >
            <div className="flex items-center justify-between px-3 py-2.5 bg-zinc-50 dark:bg-white/5 border-b border-zinc-100 dark:border-white/5 flex-shrink-0">
              <div>
                <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">{t('lyrics')}</span>
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">{t('leaveLyricsEmpty')}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setInstrumental(!instrumental)}
                  className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border transition-colors ${
                    instrumental
                      ? 'bg-pink-600 text-white border-pink-500'
                      : 'bg-white dark:bg-suno-card border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-white/10'
                  }`}
                >
                  {instrumental ? t('instrumental') : t('vocal')}
                </button>
                <button
                  className={`p-1.5 hover:bg-zinc-200 dark:hover:bg-white/10 rounded transition-colors ${isFormattingLyrics ? 'text-pink-500' : 'text-zinc-500 hover:text-black dark:hover:text-white'}`}
                  title="AI Format - Enhance style & auto-fill parameters"
                  onClick={() => handleFormat('lyrics')}
                  disabled={isFormattingLyrics || !style.trim()}
                >
                  {isFormattingLyrics ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                </button>
                <button
                  className="p-1.5 hover:bg-zinc-200 dark:hover:bg-white/10 rounded text-zinc-500 hover:text-black dark:hover:text-white transition-colors"
                  onClick={() => setLyrics('')}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            <textarea
              disabled={instrumental}
              value={lyrics}
              onChange={(e) => setLyrics(e.target.value)}
              placeholder={instrumental ? t('instrumental') + ' mode' : t('lyricsPlaceholder')}
              className={`w-full bg-transparent p-3 text-sm text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none resize-none font-mono leading-relaxed ${instrumental ? 'opacity-30 cursor-not-allowed' : ''}`}
              style={{ height: `${lyricsHeight}px` }}
            />
            {/* Resize Handle */}
            <div
              onMouseDown={startResizing}
              className="h-3 w-full cursor-ns-resize flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors absolute bottom-0 left-0 z-10"
            >
              <div className="w-8 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700"></div>
            </div>
          </div>

          {/* Audio Section */}
          <div
            onDrop={(e) => handleDrop(e, audioTab === 'lego' ? 'source' : audioTab)}
            onDragOver={handleDragOver}
            className="bg-white dark:bg-[#1a1a1f] rounded-xl border border-zinc-200 dark:border-white/5 overflow-hidden"
          >
            {/* Header with Audio label and tabs */}
            <div className="px-3 py-2.5 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">{t('audio')}</span>
                <div className="flex items-center gap-1 bg-zinc-200/50 dark:bg-black/30 rounded-lg p-0.5">
                  <button
                    type="button"
                    onClick={() => handleAudioTabChange('reference')}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                      audioTab === 'reference'
                        ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm'
                        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                    }`}
                  >
                    {t('reference')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAudioTabChange('source')}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                      audioTab === 'source'
                        ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm'
                        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                    }`}
                  >
                    {t('cover')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAudioTabChange('lego')}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                      audioTab === 'lego'
                        ? 'bg-amber-500 text-white shadow-sm'
                        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                    }`}
                  >
                    {t('legoMode')}
                  </button>
                </div>
              </div>
            </div>

            {/* Audio Content */}
            <div className="p-3 space-y-2">
                {/* Reference Audio Player */}
                {audioTab === 'reference' && referenceAudioUrl && (
                  <>
                  <div className="flex items-center gap-3 p-2 rounded-lg bg-zinc-50 dark:bg-white/[0.03] border border-zinc-100 dark:border-white/5">
                    <button
                      type="button"
                      onClick={() => toggleAudio('reference')}
                      className="relative flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 text-white flex items-center justify-center shadow-lg shadow-pink-500/20 hover:scale-105 transition-transform"
                    >
                      {referencePlaying ? (
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>
                      ) : (
                        <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                      )}
                      <span className="absolute -bottom-1 -right-1 text-[8px] font-bold bg-zinc-900 text-white px-1 py-0.5 rounded">
                        {formatTime(referenceDuration)}
                      </span>
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-zinc-800 dark:text-zinc-200 truncate mb-1.5">
                        {referenceAudioTitle || getAudioLabel(referenceAudioUrl)}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-zinc-400 tabular-nums">{formatTime(referenceTime)}</span>
                        <div
                          className="flex-1 h-1.5 rounded-full bg-zinc-200 dark:bg-white/10 cursor-pointer group/seek"
                          onClick={(e) => {
                            if (referenceAudioRef.current && referenceDuration > 0) {
                              const rect = e.currentTarget.getBoundingClientRect();
                              const percent = (e.clientX - rect.left) / rect.width;
                              referenceAudioRef.current.currentTime = percent * referenceDuration;
                            }
                          }}
                        >
                          <div
                            className="h-full bg-gradient-to-r from-pink-500 to-purple-500 rounded-full transition-all relative"
                            style={{ width: referenceDuration ? `${Math.min(100, (referenceTime / referenceDuration) * 100)}%` : '0%' }}
                          >
                            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white shadow-md opacity-0 group-hover/seek:opacity-100 transition-opacity" />
                          </div>
                        </div>
                        <span className="text-[10px] text-zinc-400 tabular-nums">{formatTime(referenceDuration)}</span>
                      </div>
                    </div>
                    {/* Understand button */}
                    <button
                      type="button"
                      onClick={() => void handleUnderstand('reference', referenceAudioUrl)}
                      disabled={understandStatus.reference === 'running'}
                      title={t('understandTooltip')}
                      className="p-1.5 rounded-full hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-400 hover:text-violet-600 dark:hover:text-violet-400 transition-colors disabled:opacity-50"
                    >
                      {understandStatus.reference === 'running' ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setReferenceAudioUrl(''); setReferenceAudioTitle(''); setReferencePlaying(false); setReferenceTime(0); setReferenceDuration(0); }}
                      className="p-1.5 rounded-full hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-400 hover:text-zinc-600 dark:hover:text-white transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                  </div>
                  {/* Understand result panel (reference) */}
                  {understandStatus.reference !== 'idle' && (
                    <div className={`rounded-lg px-3 py-2 text-[11px] space-y-1 ${
                      understandStatus.reference === 'error'
                        ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                        : 'bg-violet-50 dark:bg-violet-900/20 text-violet-800 dark:text-violet-300'
                    }`}>
                      {understandStatus.reference === 'running' && <span className="flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> {t('understandRunning')}</span>}
                      {understandStatus.reference === 'error' && <span>{t('understandError')}: {understandError.reference}</span>}
                      {understandStatus.reference === 'done' && understandResult.reference && (
                        <>
                          <div className="font-semibold">{t('understandResult')}</div>
                          {understandResult.reference.caption && <div className="truncate opacity-80">🎵 {String(understandResult.reference.caption).slice(0, 80)}{String(understandResult.reference.caption).length > 80 ? '…' : ''}</div>}
                          <div className="flex flex-wrap gap-2 opacity-70">
                            {understandResult.reference.bpm && <span>BPM: {String(understandResult.reference.bpm)}</span>}
                            {understandResult.reference.keyscale && <span>Key: {String(understandResult.reference.keyscale)}</span>}
                            {understandResult.reference.duration && <span>Duration: {Math.round(Number(understandResult.reference.duration))}s</span>}
                          </div>
                          <button
                            type="button"
                            onClick={() => applyUnderstandResult(understandResult.reference!)}
                            className="mt-1 px-2 py-0.5 rounded bg-violet-600 text-white text-[10px] font-medium hover:bg-violet-700 transition-colors"
                          >
                            {t('understandApply')}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  </>
                )}

                {/* Source/Cover Audio Player */}
                {audioTab === 'source' && sourceAudioUrl && (
                  <>
                  <div className="flex items-center gap-3 p-2 rounded-lg bg-zinc-50 dark:bg-white/[0.03] border border-zinc-100 dark:border-white/5">
                    <button
                      type="button"
                      onClick={() => toggleAudio('source')}
                      className="relative flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center shadow-lg shadow-emerald-500/20 hover:scale-105 transition-transform"
                    >
                      {sourcePlaying ? (
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>
                      ) : (
                        <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                      )}
                      <span className="absolute -bottom-1 -right-1 text-[8px] font-bold bg-zinc-900 text-white px-1 py-0.5 rounded">
                        {formatTime(sourceDuration)}
                      </span>
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-zinc-800 dark:text-zinc-200 truncate mb-1.5">
                        {sourceAudioTitle || getAudioLabel(sourceAudioUrl)}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-zinc-400 tabular-nums">{formatTime(sourceTime)}</span>
                        <div
                          className="relative flex-1 h-1.5 rounded-full bg-zinc-200 dark:bg-white/10 cursor-pointer group/seek"
                          onClick={(e) => {
                            if (sourceAudioRef.current && sourceDuration > 0) {
                              const rect = e.currentTarget.getBoundingClientRect();
                              const percent = (e.clientX - rect.left) / rect.width;
                              sourceAudioRef.current.currentTime = percent * sourceDuration;
                            }
                          }}
                        >
                          {/* Repaint region overlay */}
                          {renderRepaintRegionOverlay()}
                          <div
                            className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full transition-all relative"
                            style={{ width: sourceDuration ? `${Math.min(100, (sourceTime / sourceDuration) * 100)}%` : '0%' }}
                          >
                            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white shadow-md opacity-0 group-hover/seek:opacity-100 transition-opacity" />
                          </div>
                        </div>
                        <span className="text-[10px] text-zinc-400 tabular-nums">{formatTime(sourceDuration)}</span>
                      </div>
                    </div>
                    {/* Understand button */}
                    <button
                      type="button"
                      onClick={() => void handleUnderstand('source', sourceAudioUrl)}
                      disabled={understandStatus.source === 'running'}
                      title={t('understandTooltip')}
                      className="p-1.5 rounded-full hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-400 hover:text-violet-600 dark:hover:text-violet-400 transition-colors disabled:opacity-50"
                    >
                      {understandStatus.source === 'running' ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                    </button>
                    <button
                      type="button"
                      onClick={handleClearSourceAudio}
                      className="p-1.5 rounded-full hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-400 hover:text-zinc-600 dark:hover:text-white transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                  </div>
                  {/* Understand result panel (source) */}
                  {understandStatus.source !== 'idle' && (
                    <div className={`rounded-lg px-3 py-2 text-[11px] space-y-1 ${
                      understandStatus.source === 'error'
                        ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                        : 'bg-violet-50 dark:bg-violet-900/20 text-violet-800 dark:text-violet-300'
                    }`}>
                      {understandStatus.source === 'running' && <span className="flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> {t('understandRunning')}</span>}
                      {understandStatus.source === 'error' && <span>{t('understandError')}: {understandError.source}</span>}
                      {understandStatus.source === 'done' && understandResult.source && (
                        <>
                          <div className="font-semibold">{t('understandResult')}</div>
                          {understandResult.source.caption && <div className="truncate opacity-80">🎵 {String(understandResult.source.caption).slice(0, 80)}{String(understandResult.source.caption).length > 80 ? '…' : ''}</div>}
                          <div className="flex flex-wrap gap-2 opacity-70">
                            {understandResult.source.bpm && <span>BPM: {String(understandResult.source.bpm)}</span>}
                            {understandResult.source.keyscale && <span>Key: {String(understandResult.source.keyscale)}</span>}
                            {understandResult.source.duration && <span>Duration: {Math.round(Number(understandResult.source.duration))}s</span>}
                          </div>
                          <button
                            type="button"
                            onClick={() => applyUnderstandResult(understandResult.source!)}
                            className="mt-1 px-2 py-0.5 rounded bg-violet-600 text-white text-[10px] font-medium hover:bg-violet-700 transition-colors"
                          >
                            {t('understandApply')}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  </>
                )}

                {/* Cover / Repaint mode toggle (shown when source audio is loaded on the Cover tab) */}
                {audioTab === 'source' && sourceAudioUrl && (
                  <div className="space-y-2">
                    {/* Mode toggle: Cover vs Repaint */}
                    <div className="flex items-center gap-1 bg-zinc-100 dark:bg-black/20 rounded-lg p-0.5">
                      <button
                        type="button"
                        onClick={() => setTaskType('cover')}
                        className={`flex-1 py-1.5 rounded-md text-[11px] font-medium transition-all ${
                          taskType !== 'repaint'
                            ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm'
                            : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                        }`}
                      >
                        {t('coverMode')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setTaskType('repaint')}
                        className={`flex-1 py-1.5 rounded-md text-[11px] font-medium transition-all ${
                          taskType === 'repaint'
                            ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm'
                            : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                        }`}
                      >
                        {t('repaintMode')}
                      </button>
                    </div>

                    {/* Mode description */}
                    <p className="text-[10px] text-zinc-400 dark:text-zinc-500 px-0.5">
                      {taskType === 'repaint' ? t('repaintModeDescription') : t('coverModeDescription')}
                    </p>

                    {/* Cover strength slider (only in cover mode) */}
                    {taskType !== 'repaint' && (
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] text-zinc-500 dark:text-zinc-400 whitespace-nowrap">{t('audioCoverStrength')}</label>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={audioCoverStrength}
                          onChange={(e) => setAudioCoverStrength(Number(e.target.value))}
                          className="flex-1 h-1.5 accent-emerald-500"
                        />
                        <span className="text-[10px] text-zinc-400 tabular-nums w-7 text-right">{audioCoverStrength.toFixed(2)}</span>
                      </div>
                    )}

                    {/* Repaint time range (only in repaint mode) */}
                    {taskType === 'repaint' && (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-[10px] text-zinc-500 dark:text-zinc-400">
                            {t('repaintStart')}
                            {sourceDuration > 0 && <span className="text-zinc-400 ml-1">(max {formatTime(sourceDuration)})</span>}
                          </label>
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            max={sourceDuration > 0 ? sourceDuration : undefined}
                            placeholder={t('repaintStartPlaceholder')}
                            value={repaintingStart >= 0 ? repaintingStart : ''}
                            onChange={(e) => setRepaintingStart(e.target.value === '' ? -1 : Number(e.target.value))}
                            className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 rounded-lg px-2 py-1.5 text-xs text-zinc-900 dark:text-white focus:outline-none focus:border-emerald-500 dark:focus:border-emerald-500 transition-colors"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] text-zinc-500 dark:text-zinc-400">
                            {t('repaintEnd')}
                            {sourceDuration > 0 && <span className="text-zinc-400 ml-1">(max {formatTime(sourceDuration)})</span>}
                          </label>
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            max={sourceDuration > 0 ? sourceDuration : undefined}
                            placeholder={t('repaintEndPlaceholder')}
                            value={repaintingEnd >= 0 ? repaintingEnd : ''}
                            onChange={(e) => setRepaintingEnd(e.target.value === '' ? -1 : Number(e.target.value))}
                            className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 rounded-lg px-2 py-1.5 text-xs text-zinc-900 dark:text-white focus:outline-none focus:border-emerald-500 dark:focus:border-emerald-500 transition-colors"
                          />
                        </div>
                      </div>
                    )}

                    {/* SFT model status banner (shown when repaint mode active) */}
                    {taskType === 'repaint' && sftStatus !== 'idle' && (
                      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-medium ${
                        sftStatus === 'available'
                          ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400'
                          : sftStatus === 'downloading' || sftStatus === 'checking'
                          ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
                          : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                      }`}>
                        {sftStatus === 'available' && <CheckCircle2 size={13} />}
                        {(sftStatus === 'downloading' || sftStatus === 'checking') && <Loader2 size={13} className="animate-spin" />}
                        {sftStatus === 'unavailable' && <AlertTriangle size={13} />}
                        <span className="flex-1">
                          {sftStatus === 'available' && t('sftModelReady')}
                          {sftStatus === 'checking' && t('sftModelRequired')}
                          {sftStatus === 'downloading' && t('sftModelDownloading')}
                          {sftStatus === 'unavailable' && t('sftModelNotFound')}
                        </span>
                        {sftStatus === 'unavailable' && (
                          <a
                            href="/models"
                            onClick={(e) => { e.preventDefault(); window.history.pushState({}, '', '/models'); window.dispatchEvent(new PopStateEvent('popstate')); }}
                            className="flex items-center gap-0.5 underline underline-offset-2"
                          >
                            Models <ExternalLink size={10} />
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* ═══ LEGO TAB CONTENT ═══ */}
                {audioTab === 'lego' && (
                  <div className="space-y-3">
                    {/* Instrument selector — required, shown always */}
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wide">{t('legoTrackLabel')}</label>
                      <select
                        value={trackName}
                        onChange={(e) => setTrackName(e.target.value)}
                        className="w-full bg-zinc-50 dark:bg-black/20 border-2 border-amber-400 dark:border-amber-500/60 rounded-lg px-2 py-1.5 text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-amber-500 transition-colors cursor-pointer [&>option]:bg-white [&>option]:dark:bg-zinc-800"
                      >
                        <option value="">{t('legoTrackPlaceholder')}</option>
                        {TRACK_NAMES.map(name => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                      <p className="text-[10px] text-amber-600 dark:text-amber-400">{t('legoModeDescription')}</p>
                    </div>

                    {/* Existing backing track player (when loaded) */}
                    {sourceAudioUrl && (
                      <>
                      <div className="flex items-center gap-3 p-2 rounded-lg bg-zinc-50 dark:bg-white/[0.03] border border-zinc-100 dark:border-white/5">
                        <button
                          type="button"
                          onClick={() => toggleAudio('source')}
                          className="relative flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 text-white flex items-center justify-center shadow-lg shadow-amber-500/20 hover:scale-105 transition-transform"
                        >
                          {sourcePlaying ? (
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>
                          ) : (
                            <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                          )}
                          <span className="absolute -bottom-1 -right-1 text-[8px] font-bold bg-zinc-900 text-white px-1 py-0.5 rounded">
                            {formatTime(sourceDuration)}
                          </span>
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-zinc-800 dark:text-zinc-200 truncate mb-1.5">
                            {sourceAudioTitle || getAudioLabel(sourceAudioUrl)}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-zinc-400 tabular-nums">{formatTime(sourceTime)}</span>
                            <div
                              className="flex-1 h-1.5 rounded-full bg-zinc-200 dark:bg-white/10 cursor-pointer group/seek"
                              onClick={(e) => {
                                if (sourceAudioRef.current && sourceDuration > 0) {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  const percent = (e.clientX - rect.left) / rect.width;
                                  sourceAudioRef.current.currentTime = percent * sourceDuration;
                                }
                              }}
                            >
                              <div
                                className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all relative"
                                style={{ width: sourceDuration ? `${Math.min(100, (sourceTime / sourceDuration) * 100)}%` : '0%' }}
                              >
                                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white shadow-md opacity-0 group-hover/seek:opacity-100 transition-opacity" />
                              </div>
                            </div>
                            <span className="text-[10px] text-zinc-400 tabular-nums">{formatTime(sourceDuration)}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={handleClearSourceAudio}
                          className="p-1.5 rounded-full hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-400 hover:text-zinc-600 dark:hover:text-white transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                        </button>
                      </div>
                      </>
                    )}

                    <p className="text-[10px] text-amber-600 dark:text-amber-400">{t('legoBaseModelRequired')}</p>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => openAudioModal(audioTab === 'lego' ? 'source' : audioTab, 'uploads')}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-700 dark:text-zinc-300 px-3 py-2 text-xs font-medium transition-colors border border-zinc-200 dark:border-white/5"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/>
                    </svg>
                    {t('fromLibrary')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const input = audioTab === 'reference' ? referenceInputRef.current : sourceInputRef.current;
                      input?.click();
                    }}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-700 dark:text-zinc-300 px-3 py-2 text-xs font-medium transition-colors border border-zinc-200 dark:border-white/5"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
                    </svg>
                    {t('upload')}
                  </button>
                </div>
              </div>
            </div>
          </div>

        {/* LORA CONTROL PANEL */}
        <>
            <button
              onClick={() => setShowLoraPanel(!showLoraPanel)}
              className="w-full flex items-center justify-between px-4 py-3 bg-white dark:bg-suno-card rounded-xl border border-zinc-200 dark:border-white/5 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Sliders size={16} className="text-zinc-500" />
                <span>LoRA</span>
              </div>
              <ChevronDown size={16} className={`text-zinc-500 transition-transform ${showLoraPanel ? 'rotate-180' : ''}`} />
            </button>

            {showLoraPanel && (
              <div className="bg-white dark:bg-suno-card rounded-xl border border-zinc-200 dark:border-white/5 p-4 space-y-4">
                {/* LoRA Path Input */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{t('loraPath')}</label>
                  <input
                    type="text"
                    value={loraPath}
                    onChange={(e) => setLoraPath(e.target.value)}
                    placeholder={t('loraPathPlaceholder')}
                    className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:border-pink-500 dark:focus:border-pink-500 transition-colors"
                  />
                </div>

                {/* LoRA Load/Unload Toggle */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between py-2 border-t border-zinc-100 dark:border-white/5">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${
                        loraLoaded ? 'bg-green-500 animate-pulse' : 'bg-red-500'
                      }`}></div>
                      <span className={`text-xs font-medium ${
                        loraLoaded ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                      }`}>
                        {loraLoaded ? t('loraLoaded') : t('loraUnloaded')}
                      </span>
                    </div>
                    <button
                      onClick={handleLoraToggle}
                      disabled={!loraPath.trim() || isLoraLoading}
                      className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                        loraLoaded
                          ? 'bg-gradient-to-r from-green-500 to-emerald-600 text-white shadow-lg shadow-green-500/20 hover:from-green-600 hover:to-emerald-700'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                      }`}
                    >
                      {isLoraLoading ? '...' : (loraLoaded ? t('loraUnload') : t('loraLoad'))}
                    </button>
                  </div>
                  {loraError && (
                    <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded">
                      {loraError}
                    </div>
                  )}
                </div>

                {/* Use LoRA Checkbox (enable/disable without unloading) */}
                <div className={`flex items-center justify-between py-2 border-t border-zinc-100 dark:border-white/5 ${!loraLoaded ? 'opacity-40 pointer-events-none' : ''}`}>
                  <label className="flex items-center gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={loraEnabled}
                      onChange={handleLoraEnabledToggle}
                      disabled={!loraLoaded}
                      className="accent-pink-600"
                    />
                    Use LoRA
                  </label>
                </div>

                {/* LoRA Scale Slider */}
                <div className={!loraLoaded || !loraEnabled ? 'opacity-40 pointer-events-none' : ''}>
                  <EditableSlider
                    label={t('loraScale')}
                    value={loraScale}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={handleLoraScaleChange}
                    formatDisplay={(val) => val.toFixed(2)}
                    helpText={t('loraScaleDescription')}
                  />
                </div>
              </div>
            )}
        </>

        {/* COMMON SETTINGS */}
        <div className="space-y-4">


          {/* Vocal Language (Custom mode) */}
          {!instrumental && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide px-1">
                  {t('vocalLanguage')}
                </label>
                <select
                  value={vocalLanguage}
                  onChange={(e) => setVocalLanguage(e.target.value)}
                  className="w-full bg-white dark:bg-suno-card border border-zinc-200 dark:border-white/5 rounded-xl px-3 py-2 text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-pink-500 dark:focus:border-pink-500 transition-colors cursor-pointer [&>option]:bg-white [&>option]:dark:bg-zinc-800 [&>option]:text-zinc-900 [&>option]:dark:text-white"
                >
                  {VOCAL_LANGUAGE_KEYS.map(lang => (
                    <option key={lang.value} value={lang.value}>{t(lang.key)}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide px-1">
                  {t('vocalGender')}
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setVocalGender(vocalGender === 'male' ? '' : 'male')}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${vocalGender === 'male' ? 'bg-pink-600 text-white border-pink-600' : 'border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-white/20'}`}
                  >
                    {t('male')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setVocalGender(vocalGender === 'female' ? '' : 'female')}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${vocalGender === 'female' ? 'bg-pink-600 text-white border-pink-600' : 'border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-white/20'}`}
                  >
                    {t('female')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* MUSIC PARAMETERS */}
        <div className="bg-white dark:bg-suno-card rounded-xl border border-zinc-200 dark:border-white/5 p-4 space-y-4">
          <h3 className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide flex items-center gap-2">
            <Sliders size={14} />
            {t('musicParameters')}
          </h3>

          {/* BPM */}
          <EditableSlider
            label={t('bpm')}
            value={bpm}
            min={0}
            max={300}
            step={5}
            onChange={setBpm}
            formatDisplay={(val) => val === 0 ? t('auto') : val.toString()}
            autoLabel={t('auto')}
          />

          {/* Key & Time Signature */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Key</label>
              <select
                value={keyScale}
                onChange={(e) => setKeyScale(e.target.value)}
                className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 rounded-xl px-2 py-1.5 text-xs text-zinc-900 dark:text-white focus:outline-none focus:border-pink-500 dark:focus:border-pink-500 transition-colors cursor-pointer [&>option]:bg-white [&>option]:dark:bg-zinc-800 [&>option]:text-zinc-900 [&>option]:dark:text-white"
              >
                <option value="">Auto</option>
                {KEY_SIGNATURES.filter(k => k).map(key => (
                  <option key={key} value={key}>{key}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Time</label>
              <select
                value={timeSignature}
                onChange={(e) => setTimeSignature(e.target.value)}
                className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 rounded-xl px-2 py-1.5 text-xs text-zinc-900 dark:text-white focus:outline-none focus:border-pink-500 dark:focus:border-pink-500 transition-colors cursor-pointer [&>option]:bg-white [&>option]:dark:bg-zinc-800 [&>option]:text-zinc-900 [&>option]:dark:text-white"
              >
                <option value="">Auto</option>
                {TIME_SIGNATURES.filter(t => t).map(time => (
                  <option key={time} value={time}>{time}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* ADVANCED SETTINGS */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full flex items-center justify-between px-4 py-3 bg-white dark:bg-suno-card rounded-xl border border-zinc-200 dark:border-white/5 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Settings2 size={16} className="text-zinc-500" />
            <span>{t('advancedSettings')}</span>
          </div>
          <ChevronDown size={16} className={`text-zinc-500 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
        </button>

        {showAdvanced && (
          <div className="bg-white dark:bg-suno-card rounded-xl border border-zinc-200 dark:border-white/5 p-4 space-y-4">
            {/* Load Parameters from JSON */}
            <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-zinc-300 dark:border-white/15 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-white/5 cursor-pointer transition-colors">
              <Upload size={14} />
              Load Parameters (JSON)
              <input
                type="file"
                accept=".json"
                onChange={handleLoadParamsFile}
                className="hidden"
              />
            </label>

            {uploadError && (
              <div className="text-[11px] text-rose-500">{uploadError}</div>
            )}

            {/* ── Output ─────────────────────────────────────────────── */}
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest whitespace-nowrap">Output</span>
              <div className="flex-1 border-t border-zinc-200 dark:border-white/10" />
            </div>

            {/* Duration */}
            <EditableSlider
              label={t('duration')}
              value={duration}
              min={-1}
              max={600}
              step={5}
              onChange={setDuration}
              formatDisplay={(val) => val === -1 ? t('auto') : `${val}${t('seconds')}`}
              autoLabel={t('auto')}
              helpText="Target audio duration in seconds. −1 = LLM picks it. Clamped to [1, 600] s after generation."
            />

            {/* Batch Size */}
            <EditableSlider
              label={t('batchSize')}
              value={batchSize}
              min={1}
              max={4}
              step={1}
              onChange={setBatchSize}
              helpText="Number of DiT variations per LM output. All share the same lyrics; differences are timbral."
            />

            {/* Bulk Generate */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{t('bulkGenerate')}</label>
                  <span className="relative group/tip inline-flex">
                    <Info size={12} className="text-zinc-400 cursor-help" />
                    <span className="pointer-events-none absolute hidden group-hover/tip:block bottom-5 left-0 z-50 w-56 rounded-lg bg-zinc-900 p-2 text-[10px] leading-relaxed text-white shadow-xl">
                      Queues N fully independent generation jobs (different seeds, different lyrics).
                    </span>
                  </span>
                </div>
                <span className="text-xs font-mono text-zinc-900 dark:text-white bg-zinc-100 dark:bg-black/20 px-2 py-0.5 rounded">
                  {bulkCount} {t(bulkCount === 1 ? 'job' : 'jobs')}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 5, 10].map((count) => (
                  <button
                    key={count}
                    onClick={() => { setBulkCount(count); localStorage.setItem('ace-bulkCount', String(count)); }}
                    className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                      bulkCount === count
                        ? 'bg-gradient-to-r from-orange-500 to-pink-600 text-white shadow-md'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                    }`}
                  >
                    {count}
                  </button>
                ))}
              </div>
            </div>

            {/* Seed */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Dices size={14} className="text-zinc-500" />
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{t('seed')}</span>
                  <span className="relative group/tip inline-flex">
                    <Info size={12} className="text-zinc-400 cursor-help" />
                    <span className="pointer-events-none absolute hidden group-hover/tip:block bottom-5 left-0 z-50 w-56 rounded-lg bg-zinc-900 p-2 text-[10px] leading-relaxed text-white shadow-xl">
                      RNG seed (int64). −1 = random. Fixed seed makes results repeatable across runs. Batch elements use seed+0, seed+1, …
                    </span>
                  </span>
                </div>
                <button
                  onClick={() => setRandomSeed(!randomSeed)}
                  className={`w-10 h-5 rounded-full flex items-center transition-colors duration-200 px-0.5 border border-zinc-200 dark:border-white/5 ${randomSeed ? 'bg-pink-600' : 'bg-zinc-300 dark:bg-black/40'}`}
                >
                  <div className={`w-4 h-4 rounded-full bg-white transform transition-transform duration-200 shadow-sm ${randomSeed ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <Hash size={14} className="text-zinc-500" />
                <input
                  type="number"
                  value={seed}
                  onChange={(e) => setSeed(Number(e.target.value))}
                  placeholder={t('enterFixedSeed')}
                  disabled={randomSeed}
                  className={`flex-1 bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-1.5 text-xs text-zinc-900 dark:text-white focus:outline-none ${randomSeed ? 'opacity-40 cursor-not-allowed' : ''}`}
                />
              </div>
              <p className="text-[10px] text-zinc-500">{randomSeed ? t('randomSeedRecommended') : t('fixedSeedReproducible')}</p>
            </div>

            {/* ── DiT flow matching (dit-vae) ──────────────────────── */}
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest whitespace-nowrap">DiT flow matching (dit-vae)</span>
              <div className="flex-1 border-t border-zinc-200 dark:border-white/10" />
            </div>

            {/* Inference Steps */}
            <EditableSlider
              label={t('inferenceSteps')}
              value={inferenceSteps}
              min={1}
              max={isTurboModel(selectedModel) ? 20 : 200}
              step={1}
              onChange={setInferenceSteps}
              helpText="Number of denoising steps. Turbo preset: 8. SFT/base preset: 50. More steps = better quality but slower."
            />

            {/* Guidance Scale */}
            <EditableSlider
              label={t('guidanceScale')}
              value={guidanceScale}
              min={0}
              max={15}
              step={0.1}
              onChange={setGuidanceScale}
              formatDisplay={(val) => val.toFixed(1)}
              helpText="CFG scale for the DiT. 0.0 = auto (resolved to 1.0, CFG disabled). Any value > 1.0 on a turbo model is overridden to 1.0."
            />

            {/* Shift */}
            <EditableSlider
              label={t('shift')}
              value={shift}
              min={0.1}
              max={8}
              step={0.1}
              onChange={setShift}
              formatDisplay={(val) => val.toFixed(1)}
              helpText="Flow-matching schedule shift — controls the timestep distribution (shift = s·t / (1+(s−1)·t)). Turbo preset: 3.0. SFT/lego preset: 1.0. Values near 1.0 give a linear schedule; higher values front-load denoising."
            />

            {/* ── LM sampling (ace-qwen3) ──────────────────────────── */}
            <>
              <div className="flex items-center gap-2 pt-1">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest whitespace-nowrap">LM sampling (ace-qwen3)</span>
                  <div className="flex-1 border-t border-zinc-200 dark:border-white/10" />
                </div>

                {/* LM Model */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{t('lmModelLabel')}</label>
                    <span className="relative group/tip inline-flex">
                      <Info size={12} className="text-zinc-400 cursor-help" />
                      <span className="pointer-events-none absolute hidden group-hover/tip:block bottom-5 left-0 z-50 w-56 rounded-lg bg-zinc-900 p-2 text-[10px] leading-relaxed text-white shadow-xl">
                        ace-qwen3 model size. 0.6B is fastest; 4B produces the best lyrics and captions.
                      </span>
                    </span>
                  </div>
                  <select
                    value={lmModel}
                    onChange={(e) => { const v = e.target.value; setLmModel(v); localStorage.setItem('ace-lmModel', v); }}
                    className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 rounded-lg px-2 py-1.5 text-xs text-zinc-900 dark:text-white focus:outline-none"
                  >
                    <option value="acestep-5Hz-lm-0.6B">{t('lmModel06B')}</option>
                    <option value="acestep-5Hz-lm-1.7B">{t('lmModel17B')}</option>
                    <option value="acestep-5Hz-lm-4B">{t('lmModel4B')}</option>
                  </select>
                </div>

                {/* CoT Caption toggle */}
                <div className="flex items-center justify-between py-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">CoT Caption</span>
                    <span className="relative group/tip inline-flex">
                      <Info size={12} className="text-zinc-400 cursor-help" />
                      <span className="pointer-events-none absolute hidden group-hover/tip:block bottom-5 left-0 z-50 w-60 rounded-lg bg-zinc-900 p-2 text-[10px] leading-relaxed text-white shadow-xl">
                        <strong>use_cot_caption</strong> (default: on) — When enabled, the LLM enriches your caption using chain-of-thought reasoning before passing it to the DiT (only when the LLM is generating missing metadata). Disable to use your caption verbatim without AI rewriting.
                      </span>
                    </span>
                  </div>
                  <button
                    onClick={() => setUseCotCaption(!useCotCaption)}
                    className={`w-10 h-5 rounded-full flex items-center transition-colors duration-200 px-0.5 border border-zinc-200 dark:border-white/5 ${useCotCaption ? 'bg-pink-600' : 'bg-zinc-300 dark:bg-black/40'}`}
                  >
                    <div className={`w-4 h-4 rounded-full bg-white transform transition-transform duration-200 shadow-sm ${useCotCaption ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>

                {/* LM Temperature */}
                <EditableSlider
                  label={t('lmTemperature')}
                  value={lmTemperature}
                  min={0}
                  max={2}
                  step={0.05}
                  onChange={setLmTemperature}
                  formatDisplay={(val) => val.toFixed(2)}
                  helpText="Sampling temperature for phase 1 (lyrics/metadata) and phase 2 (audio codes). Lower = more deterministic. Default: 0.85."
                />

                {/* LM CFG Scale */}
                <EditableSlider
                  label={t('lmCfgScale')}
                  value={lmCfgScale}
                  min={1}
                  max={5}
                  step={0.1}
                  onChange={setLmCfgScale}
                  formatDisplay={(val) => val.toFixed(1)}
                  helpText="CFG scale for the LM. Active in phase 2 and in phase 1 when lyrics are provided. 1.0 disables CFG. Default: 2.0."
                />

                {/* LM Top-P */}
                <EditableSlider
                  label={t('topP')}
                  value={lmTopP}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={setLmTopP}
                  formatDisplay={(val) => val.toFixed(2)}
                  helpText="Nucleus sampling cutoff. 1.0 disables. Default: 0.9."
                />

                {/* LM Top-K */}
                <EditableSlider
                  label={t('topK')}
                  value={lmTopK}
                  min={0}
                  max={200}
                  step={1}
                  onChange={setLmTopK}
                  helpText="Top-K sampling. 0 disables hard top-K (top_p still applies). Default: 0."
                />

                {/* LM Negative Prompt */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{t('lmNegativePrompt')}</label>
                    <span className="relative group/tip inline-flex">
                      <Info size={12} className="text-zinc-400 cursor-help" />
                      <span className="pointer-events-none absolute hidden group-hover/tip:block bottom-5 left-0 z-50 w-60 rounded-lg bg-zinc-900 p-2 text-[10px] leading-relaxed text-white shadow-xl">
                        Negative caption for CFG in phase 2. Steers the LM away from these words/concepts. Empty string falls back to a caption-less unconditional prompt.
                      </span>
                    </span>
                  </div>
                  <textarea
                    value={lmNegativePrompt}
                    onChange={(e) => setLmNegativePrompt(e.target.value)}
                    placeholder={t('thingsToAvoid')}
                    className="w-full h-16 bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 rounded-lg p-2 text-xs text-zinc-900 dark:text-white focus:outline-none resize-none"
                  />
                </div>
            </>

            {/* ── Passthrough ──────────────────────────────────────── */}
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest whitespace-nowrap">Passthrough</span>
              <div className="flex-1 border-t border-zinc-200 dark:border-white/10" />
            </div>

            {/* Audio Codes */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{t('audioCodes')}</label>
                <span className="relative group/tip inline-flex">
                  <Info size={12} className="text-zinc-400 cursor-help" />
                  <span className="pointer-events-none absolute hidden group-hover/tip:block bottom-5 left-0 z-50 w-64 rounded-lg bg-zinc-900 p-2 text-[10px] leading-relaxed text-white shadow-xl">
                    Comma-separated FSQ token IDs produced by ace-qwen3. When non-empty, the entire LLM pass is skipped and dit-vae decodes these codes directly (passthrough mode).
                  </span>
                </span>
              </div>
              <textarea
                value={audioCodes}
                onChange={(e) => setAudioCodes(e.target.value)}
                placeholder={t('optionalAudioCodes')}
                className="w-full h-16 bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 rounded-lg p-2 text-xs text-zinc-900 dark:text-white focus:outline-none resize-none"
              />
            </div>
          </div>
        )}
      </div>

      {showAudioModal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => { setShowAudioModal(false); setPlayingTrackId(null); setPlayingTrackSource(null); }}
          />
          <div className="relative w-[92%] max-w-lg rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="p-5 pb-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-xl font-semibold text-zinc-900 dark:text-white">
                    {audioModalTarget === 'reference' ? t('referenceModalTitle') : t('coverModalTitle')}
                  </h3>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                    {audioModalTarget === 'reference'
                      ? t('referenceModalDescription')
                      : t('coverModalDescription')}
                  </p>
                </div>
                <button
                  onClick={() => { setShowAudioModal(false); setPlayingTrackId(null); setPlayingTrackSource(null); }}
                  className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/10 text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                </button>
              </div>

              {/* Upload Button */}
              <button
                type="button"
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = '.mp3,.wav,.flac,.m4a,.mp4,audio/*';
                  input.onchange = (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (file) void uploadReferenceTrack(file);
                  };
                  input.click();
                }}
                disabled={isUploadingReference || isTranscribingReference}
                className="mt-4 w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 dark:border-white/20 bg-zinc-50 dark:bg-white/5 px-4 py-3 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-white/10 hover:border-zinc-400 dark:hover:border-white/30 transition-all"
              >
                {isUploadingReference ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    {t('uploadingAudio')}
                  </>
                ) : isTranscribingReference ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    {t('transcribing')}
                  </>
                ) : (
                  <>
                    <Upload size={16} />
                    {t('uploadAudio')}
                    <span className="text-xs text-zinc-400 ml-1">{t('audioFormats')}</span>
                  </>
                )}
              </button>

              {uploadError && (
                <div className="mt-2 text-xs text-rose-500">{uploadError}</div>
              )}
              {isTranscribingReference && (
                <div className="mt-2 flex items-center justify-between text-xs text-zinc-400">
                  <span>{t('transcribingWithWhisper')}</span>
                  <button
                    type="button"
                    onClick={cancelTranscription}
                    className="text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white"
                  >
                    {t('cancel')}
                  </button>
                </div>
              )}
            </div>

            {/* Library Section */}
            <div className="border-t border-zinc-100 dark:border-white/5">
              <div className="px-5 py-3 flex items-center gap-2">
                <div className="flex items-center gap-1 bg-zinc-200/60 dark:bg-white/10 rounded-full p-0.5">
                  <button
                    type="button"
                    onClick={() => setLibraryTab('uploads')}
                    className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                      libraryTab === 'uploads'
                        ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                    }`}
                  >
                    {t('uploaded')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setLibraryTab('created')}
                    className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                      libraryTab === 'created'
                        ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                    }`}
                  >
                    {t('createdTab')}
                  </button>
                </div>
              </div>

              {/* Track List */}
              <div className="max-h-[280px] overflow-y-auto">
                {libraryTab === 'uploads' ? (
                  isLoadingTracks ? (
                    <div className="px-5 py-8 text-center">
                      <RefreshCw size={20} className="animate-spin mx-auto text-zinc-400" />
                      <p className="text-xs text-zinc-400 mt-2">{t('loadingTracks')}</p>
                    </div>
                  ) : referenceTracks.length === 0 ? (
                    <div className="px-5 py-8 text-center">
                      <Music2 size={24} className="mx-auto text-zinc-300 dark:text-zinc-600" />
                      <p className="text-sm text-zinc-400 mt-2">{t('noTracksYet')}</p>
                      <p className="text-xs text-zinc-400 mt-1">{t('uploadAudioFilesAsReferences')}</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-zinc-100 dark:divide-white/5">
                      {referenceTracks.map((track) => (
                        <div
                          key={track.id}
                          className="px-5 py-3 flex items-center gap-3 hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors group"
                        >
                          {/* Play Button */}
                          <button
                            type="button"
                            onClick={() => toggleModalTrack({ id: track.id, audio_url: track.audio_url, source: 'uploads' })}
                            className="flex-shrink-0 w-9 h-9 rounded-full bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-300 flex items-center justify-center hover:bg-zinc-200 dark:hover:bg-white/20 transition-colors"
                          >
                            {playingTrackId === track.id && playingTrackSource === 'uploads' ? (
                              <Pause size={14} fill="currentColor" />
                            ) : (
                              <Play size={14} fill="currentColor" className="ml-0.5" />
                            )}
                          </button>

                          {/* Track Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                                {track.filename.replace(/\.[^/.]+$/, '')}
                              </span>
                              {track.tags && track.tags.length > 0 && (
                                <div className="flex gap-1">
                                  {track.tags.slice(0, 2).map((tag, i) => (
                                    <span key={i} className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-200 dark:bg-white/10 text-zinc-600 dark:text-zinc-400">
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                            {/* Progress bar with seek - show when this track is playing */}
                            {playingTrackId === track.id && playingTrackSource === 'uploads' ? (
                              <div className="flex items-center gap-2 mt-1.5">
                                <span className="text-[10px] text-zinc-400 tabular-nums w-8">
                                  {formatTime(modalTrackTime)}
                                </span>
                                <div
                                  className="flex-1 h-1.5 rounded-full bg-zinc-200 dark:bg-white/10 cursor-pointer group/seek"
                                  onClick={(e) => {
                                    if (modalAudioRef.current && modalTrackDuration > 0) {
                                      const rect = e.currentTarget.getBoundingClientRect();
                                      const percent = (e.clientX - rect.left) / rect.width;
                                      modalAudioRef.current.currentTime = percent * modalTrackDuration;
                                    }
                                  }}
                                >
                                  <div
                                    className="h-full bg-gradient-to-r from-pink-500 to-purple-500 rounded-full relative"
                                    style={{ width: modalTrackDuration > 0 ? `${(modalTrackTime / modalTrackDuration) * 100}%` : '0%' }}
                                  >
                                    <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white shadow-md opacity-0 group-hover/seek:opacity-100 transition-opacity" />
                                  </div>
                                </div>
                                <span className="text-[10px] text-zinc-400 tabular-nums w-8 text-right">
                                  {formatTime(modalTrackDuration)}
                                </span>
                              </div>
                            ) : (
                              <div className="text-xs text-zinc-400 mt-0.5">
                                {track.duration ? formatTime(track.duration) : '--:--'}
                              </div>
                            )}
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={() => useReferenceTrack({ audio_url: track.audio_url, title: track.filename })}
                              className="px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-xs font-semibold hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors"
                            >
                              {t('useTrack')}
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteReferenceTrack(track.id)}
                              className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-400 hover:text-rose-500 transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                ) : createdTrackOptions.length === 0 ? (
                  <div className="px-5 py-8 text-center">
                    <Music2 size={24} className="mx-auto text-zinc-300 dark:text-zinc-600" />
                    <p className="text-sm text-zinc-400 mt-2">{t('noCreatedSongsYet')}</p>
                    <p className="text-xs text-zinc-400 mt-1">{t('generateSongsToReuse')}</p>
                  </div>
                ) : (
                  <div className="divide-y divide-zinc-100 dark:divide-white/5">
                    {createdTrackOptions.map((track) => (
                      <div
                        key={track.id}
                        className="px-5 py-3 flex items-center gap-3 hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors group"
                      >
                        <button
                          type="button"
                          onClick={() => toggleModalTrack({ id: track.id, audio_url: track.audio_url, source: 'created' })}
                          className="flex-shrink-0 w-9 h-9 rounded-full bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-300 flex items-center justify-center hover:bg-zinc-200 dark:hover:bg-white/20 transition-colors"
                        >
                          {playingTrackId === track.id && playingTrackSource === 'created' ? (
                            <Pause size={14} fill="currentColor" />
                          ) : (
                            <Play size={14} fill="currentColor" className="ml-0.5" />
                          )}
                        </button>

                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                            {track.title}
                          </div>
                          {playingTrackId === track.id && playingTrackSource === 'created' ? (
                            <div className="flex items-center gap-2 mt-1.5">
                              <span className="text-[10px] text-zinc-400 tabular-nums w-8">
                                {formatTime(modalTrackTime)}
                              </span>
                              <div
                                className="flex-1 h-1.5 rounded-full bg-zinc-200 dark:bg-white/10 cursor-pointer group/seek"
                                onClick={(e) => {
                                  if (modalAudioRef.current && modalTrackDuration > 0) {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const percent = (e.clientX - rect.left) / rect.width;
                                    modalAudioRef.current.currentTime = percent * modalTrackDuration;
                                  }
                                }}
                              >
                                <div
                                  className="h-full bg-gradient-to-r from-pink-500 to-purple-500 rounded-full relative"
                                  style={{ width: modalTrackDuration > 0 ? `${(modalTrackTime / modalTrackDuration) * 100}%` : '0%' }}
                                >
                                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white shadow-md opacity-0 group-hover/seek:opacity-100 transition-opacity" />
                                </div>
                              </div>
                              <span className="text-[10px] text-zinc-400 tabular-nums w-8 text-right">
                                {formatTime(modalTrackDuration)}
                              </span>
                            </div>
                          ) : (
                            <div className="text-xs text-zinc-400 mt-0.5">
                              {track.duration || '--:--'}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={() => useReferenceTrack({ audio_url: track.audio_url, title: track.title })}
                            className="px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-xs font-semibold hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors"
                          >
                            {t('useTrack')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Hidden audio element for modal playback */}
            <audio
              ref={modalAudioRef}
              onTimeUpdate={() => {
                if (modalAudioRef.current) {
                  setModalTrackTime(modalAudioRef.current.currentTime);
                }
              }}
              onLoadedMetadata={() => {
                if (modalAudioRef.current) {
                  setModalTrackDuration(modalAudioRef.current.duration);
                  // Update track duration in database if not set
                  const track = referenceTracks.find(t => t.id === playingTrackId);
                  if (playingTrackSource === 'uploads' && track && !track.duration && token) {
                    fetch(`/api/reference-tracks/${track.id}`, {
                      method: 'PATCH',
                      headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`
                      },
                      body: JSON.stringify({ duration: Math.round(modalAudioRef.current.duration) })
                    }).then(() => {
                      setReferenceTracks(prev => prev.map(t =>
                        t.id === track.id ? { ...t, duration: Math.round(modalAudioRef.current?.duration || 0) } : t
                      ));
                    }).catch(() => undefined);
                  }
                }
              }}
              onEnded={() => setPlayingTrackId(null)}
            />
          </div>
        </div>
      )}

      {/* Footer Create Button */}
      <div className="p-4 mt-auto sticky bottom-0 bg-zinc-50/95 dark:bg-suno-panel/95 backdrop-blur-sm z-10 border-t border-zinc-200 dark:border-white/5 space-y-3">
        <button
          onClick={handleGenerate}
          className="w-full h-12 rounded-xl font-bold text-base flex items-center justify-center gap-2 transition-all transform active:scale-[0.98] bg-gradient-to-r from-orange-500 to-pink-600 text-white shadow-lg hover:brightness-110"
          disabled={isGenerating || !isAuthenticated}
        >
          <Sparkles size={18} />
          <span>
            {isGenerating 
              ? t('generating')
              : bulkCount > 1
                ? `${t('createButton')} ${bulkCount} ${t('jobs')} (${bulkCount * batchSize} ${t('variations')})`
                : `${t('createButton')}${batchSize > 1 ? ` (${batchSize} ${t('variations')})` : ''}`
            }
          </span>
        </button>
      </div>
    </div>
  );
};
