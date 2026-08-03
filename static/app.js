const {
  $,
  apiPath,
  clamp,
  cssColor,
  dbToGain,
  escapeHtml,
  formatBytes,
  formatNumber,
  formatTime,
  mapRange,
  setStyleProperty,
  setText,
  toggleClass
} = window.SpatialAudioUtils;

const {
  LIVE_SIGNATURES,
  METER_FRAME_INTERVAL,
  SHORT_NAMES,
  STEM_ORDER,
  STEM_PROFILES
} = window.SpatialAudioConfig;

const SPECTRUM_BAR_COUNT = 24;
const LIVE_ANALYSER_FFT_SIZE = 2048;
const STEM_METER_FFT_SIZE = 512;
const VISUAL_FRAME_INTERVAL = 0;
const UI_FRAME_INTERVAL = METER_FRAME_INTERVAL;
const HIDDEN_VISUAL_FRAME_INTERVAL = 1 / 8;
const SPECTRUM_FRAME_INTERVAL = 1 / 30;
const SPECTRUM_STATUS_UPDATE_INTERVAL_MS = 500;
const METER_STYLE_EPSILON = 0.012;
const STEM_METER_DB_OFFSET = -10;
const DEMUCS_MODEL = "htdemucs_ft";
const MAX_AUDIO_FILE_BYTES = 420 * 1024 * 1024;
const MAX_CANVAS_DPR = 2;
const AUDIO_CONTEXT_RESUME_WAIT_MS = 250;
const STEM_DURATION_TOLERANCE_SECONDS = 0.12;
const SUPPORTED_AUDIO_EXTENSIONS = new Set(["aac", "flac", "m4a", "mp3", "ogg", "opus", "wav", "webm"]);
const ANALYSIS_PHASES = {
  upload: { progress: 16, order: 0 },
  separate: { progress: 46, order: 1 },
  decode: { progress: 80, order: 2 },
  render: { progress: 95, order: 3 },
  ready: { progress: 100, order: 4 }
};
const DEFAULT_MEASURED_BRIR_URL = "/brir/air_aula_carolina_front_late.wav";
// 레지스트리 스키마가 바뀌어도 이전 immutable 캐시와 섞이지 않도록 버전을 URL에 포함한다.
const BRIR_LIBRARY_URL = "/brir/profiles.json?v=20260803-brir-library-v2";
const DEFAULT_BRIR_PROFILE_ID = "aula";
const SPATIAL_RENDER_CACHE_MAX_BYTES = 384 * 1024 * 1024;
const SPATIAL_RENDER_CACHE_MAX_ENTRIES = 2;
const SPATIAL_RENDER_PIPELINE_VERSION = "v111-surround-envelope";
const SPATIAL_CACHE_DB_NAME = "spatial-audio-essential-render-cache";
const SPATIAL_CACHE_DB_VERSION = 1;
const SPATIAL_CACHE_CHUNK_BYTES = 8 * 1024 * 1024;
const SPATIAL_CACHE_PERSISTENT_MAX_BYTES = 512 * 1024 * 1024;
const SPATIAL_SPACE_MULTIPLIER = 3.2;  //공간 크기는 유지하되 짧은 반사음과 과도한 gain 합산을 피하는 범위
const SPATIAL_WIDTH_MULTIPLIER = 2.8;  //원본 stereo image를 보존하는 완만한 좌우 확장
const SPATIAL_DISTANCE_ENVELOPMENT = 2.8;  //과도한 원거리 좌표 포화를 피하는 거리 배율
const SPATIAL_SIDE_ENERGY_SCALE = 1.8;  //원본 side 신호보다 낮은 보조 확장 레이어
const HRTF_LIBRARY_URL = "/hrtf/profiles.json";
const DEFAULT_HRTF_PROFILE_ID = "sadie-kemar";
const SPATIAL_OUTPUT_PEAK_GUARD_PRE_GAIN = 0.94;
const SPATIAL_OUTPUT_PEAK_GUARD_THRESHOLD_DB = -0.6;
const SPATIAL_OUTPUT_PEAK_GUARD_KNEE_DB = 0.5;
const SPATIAL_OUTPUT_PEAK_GUARD_RATIO = 16;
const SPATIAL_OUTPUT_PEAK_GUARD_ATTACK = 0.0015;
const SPATIAL_OUTPUT_PEAK_GUARD_RELEASE = 0.11;
const SPATIAL_NATURAL_DELAY_SCALE = 1;
const SPATIAL_NATURAL_PAN_SCALE = 1.3;
const SPATIAL_FRONT_HEMISPHERE_AZIMUTH_LIMIT = 100;
const SPATIAL_MAX_RENDER_AZIMUTH = 168;
const SPATIAL_RESEARCH_PROFILE = Object.freeze({
  anchorLeadSeconds: 0.006,
  diffuseToAnchorMax: 0.72,
  wetHighpassHz: 110,
  wetLowpassHz: 14500,
  lateralHighpassHz: 220,
  midDerivedSideHighpassHz: 700,
  midDerivedSideLowpassHz: 12000,
  diffuseFieldHighpassHz: 320
});
const SPATIAL_ROOM_RESPONSE_EQ = Object.freeze([
  Object.freeze({ type: "lowshelf", frequency: 165, gain: -1.2, q: 0.707 }),
  Object.freeze({ type: "peaking", frequency: 340, gain: -1.15, q: 0.72 }),
  Object.freeze({ type: "peaking", frequency: 4200, gain: 1.15, q: 0.68 })
]);
const SPATIAL_DISTANCE_BRIR_PROFILES = Object.freeze({
  near: Object.freeze({ id: "near", distance: 1.2, radiusMax: 0.98, preDelay: 0, gainScale: 0.82, highpass: 250, lowpass: 11500, earlyDelayScale: 0.92 }),
  mid: Object.freeze({ id: "mid", distance: 2.1, radiusMax: 1.14, preDelay: 0.006, gainScale: 0.96, highpass: 220, lowpass: 10500, earlyDelayScale: 1 }),
  far: Object.freeze({ id: "far", distance: 3, radiusMax: Infinity, preDelay: 0.012, gainScale: 1.06, highpass: 235, lowpass: 9600, earlyDelayScale: 1.12 })
});
const SPATIAL_ENGINE_DEFAULTS = {
  wet: 0.82,
  radius: 1.18,
  reflections: 0.72
};
const SPATIAL_FIELD_DIRECTIONS = [
  { id: "front", azimuth: 0, elevation: 22, distance: 6.5, gain: 0.1, delay: 0.009 },
  { id: "frontLeft", azimuth: -88, elevation: 27, distance: 9.2, gain: 0.16, delay: 0.014 },
  { id: "frontRight", azimuth: 88, elevation: 27, distance: 9.2, gain: 0.16, delay: 0.0147 },
  { id: "left", azimuth: -128, elevation: 18, distance: 11.5, gain: 0.19, delay: 0.021 },
  { id: "right", azimuth: 128, elevation: 18, distance: 11.5, gain: 0.19, delay: 0.0218 },
  { id: "rearLeft", azimuth: -156, elevation: 27, distance: 13.5, gain: 0.065, delay: 0.031 },
  { id: "rearRight", azimuth: 156, elevation: 27, distance: 13.5, gain: 0.065, delay: 0.032 },
  { id: "rear", azimuth: 180, elevation: 12, distance: 15.5, gain: 0.045, delay: 0.038 },
  { id: "heightFront", azimuth: -42, elevation: 82, distance: 12.0, gain: 0.105, delay: 0.027 },
  { id: "heightRear", azimuth: 172, elevation: 76, distance: 15.0, gain: 0.05, delay: 0.04 }
];
const FULL_SPATIAL_ORCHESTRAL_HALL_DIRECTIONS = Object.freeze([
  { id: "stageEdgeLeft", azimuth: -46, elevation: 11, distance: 9.5, gain: 0.13, delay: 0.011 },
  { id: "stageEdgeRight", azimuth: 46, elevation: 11, distance: 9.5, gain: 0.13, delay: 0.011 },
  { id: "sideWallLeft", azimuth: -92, elevation: 17, distance: 13.5, gain: 0.18, delay: 0.02 },
  { id: "sideWallRight", azimuth: 92, elevation: 17, distance: 13.5, gain: 0.18, delay: 0.02 },
  { id: "balconyLeft", azimuth: -122, elevation: 36, distance: 17, gain: 0.16, delay: 0.03 },
  { id: "balconyRight", azimuth: 122, elevation: 36, distance: 17, gain: 0.16, delay: 0.03 },
  { id: "ceilingLeft", azimuth: -68, elevation: 74, distance: 16.5, gain: 0.11, delay: 0.036 },
  { id: "ceilingRight", azimuth: 68, elevation: 74, distance: 16.5, gain: 0.11, delay: 0.036 },
  { id: "rearGalleryLeft", azimuth: -158, elevation: 24, distance: 21, gain: 0.14, delay: 0.046 },
  { id: "rearGalleryRight", azimuth: 158, elevation: 24, distance: 21, gain: 0.14, delay: 0.046 }
]);
const FULL_SPATIAL_EXTERNALIZED_PERIMETER_DIRECTIONS = Object.freeze([
  { id: "nearFrontLeft", azimuth: -42, elevation: 8, distance: 3.0, gain: 0.21, delay: 0.006 },
  { id: "nearFrontRight", azimuth: 42, elevation: 8, distance: 3.0, gain: 0.21, delay: 0.006 },
  { id: "nearSideLeft", azimuth: -100, elevation: 15, distance: 3.35, gain: 0.21, delay: 0.0098 },
  { id: "nearSideRight", azimuth: 100, elevation: 15, distance: 3.35, gain: 0.21, delay: 0.0098 },
  { id: "nearRearLeft", azimuth: -150, elevation: 16, distance: 3.7, gain: 0.18, delay: 0.0145 },
  { id: "nearRearRight", azimuth: 150, elevation: 16, distance: 3.7, gain: 0.18, delay: 0.0145 },
  { id: "nearHeightLeft", azimuth: -72, elevation: 60, distance: 3.55, gain: 0.135, delay: 0.012 },
  { id: "nearHeightRight", azimuth: 72, elevation: 60, distance: 3.55, gain: 0.135, delay: 0.012 },
  { id: "nearBackLeft", azimuth: -178, elevation: 8, distance: 4.0, gain: 0.13, delay: 0.018 },
  { id: "nearBackRight", azimuth: 178, elevation: 8, distance: 4.0, gain: 0.13, delay: 0.018 }
]);
const SPATIAL_FIELD_HRTF_TAPS = new Set(["front", "frontLeft", "frontRight", "left", "right", "rearLeft", "rearRight", "rear", "heightFront", "heightRear"]);
const STEM_OBJECT_ROUTES = {
  vocals: {
    depthRole: "front",
    send: 0.24,
    highpass: 110,
    lowpass: 13500,
    diffuseHighpass: 900,
    taps: [
      { azimuth: -14, elevation: 9, distance: 3.2, delay: 0.006, gain: 0.84, anchor: true },
      { azimuth: -58, elevation: 18, distance: 5.4, delay: 0.015, gain: 0.12 },
      { azimuth: 54, elevation: 20, distance: 5.6, delay: 0.019, gain: 0.12 }
    ]
  },
  drums: {
    depthRole: "rear",
    send: 0.34,
    highpass: 80,
    lowpass: 11500,
    diffuseHighpass: 1200,
    taps: [
      { azimuth: 148, elevation: 2, distance: 10.5, delay: 0.017, gain: 0.68, anchor: true },
      { azimuth: -142, elevation: 8, distance: 11.2, delay: 0.025, gain: 0.16 },
      { azimuth: 172, elevation: 14, distance: 12.4, delay: 0.03, gain: 0.09 },
      { azimuth: -168, elevation: 16, distance: 12.8, delay: 0.034, gain: 0.07 }
    ]
  },
  bass: {
    depthRole: "rear",
    send: 0.19,
    highpass: 150,
    lowpass: 2800,
    diffuseHighpass: 320,
    taps: [
      { azimuth: 178, elevation: -8, distance: 9.8, delay: 0.02, gain: 0.76, anchor: true },
      { azimuth: -138, elevation: 0, distance: 11.4, delay: 0.028, gain: 0.12 },
      { azimuth: 138, elevation: 2, distance: 11.8, delay: 0.032, gain: 0.12 }
    ]
  },
  other: {
    depthRole: "front",
    send: 0.32,
    highpass: 125,
    lowpass: 13000,
    diffuseHighpass: 650,
    taps: [
      { azimuth: -62, elevation: 10, distance: 3.8, delay: 0.007, gain: 0.72, anchor: true },
      { azimuth: 68, elevation: 14, distance: 5.8, delay: 0.016, gain: 0.16 },
      { azimuth: 0, elevation: 44, distance: 6.2, delay: 0.02, gain: 0.1 },
      { azimuth: -92, elevation: 18, distance: 6.8, delay: 0.024, gain: 0.06 }
    ]
  }
};
// 직접음은 그대로 유지하고, 공간 버스에 들어가는 보컬만 낮춰 전방 초점을 보존한다.
const SPATIAL_STEM_ROOM_SCENE_SCALE = Object.freeze({
  vocals: 0.84,
  other: 1,
  drums: 1,
  bass: 1
});
// 전체 잔향을 늘리지 않고 측면 초기반사만 확장한다.
const SPATIAL_STEM_LATERAL_EARLY_SCALE = Object.freeze({
  vocals: 1,
  other: 1.12,
  drums: 1.08,
  bass: 1
});
const FULL_SPATIAL_MIXTURE_SCALE_MIN = 0.72;
const FULL_SPATIAL_MIXTURE_SCALE_MAX = 1.18;
const FULL_SPATIAL_RESIDUAL_SAMPLE_LIMIT = 32768;
const STEM_ALIGNMENT_MAX_LAG_SAMPLES = 128;
const STEM_ALIGNMENT_SAMPLE_LIMIT = 24000;
const STEM_ALIGNMENT_MIN_CORRELATION = 0.12;
const RUNTIME_QUALITY_PROFILE = {
  label: "Full",
  meterInterval: UI_FRAME_INTERVAL,
  stemDisplayInterval: UI_FRAME_INTERVAL,
  fieldDisplayInterval: UI_FRAME_INTERVAL,
  spectrumInterval: SPECTRUM_FRAME_INTERVAL,
  seekInterval: UI_FRAME_INTERVAL,
  waveformInterval: UI_FRAME_INTERVAL
};
const AUDIO_QUALITY_PROFILES = Object.freeze({
  full: { id: "full", label: "Full DSP", perimeterPairs: 5, hallPairs: 5, stemReflectionScale: 1, roomScale: 1 },
  balanced: { id: "balanced", label: "Balanced DSP", perimeterPairs: 4, hallPairs: 4, stemReflectionScale: 0.84, roomScale: 0.94 },
  safe: { id: "safe", label: "Safe DSP", perimeterPairs: 3, hallPairs: 3, stemReflectionScale: 0.68, roomScale: 0.86 }
});

const STEM_POSITION_GROUPS = {
  vocals: [
    ["piano", 0.92],
    ["violins1", 0.82],
    ["violins2", 0.58],
    ["flute", 0.58],
    ["oboe", 0.5],
    ["trumpet", 0.38],
    ["harp", 0.34]
  ],
  other: [
    ["violins1", 0.78],
    ["violins2", 0.76],
    ["violas", 0.72],
    ["cellos", 0.66],
    ["flute", 0.54],
    ["oboe", 0.56],
    ["clarinet", 0.56],
    ["bassoon", 0.44],
    ["horn", 0.46],
    ["trumpet", 0.38],
    ["trombone", 0.36],
    ["harp", 0.42],
    ["piano", 0.52]
  ],
  drums: [
    ["percussion", 1],
    ["timpani", 0.86],
    ["harp", 0.3],
    ["piano", 0.24]
  ],
  bass: [
    ["basses", 1],
    ["cellos", 0.74],
    ["bassoon", 0.42],
    ["timpani", 0.34],
    ["trombone", 0.24]
  ]
};

const STEM_POSITION_BOUNDS = {
  x: [-3.85, 3.85],
  y: [-0.2, 0.68],
  z: [-5.35, -1.15]
};

const STEM_POSITION_ANCHORS = {
  vocals: {
    x: 0,
    y: 0.24,
    z: -2.35,
    lateralMix: 0.08,
    verticalMix: 0.34,
    depthMix: 0.46,
    maxAbsX: 0.16
  }
};

const STEM_STAGE_LAYOUT = {
  vocals: { left: 50, top: 27 },
  other: { left: 29, top: 35 },
  drums: { left: 71, top: 72 },
  bass: { left: 50, top: 79 }
};

const refs = {
  fileInput: $("#audio-file"),
  dropZone: $("#drop-zone"),
  resetButton: $("#reset-button"),
  themeToggle: $("#theme-toggle"),
  themeToggleText: $("#theme-toggle-text"),
  perfToggle: $("#perf-toggle"),
  perfPanel: $("#perf-panel"),
  perfClose: $("#perf-close"),
  statusText: $("#status-text"),
  toast: $("#toast"),
  analysisProgress: $("#analysis-progress"),
  analysisPhase: $("#analysis-phase"),
  analysisElapsed: $("#analysis-elapsed"),
  analysisProgressTrack: $("#analysis-progress-track"),
  analysisProgressBar: $("#analysis-progress-bar"),
  analysisProgressSteps: Array.from(document.querySelectorAll("[data-analysis-step]")),
  trackKicker: $("#track-kicker"),
  trackName: $("#track-name"),
  trackSubtitle: $("#track-subtitle"),
  playButton: $("#play-button"),
  stopButton: $("#stop-button"),
  exportButton: $("#export-button"),
  seekSlider: $("#seek-slider"),
  currentTime: $("#current-time"),
  totalTime: $("#total-time"),
  modeButtons: Array.from(document.querySelectorAll(".mode-button")),
  playbackDeviceControl: $("#playback-device-control"),
  playbackDeviceSelect: $("#playback-device-select"),
  playbackDeviceCorrection: $("#playback-device-correction"),
  playbackDevicePreamp: $("#playback-device-preamp"),
  playbackDeviceNote: $("#playback-device-note"),
  spatialQualityStatus: $("#spatial-quality-status"),
  spatialQualityDetail: $("#spatial-quality-detail"),
  spatialCacheStatus: $("#spatial-cache-status"),
  spatialCacheDetail: $("#spatial-cache-detail"),
  spatialCacheProgress: $("#spatial-cache-progress"),
  spatialCacheCancel: $("#spatial-cache-cancel"),
  spatialWetValue: $("#spatial-wet-value"),
  spatialRadiusValue: $("#spatial-radius-value"),
  spatialReflectionValue: $("#spatial-reflection-value"),
  sliders: {},
  sliderValues: {},
  metrics: {
    duration: $("#duration-value"),
    sampleRate: $("#sample-rate-value"),
    tempo: $("#tempo-value"),
    tempoNote: $("#tempo-note"),
    key: $("#key-value"),
    keyNote: $("#key-note"),
    loudness: $("#loudness-value"),
    loudnessNote: $("#loudness-note"),
    peak: $("#peak-value"),
    crest: $("#crest-value"),
    centroid: $("#centroid-value"),
    rolloff: $("#rolloff-value")
  },
  activeCount: $("#active-count"),
  frameTime: $("#frame-time"),
  stageMap: $("#stage-map"),
  spectrumCanvas: $("#spectrum-canvas"),
  spectrumStatus: $("#spectrum-status"),
  instrumentList: $("#instrument-list"),
  waveformCanvas: $("#waveform-canvas"),
  waveformTag: $("#waveform-tag"),
  modelTag: $("#model-tag"),
  modelStack: $("#model-stack"),
  sectionList: $("#section-list")
};

refs.perf = {
  fps: $("#perf-fps"),
  frame: $("#perf-frame"),
  meter: $("#perf-meter"),
  waveform: $("#perf-waveform"),
  nodes: $("#perf-nodes"),
  audioLoad: $("#perf-audio-load"),
  heap: $("#perf-heap")
};

const state = {
  file: null,
  analysis: null,
  audioContext: null,
  audioQualityTier: detectAudioQualityTier(),
  runtimeQualityController: null,
  playbackCalibration: null,
  spatialOutputCalibration: null,
  playbackDeviceProfileId: "neutral",
  deviceProfileRevision: 0,
  hrtfLibrary: null,
  hrtfLibraryPromise: null,
  hrtfProfileId: DEFAULT_HRTF_PROFILE_ID,
  brirLibrary: null,
  brirLibraryPromise: null,
  brirProfileId: DEFAULT_BRIR_PROFILE_ID,
  brirBuffers: new Map(),
  spatialQualityProfile: null,
  spatialQaRevision: 0,
  spatialWorkletStatus: "idle",
  spatialWorkletMetrics: null,
  transientMaps: {},
  spatialRenderCache: new Map(),
  spatialRenderCacheStatus: "idle",
  spatialRenderCacheRevision: 0,
  spatialRenderCacheProgress: 0,
  spatialRenderTimer: 0,
  spatialRenderProgressTimer: 0,
  spatialRenderContext: null,
  spatialRenderPromise: null,
  spatialCacheDatabasePromise: null,
  stemAlignmentProfile: null,
  audioBuffer: null,
  stemBuffers: null,
  graph: null,
  displayObjects: null,
  mode: "spatial",
  playing: false,
  startedAt: 0,
  offset: 0,
  animationId: 0,
  analysisController: null,
  analysisRunId: 0,
  analysisTimer: 0,
  analysisCompletionTimer: 0,
  analysisStartedAt: 0,
  retiredGraphs: [],
  meterLevels: {},
  metersZeroed: false,
  fieldLevels: {},
  fieldNodeGroups: {},
  fieldDriftSeeds: {},
  spectrumLevels: Array.from({ length: SPECTRUM_BAR_COUNT }, () => 0),
  spectrumPeaks: Array.from({ length: SPECTRUM_BAR_COUNT }, () => 0),
  spectrumContext: null,
  spectrumRanges: null,
  spectrumRangeKey: "",
  spectrumCache: {
    width: 0,
    height: 0,
    cssWidth: 0,
    cssHeight: 0,
    dpr: 1,
    backgroundKey: "",
    backgroundCanvas: null,
    gradientKey: "",
    gradient: null
  },
  lastSpectrumStatusAt: 0,
  lastSpectrumStatusText: "",
  stemPositionCache: {},
  stemDisplayPositions: {},
  meterRows: {},
  waveformContext: null,
  waveformCache: {
    width: 0,
    height: 0,
    cssWidth: 0,
    cssHeight: 0,
    dpr: 1,
    backgroundKey: "",
    backgroundCanvas: null,
    barsKey: "",
    bars: [],
    gradientKey: "",
    gradient: null
  },
  canvasResizeObserver: null,
  resizeFrame: 0,
  perf: {
    enabled: false,
    fps: 0,
    droppedFrames: 0,
    lastFrameAt: 0,
    lastPanelAt: 0,
    frameMs: [],
    meterMs: [],
    spectrumMs: [],
    waveformMs: [],
    audioLoad: { supported: false, averageLoad: 0, peakLoad: 0, underrunRatio: 0 }
  },
  lastWaveformDrawTime: -1,
  lastMeterFrameTime: -1,
  lastStemDisplayFrameTime: -1,
  lastFieldDisplayFrameTime: -1,
  lastSpectrumFrameTime: -1,
  lastSeekFrameTime: -1,
  lastVisualFrameAt: 0,
  lastLiveAnalysisFrame: null,
  liveOutputLevel: 0,
  liveScores: {},
  hrtfImpulseCache: new Map(),
  compositeDirectionalImpulseCache: new Map(),
  decorrelatorImpulseCache: new Map(),
  measuredBrirBuffer: null,
  measuredBrirPromise: null,
  measuredBrirStatus: "idle",
  universalHrtfProfile: null,
  universalHrtfDataset: null,
  universalHrtfPromise: null,
  universalHrtfStatus: "idle",
  exportInProgress: false,
  spatialSettings: { ...SPATIAL_ENGINE_DEFAULTS },
  spatialAnalysisSummary: {
    openness: 0,
    dynamics: 0,
    density: 0
  }
};

init();

function init() {
  applyStoredTheme();
  initializePlaybackDeviceControl();
  initializeHrtfProfileControl().catch((error) => {
    console.warn("Measured HRTF library is unavailable; using the parametric fallback.", error);
  });
  initializeBrirProfileControl().catch((error) => {
    console.warn("BRIR library is unavailable; using the early-reflection fallback.", error);
    showBrirProfileFallback();
  });
  syncFieldModeState();

  refs.fileInput.addEventListener("change", () => {
    const file = refs.fileInput.files && refs.fileInput.files[0];
    if (file) analyzeFile(file);
  });
  refs.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    refs.dropZone.classList.add("is-dragging");
  });
  refs.dropZone.addEventListener("dragleave", () => refs.dropZone.classList.remove("is-dragging"));
  refs.dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    refs.dropZone.classList.remove("is-dragging");
    const file = event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) analyzeFile(file);
  });

  refs.resetButton.addEventListener("click", resetApp);
  refs.themeToggle.addEventListener("click", toggleTheme);
  refs.perfToggle?.addEventListener("click", () => setPerfPanelEnabled(!state.perf.enabled));
  refs.perfClose?.addEventListener("click", () => setPerfPanelEnabled(false));
  refs.playButton.addEventListener("click", togglePlayback);
  refs.stopButton.addEventListener("click", stopPlayback);
  refs.exportButton.addEventListener("click", exportFullSpatialWav);
  refs.seekSlider.addEventListener("input", seekToSlider);
  refs.playbackDeviceSelect?.addEventListener("change", handlePlaybackDeviceChange);
  refs.spatialCacheCancel?.addEventListener("click", cancelSpatialRenderCache);
  document.addEventListener("keydown", handlePlaybackShortcut);

  refs.modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const nextMode = button.dataset.mode;
      if (!nextMode || nextMode === state.mode) return;
      state.mode = nextMode;
      const time = getPlaybackTime();
      refs.modeButtons.forEach((item) => item.classList.toggle("is-active", item === button));
      syncFieldModeState();
      if (state.mode === "original") {
        setRealtimeMetersToZero(time);
      }
      if (!state.playing) {
        if (state.mode === "original") {
          setRealtimeMetersToZero(state.offset);
        } else {
          updateRealtimeDisplay(state.offset);
          updateSoundFieldDisplay(state.offset, readSoundFieldScores(state.offset));
        }
        updateSpectrumDisplay(state.offset, { zero: true });
      }
      if (state.playing) {
        crossfadePlaybackMode(time).catch((error) => {
          console.error(error);
          stopPlayback({ keepOffset: true, silent: true });
          state.offset = time;
          startPlayback();
        });
      }
    });
  });

  drawEmptyWaveform();
  drawSpectrumGraph(state.spectrumLevels, { zero: true, force: true });
  setupCanvasResizeObserver();
  updateSpatialControlUi();
}

function getPlaybackDeviceProfile(profileId = state.playbackDeviceProfileId) {
  const registry = window.SpatialAudioDeviceProfiles;
  return registry?.byId?.[profileId] || registry?.byId?.[registry.defaultId] || {
    id: "neutral",
    shortLabel: "Neutral output",
    kind: "headphones",
    renderer: "binaural",
    preampDb: 0,
    wetScale: 1,
    lateralScale: 1,
    filters: [],
    note: "No playback-device EQ."
  };
}

function initializePlaybackDeviceControl() {
  const registry = window.SpatialAudioDeviceProfiles;
  const profiles = Array.isArray(registry?.profiles) ? registry.profiles : [];
  let stored = "";
  try {
    stored = localStorage.getItem("spatial-audio-essential-playback-device") || "";
  } catch {
    stored = "";
  }
  state.playbackDeviceProfileId = registry?.byId?.[stored] ? stored : (registry?.defaultId || "neutral");
  if (refs.playbackDeviceSelect) {
    refs.playbackDeviceSelect.replaceChildren(...profiles.map((profile) => {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.label;
      return option;
    }));
    refs.playbackDeviceSelect.value = state.playbackDeviceProfileId;
  }
  updatePlaybackDeviceUi();
}

async function handlePlaybackDeviceChange() {
  const nextId = refs.playbackDeviceSelect?.value;
  if (!nextId || !window.SpatialAudioDeviceProfiles?.byId?.[nextId]) return;
  const wasPlaying = state.playing;
  const revision = ++state.deviceProfileRevision;
  state.playbackDeviceProfileId = nextId;
  state.spatialOutputCalibration = null;
  state.hrtfImpulseCache.clear();
  state.compositeDirectionalImpulseCache.clear();
  invalidateSpatialRenderCache();
  try {
    localStorage.setItem("spatial-audio-essential-playback-device", nextId);
  } catch {
    // 브라우저 저장소가 차단되어도 현재 세션의 선택값은 그대로 유지한다.
  }
  updateSpatialControlUi();
  if (state.audioBuffer && state.analysis && state.mode === "spatial") {
    state.spatialOutputCalibration = await calibrateSpatialProcessedOutput(state.audioBuffer, state.analysis);
    if (revision !== state.deviceProfileRevision) return;
  }
  if (wasPlaying && state.audioBuffer && state.analysis && state.mode === "spatial") {
    await crossfadePlaybackMode(getPlaybackTime());
  }
  queueSpatialRenderCache();
  queueSpatialImpulseQa();
  const profile = getPlaybackDeviceProfile();
  showToast(state.mode === "original"
    ? `${profile.shortLabel} saved · Full Spatial only`
    : `${profile.shortLabel} correction active · ${profile.renderer === "stereo-speaker" ? "speaker-safe stereo" : "binaural HRTF"}`);
}

function updatePlaybackDeviceUi() {
  const profile = getPlaybackDeviceProfile();
  if (refs.playbackDeviceSelect && refs.playbackDeviceSelect.value !== profile.id) {
    refs.playbackDeviceSelect.value = profile.id;
  }
  if (refs.playbackDeviceControl) refs.playbackDeviceControl.dataset.kind = profile.kind;
  setText(refs.playbackDeviceCorrection, profile.shortLabel);
  setText(refs.playbackDevicePreamp, `Original level match · ${profile.filters.length} filters`);
  setText(refs.playbackDeviceNote, profile.note);
}

async function ensureHrtfLibrary() {
  if (state.hrtfLibrary) return state.hrtfLibrary;
  if (state.hrtfLibraryPromise) return state.hrtfLibraryPromise;
  state.hrtfLibraryPromise = (async () => {
    const response = await fetch(apiPath(HRTF_LIBRARY_URL), { cache: "force-cache" });
    if (!response.ok) throw new Error(`HRTF library HTTP ${response.status}`);
    const library = await response.json();
    if (
      library?.schema !== "SpatialAudioEssential.HRTFLibrary/1.0" ||
      !Array.isArray(library.profiles) ||
      !library.profiles.length
    ) {
      throw new Error("HRTF library registry is invalid");
    }
    state.hrtfLibrary = Object.freeze({
      ...library,
      profiles: Object.freeze(library.profiles.map((profile) => Object.freeze({ ...profile })))
    });
    return state.hrtfLibrary;
  })().finally(() => {
    state.hrtfLibraryPromise = null;
  });
  return state.hrtfLibraryPromise;
}

function getHrtfLibraryEntry(profileId = state.hrtfProfileId) {
  const profiles = state.hrtfLibrary?.profiles || [];
  return profiles.find((profile) => profile.id === profileId) ||
    profiles.find((profile) => profile.id === state.hrtfLibrary?.defaultId) ||
    profiles[0] || null;
}

async function initializeHrtfProfileControl() {
  const library = await ensureHrtfLibrary();
  // 개인 측정값이 없는 기본 환경에서는 가장 보편적인 KEMAR 프로파일을 자동 적용한다.
  state.hrtfProfileId = library.profiles.some((profile) => profile.id === DEFAULT_HRTF_PROFILE_ID)
    ? DEFAULT_HRTF_PROFILE_ID
    : (library.defaultId || library.profiles[0].id);
  await ensureUniversalHrtfProfile();
}

async function ensureBrirLibrary() {
  if (state.brirLibrary) return state.brirLibrary;
  if (state.brirLibraryPromise) return state.brirLibraryPromise;
  state.brirLibraryPromise = (async () => {
    const response = await fetch(apiPath(BRIR_LIBRARY_URL), { cache: "force-cache" });
    if (!response.ok) throw new Error(`BRIR library HTTP ${response.status}`);
    const library = await response.json();
    if (library?.schema !== "SpatialAudioEssential.BRIRLibrary/2.0" || !Array.isArray(library.profiles)) {
      throw new Error("BRIR library registry is invalid");
    }
    state.brirLibrary = Object.freeze({
      ...library,
      profiles: Object.freeze(library.profiles.map((profile) => Object.freeze({ ...profile })))
    });
    return state.brirLibrary;
  })().finally(() => {
    state.brirLibraryPromise = null;
  });
  return state.brirLibraryPromise;
}

function getBrirLibraryEntry(profileId = state.brirProfileId) {
  const profiles = state.brirLibrary?.profiles || [];
  return profiles.find((profile) => profile.id === profileId) ||
    profiles.find((profile) => profile.id === state.brirLibrary?.defaultId) || profiles[0] || null;
}

async function initializeBrirProfileControl() {
  const library = await ensureBrirLibrary();
  // 프로젝트가 지향하는 대형 오케스트라 공간을 별도 선택 없이 자동 적용한다.
  state.brirProfileId = library.profiles.some((profile) => profile.id === DEFAULT_BRIR_PROFILE_ID)
    ? DEFAULT_BRIR_PROFILE_ID
    : (library.defaultId || library.profiles[0].id);
}

function showBrirProfileFallback() {
  state.brirLibrary = null;
  state.brirProfileId = DEFAULT_BRIR_PROFILE_ID;
}

function openHrtfWizard() {
  if (!refs.hrtfWizard || !state.hrtfLibrary?.profiles?.length) return;
  if (getPlaybackDeviceProfile().renderer === "stereo-speaker") {
    showToast("HRTF 청감 테스트는 이어폰 또는 헤드폰 출력에서 사용할 수 있습니다.");
    return;
  }
  if (state.playing) stopPlayback({ keepOffset: true, silent: true });
  const candidates = shuffleListenerTestCandidates(state.hrtfLibrary.profiles);
  const firstRound = candidates.map((candidate, index) => ({
    a: candidate,
    b: candidates[(index + 1) % candidates.length],
    repeat: 0
  }));
  const secondRound = firstRound.map((trial) => ({ a: trial.b, b: trial.a, repeat: 1 }));
  state.hrtfWizard = {
    trialIndex: 0,
    candidates,
    trials: [...firstRound, ...secondRound],
    activeChoice: "a",
    wins: Object.fromEntries(candidates.map((candidate) => [candidate.id, 0])),
    outcomes: [],
    trialAuditions: { a: false, b: false },
    activeSource: null,
    originalProfileId: state.hrtfProfileId,
    completed: false,
    activationRevision: 0
  };
  refs.hrtfWizard.showModal();
  activateHrtfWizardTrial().catch(console.error);
}

function shuffleListenerTestCandidates(profiles) {
  const result = [...profiles];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

async function activateHrtfWizardTrial() {
  const trial = state.hrtfWizard.trials[state.hrtfWizard.trialIndex];
  if (!trial) return;
  state.hrtfWizard.activeChoice = "a";
  state.hrtfWizard.trialAuditions = { a: false, b: false };
  refs.hrtfCandidateButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.hrtfCandidate === "a"));
  setText(refs.hrtfWizardProgress, `비교 ${state.hrtfWizard.trialIndex + 1} / ${state.hrtfWizard.trials.length}`);
  setText(refs.hrtfWizardInstruction, "A와 B에서 같은 네 방향을 들어보세요. 후보 순서는 무작위이며 같은 조합이 좌우를 바꿔 한 번 더 나옵니다.");
  document.querySelectorAll('input[name="hrtf-score"]').forEach((input) => { input.checked = false; });
  await activateHrtfWizardCandidate("a");
}

async function selectHrtfWizardCandidate(choice) {
  if (!refs.hrtfWizard?.open || !["a", "b"].includes(choice)) return;
  state.hrtfWizard.activeChoice = choice;
  refs.hrtfCandidateButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.hrtfCandidate === choice));
  await activateHrtfWizardCandidate(choice);
}

async function activateHrtfWizardCandidate(choice = state.hrtfWizard.activeChoice) {
  const trial = state.hrtfWizard.trials[state.hrtfWizard.trialIndex];
  const candidate = trial?.[choice];
  if (!candidate) return;
  const revision = ++state.hrtfWizard.activationRevision;
  state.hrtfProfileId = candidate.id;
  state.universalHrtfProfile = null;
  state.universalHrtfDataset = null;
  state.universalHrtfStatus = "idle";
  state.hrtfImpulseCache.clear();
  state.compositeDirectionalImpulseCache.clear();
  await ensureUniversalHrtfProfile();
  if (revision !== state.hrtfWizard.activationRevision) return;
}

async function auditionHrtfDirection(directionId) {
  if (!refs.hrtfWizard?.open) return;
  const positions = {
    front: { azimuth: 0, elevation: 6, distance: 2.5 },
    left: { azimuth: -82, elevation: 4, distance: 2.5 },
    rear: { azimuth: 168, elevation: 7, distance: 2.5 },
    height: { azimuth: 18, elevation: 68, distance: 2.5 }
  };
  const context = await ensureAudioContext();
  const buffer = createHrtfAuditionBuffer(context, directionId, state.hrtfWizard.trialIndex);
  try { state.hrtfWizard.activeSource?.stop(); } catch { /* 이미 종료된 소스 */ }
  const source = context.createBufferSource();
  const output = context.createGain();
  const renderer = createReferenceHrtfRenderer(context, positions[directionId] || positions.front, {
    role: "listener-test",
    seed: state.hrtfWizard.trialIndex * 17 + 911
  });
  source.buffer = buffer;
  output.gain.value = 0.72;
  source.connect(renderer.node).connect(output).connect(context.destination);
  source.onended = () => {
    try { source.disconnect(); renderer.node.disconnect(); output.disconnect(); } catch { /* 정리 완료 */ }
  };
  state.hrtfWizard.activeSource = source;
  state.hrtfWizard.trialAuditions[state.hrtfWizard.activeChoice] = true;
  source.start();
}

function createHrtfAuditionBuffer(context, directionId, trialIndex) {
  const length = Math.round(context.sampleRate * 0.82);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  const directionSeed = { front: 11, left: 23, rear: 37, height: 53 }[directionId] || 11;
  let seed = (trialIndex + 1) * 7919 + directionSeed;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  let filtered = 0;
  const stimulus = trialIndex % 3;
  for (let index = 0; index < length; index += 1) {
    const time = index / context.sampleRate;
    const envelope = Math.sin(Math.PI * index / Math.max(1, length - 1)) ** 2;
    if (stimulus === 0) {
      filtered = filtered * 0.72 + (random() * 2 - 1) * 0.28;
      data[index] = filtered * envelope * 0.3;
    } else if (stimulus === 1) {
      data[index] = (
        Math.sin(2 * Math.PI * 180 * time) * 0.18 +
        Math.sin(2 * Math.PI * 540 * time) * 0.09 +
        Math.sin(2 * Math.PI * 1260 * time) * 0.05
      ) * envelope;
    } else {
      const clickPhase = (time * 7) % 1;
      data[index] = (random() * 2 - 1) * Math.exp(-clickPhase * 45) * envelope * 0.35;
    }
  }
  return buffer;
}

async function advanceHrtfWizard(choice) {
  const selected = document.querySelector('input[name="hrtf-score"]:checked');
  if (!selected) {
    showToast("현재 후보의 자연스러움을 1~5점으로 평가해 주세요.");
    return;
  }
  if (!state.hrtfWizard.trialAuditions.a || !state.hrtfWizard.trialAuditions.b) {
    showToast("공정한 비교를 위해 후보 A와 B를 모두 한 번 이상 들어주세요.");
    return;
  }
  const trial = state.hrtfWizard.trials[state.hrtfWizard.trialIndex];
  const winner = trial[choice];
  const confidence = Number(selected.value);
  state.hrtfWizard.wins[winner.id] += confidence;
  state.hrtfWizard.outcomes.push({
    pair: [trial.a.id, trial.b.id].sort(),
    winnerId: winner.id,
    confidence,
    repeat: trial.repeat
  });
  state.hrtfWizard.trialIndex += 1;
  if (state.hrtfWizard.trialIndex < state.hrtfWizard.trials.length) {
    await activateHrtfWizardTrial();
    return;
  }
  const best = state.hrtfWizard.candidates.reduce((winner, item) => {
    const score = state.hrtfWizard.wins[item.id] || 0;
    const winnerScore = state.hrtfWizard.wins[winner.id] || 0;
    return score > winnerScore ? item : winner;
  }, state.hrtfWizard.candidates[0]);
  const consistency = calculateHrtfWizardConsistency(state.hrtfWizard.outcomes);
  try {
    localStorage.setItem(HRTF_WIZARD_STORAGE_KEY, JSON.stringify({
      profileId: best.id,
      scores: state.hrtfWizard.wins,
      consistency,
      outcomes: state.hrtfWizard.outcomes,
      completedAt: new Date().toISOString()
    }));
  } catch {
    // 결과 저장 실패는 선택 적용을 막지 않는다.
  }
  state.hrtfWizard.completed = true;
  refs.hrtfWizard.close();
  refs.hrtfProfileSelect.value = best.id;
  await handleHrtfProfileChange();
  showToast(`청감 테스트 결과: ${best.label} · 반복 일치도 ${Math.round(consistency * 100)}%`);
}

function calculateHrtfWizardConsistency(outcomes) {
  const groups = new Map();
  outcomes.forEach((outcome) => {
    const key = outcome.pair.join(":");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(outcome.winnerId);
  });
  const repeated = [...groups.values()].filter((values) => values.length >= 2);
  if (!repeated.length) return 0;
  return repeated.filter((values) => values.every((value) => value === values[0])).length / repeated.length;
}

function handleHrtfWizardClose() {
  try { state.hrtfWizard.activeSource?.stop(); } catch { /* 이미 종료된 소스 */ }
  if (state.hrtfWizard.completed) return;
  const originalId = state.hrtfWizard.originalProfileId;
  if (!originalId || originalId === state.hrtfProfileId || !refs.hrtfProfileSelect) return;
  refs.hrtfProfileSelect.value = originalId;
  handleHrtfProfileChange().catch(console.error);
}

function handlePlaybackShortcut(event) {
  if (
    event.code === "Escape" &&
    !event.repeat &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    state.playing
  ) {
    event.preventDefault();
    stopPlayback();
    return;
  }
  if (
    event.code !== "Space" ||
    event.repeat ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return;
  }
  if (!state.audioBuffer || !state.analysis) return;
  event.preventDefault();
  event.stopPropagation();
  togglePlayback().catch((error) => {
    console.error(error);
    showToast("재생 상태를 전환하지 못했습니다.");
  });
}

function syncFieldModeState() {
  refs.stageMap.dataset.mode = state.mode;
  document.body.dataset.playbackMode = state.mode;
  updateSpatialControlUi();
}

function updateSpatialControlUi() {
  const settings = state.spatialSettings;
  setText(refs.spatialWetValue, `${Math.round(settings.wet * 100)}%`);
  setText(refs.spatialRadiusValue, `${Math.round(settings.radius * 100)}%`);
  setText(refs.spatialReflectionValue, `${Math.round(settings.reflections * 100)}%`);
  updatePlaybackDeviceUi();
  updateSpatialQualityUi();
  updateSpatialRenderCacheUi();
}

function updateSpatialSettingsFromAnalysis(analysis) {
  const mix = analysis?.mix || {};
  const stereo = analysis?.stereoImage || {};
  const sections = Array.isArray(analysis?.sections) ? analysis.sections : [];
  const activeCount = Array.isArray(analysis?.activeIds) ? analysis.activeIds.length : 0;
  const sectionEnergy = sections.length
    ? sections.reduce((sum, section) => sum + (Number(section.energy) || 0), 0) / sections.length
    : clamp(((Number(mix.rmsDb) || -24) + 42) / 30, 0, 1);
  const density = sections.length
    ? sections.reduce((sum, section) => sum + (Number(section.density) || 0), 0) / sections.length
    : clamp(activeCount / 10, 0, 1);
  const brightness = clamp(((Number(mix.centroidHz) || 1200) - 420) / 5200, 0, 1);
  const dynamics = clamp(((Number(mix.crestDb) || 12) - 7) / 15, 0, 1);
  const stereoWidth = clamp(Number(stereo.width) || 0, 0, 1);
  const openness = clamp(brightness * 0.38 + stereoWidth * 0.34 + dynamics * 0.16 + sectionEnergy * 0.12, 0, 1);
  const lowWeight = clamp(1 - brightness * 0.64 + Math.max(0, 5 - activeCount) * 0.035, 0, 1);

  state.spatialAnalysisSummary = { openness, dynamics, density };
  state.spatialSettings = {
    wet: clamp(0.66 + openness * 0.14 + dynamics * 0.045 - lowWeight * 0.008, 0.64, 0.82),
    radius: clamp(1.08 + openness * 0.06 + stereoWidth * 0.04 + density * 0.025, 1.06, 1.18),
    reflections: clamp(0.46 + density * 0.14 + sectionEnergy * 0.08 + brightness * 0.04, 0.44, 0.72)
  };
  updateSpatialControlUi();
}

function analyzeSpatialQualityInputs(audioBuffer) {
  const quality = window.SpatialAudioQuality;
  if (!quality || !audioBuffer) return;
  const coherence = quality.analyzeMultibandCoherence(audioBuffer);
  const safety = quality.buildSafetyProfile(coherence);
  const transientMaps = {
    mix: quality.analyzeTransientMap(audioBuffer)
  };
  Object.values(state.stemBuffers || {}).forEach((stem) => {
    if (stem?.buffer) transientMaps[stem.id] = quality.analyzeTransientMap(stem.buffer);
  });
  state.transientMaps = transientMaps;
  state.spatialQualityProfile = {
    coherence,
    ...safety,
    objectiveQa: null
  };
  updateSpatialQualityUi();
}

function updateSpatialQualityUi() {
  const profile = state.spatialQualityProfile;
  const qa = profile?.objectiveQa;
  if (!profile) {
    setText(refs.spatialQualityStatus, "대기");
    setText(refs.spatialQualityDetail, "IACC · balance · level");
    return;
  }
  const average = Number(profile.coherence?.averageCorrelation);
  if (!qa) {
    setText(refs.spatialQualityStatus, profile.qaStatus === "measuring" ? "임펄스 측정 중" : "입력 분석 완료");
    setText(refs.spatialQualityDetail, `대역 상관도 ${Number.isFinite(average) ? average.toFixed(2) : "--"}`);
    return;
  }
  const status = qa.status === "pass" ? "통과" : "자동 제한 적용";
  setText(refs.spatialQualityStatus, status);
  setText(
    refs.spatialQualityDetail,
    `IACC80 ${qa.iacc80.toFixed(2)} · C80 ${qa.c80Db.toFixed(1)} dB · EDT ${qa.edtSeconds.toFixed(2)} s`
  );
}

function resetLiveAnalysisCache() {
  state.lastLiveAnalysisFrame = null;
  state.liveOutputLevel = 0;
}

function getRuntimeQualityProfile() {
  return RUNTIME_QUALITY_PROFILE;
}

function detectAudioQualityTier() {
  const cores = Number(navigator.hardwareConcurrency) || 4;
  const memory = Number(navigator.deviceMemory) || 8;
  if (cores <= 2 || memory <= 2) return "safe";
  if (cores <= 4 || memory <= 4) return "balanced";
  return "full";
}

function getAudioQualityProfile() {
  return AUDIO_QUALITY_PROFILES[state.audioQualityTier] || AUDIO_QUALITY_PROFILES.balanced;
}

function selectSymmetricDirectionPairs(directions, pairLimit) {
  const safeLimit = Math.max(1, Math.floor(pairLimit || 1));
  return directions.slice(0, safeLimit * 2);
}

function resetRuntimeQualityState() {
  state.perf.lastFrameAt = 0;
}

async function analyzeFile(file) {
  const validationMessage = validateLocalAudioFile(file);
  if (validationMessage) {
    showToast(validationMessage);
    return;
  }
  if (state.analysisController) {
    state.analysisController.abort();
  }
  const controller = new AbortController();
  const runId = state.analysisRunId + 1;
  state.analysisRunId = runId;
  state.analysisController = controller;

  stopPlayback();
  state.file = file;
  state.analysis = null;
  state.audioBuffer = null;
  state.stemBuffers = null;
  state.playbackCalibration = null;
  state.spatialOutputCalibration = null;
  state.spatialQualityProfile = null;
  state.transientMaps = {};
  invalidateSpatialRenderCache();
  state.stemAlignmentProfile = null;
  state.displayObjects = null;
  state.liveScores = {};
  state.meterLevels = {};
  state.metersZeroed = false;
  state.fieldLevels = {};
  state.fieldNodeGroups = {};
  state.fieldDriftSeeds = {};
  resetSpectrumState();
  state.stemPositionCache = {};
  state.stemDisplayPositions = {};
  state.meterRows = {};
  resetWaveformCache();
  state.lastWaveformDrawTime = -1;
  state.lastMeterFrameTime = -1;
  state.lastStemDisplayFrameTime = -1;
  state.lastFieldDisplayFrameTime = -1;
  state.lastSpectrumFrameTime = -1;
  state.lastSeekFrameTime = -1;
  state.lastVisualFrameAt = 0;
  resetLiveAnalysisCache();
  startAnalysisProgress();
  setAnalysisPhase("upload", "오디오 업로드 및 디코딩 준비 중");
  setBusy(true, "Demucs stem 분리 및 원본 분석 중");
  setText(refs.trackKicker, "ANALYZING");
  refs.trackName.textContent = file.name;
  setText(refs.trackSubtitle, `${formatBytes(file.size)} · 로컬 AI 분석 준비 중`);
  refs.playButton.disabled = true;
  refs.stopButton.disabled = true;
  refs.seekSlider.disabled = true;

  try {
    const context = await ensureAudioContext();
    const measuredBrirPromise = ensureMeasuredBrirBuffer(context);
    const universalHrtfPromise = ensureUniversalHrtfProfile();
    resetRuntimeQualityState();
    const decodePromise = decodeBrowserAudioFile(file, context);
    setAnalysisPhase("separate", "특성 분석 및 Demucs stem 분리 중");
    const analyzePromise = postAudioForAnalysis(file, controller.signal);
    const [decodeResult, analysisResult] = await Promise.allSettled([
      decodePromise,
      analyzePromise
    ]);

    if (analysisResult.status === "rejected") {
      throw analysisResult.reason;
    }
    if (controller.signal.aborted || runId !== state.analysisRunId) return;

    const analysis = analysisResult.value;
    const audioBuffer = decodeResult.status === "fulfilled" ? decodeResult.value : null;
    const browserDecodeError = decodeResult.status === "rejected" ? decodeResult.reason : null;

    state.audioBuffer = audioBuffer;
    state.analysis = analysis;
    state.playbackCalibration = audioBuffer ? analyzeAudioBufferCalibration(audioBuffer) : null;
    updateSpatialSettingsFromAnalysis(analysis);
    setAnalysisPhase("decode", "분석 결과와 stem 오디오 정합성 확인 중");
    const separator = analysis.models.deepSeparator;
    if (separator.status === "completed" && audioBuffer) {
      setBusy(true, separator.cached ? "캐시된 stem 디코딩 중" : "분리된 stem 디코딩 중");
      state.stemBuffers = await loadStemBuffers(context, analysis, audioBuffer);
    }
    if (audioBuffer) analyzeSpatialQualityInputs(audioBuffer);
    // 무거운 HRTF/BRIR 검증과 오프라인 보정 중에도 분석 결과를 먼저 표시한다.
    renderAnalysis(analysis);
    document.body.classList.add("has-analysis");
    refs.playButton.disabled = !audioBuffer;
    refs.stopButton.disabled = !audioBuffer;
    refs.seekSlider.disabled = !audioBuffer;
    await Promise.all([measuredBrirPromise, universalHrtfPromise]);
    if (controller.signal.aborted || runId !== state.analysisRunId) return;
    setAnalysisPhase("render", "공간 오디오 그래프와 시각화 준비 중");
    if (audioBuffer) {
      state.spatialOutputCalibration = await calibrateSpatialProcessedOutput(audioBuffer, analysis, { fast: true });
      if (state.spatialOutputCalibration?.objectiveQa) {
        state.spatialQualityProfile = {
          ...(state.spatialQualityProfile || {}),
          objectiveQa: state.spatialOutputCalibration.objectiveQa
        };
      }
    }
    if (controller.signal.aborted || runId !== state.analysisRunId) return;
    setBusy(true, "재설계용 원본 출력 경로 준비 중");
    state.offset = 0;
    renderAnalysis(analysis);
    updateSpatialQualityUi();
    queueSpatialRenderCache();
    queueSpatialImpulseQa();
    refs.playButton.disabled = !audioBuffer;
    refs.stopButton.disabled = !audioBuffer;
    refs.exportButton.disabled = !audioBuffer;
    refs.seekSlider.disabled = !audioBuffer;
    document.body.classList.add("has-analysis");
    if (browserDecodeError) {
      setBusy(false, "분석 완료 · 브라우저 디코딩 불가");
      finishAnalysisProgress(false, "분석 완료 · 재생 디코딩 불가");
      showToast(getBrowserDecodeMessage(file, browserDecodeError));
      return;
    }
    setBusy(false, state.stemBuffers
      ? (separator.cached ? "캐시 기반 분석 준비 완료" : "Demucs 분석 준비 완료")
      : "원본 분석 완료");
    finishAnalysisProgress(true, state.stemBuffers ? "Demucs Spatial 준비 완료" : "Full-mix fallback 준비 완료");
    showToast(state.stemBuffers
      ? (separator.cached ? "캐시된 stem 분석 준비가 완료됐습니다." : "Demucs stem 분석 준비가 완료됐습니다.")
      : "원본 기준선 분석이 완료됐습니다.");
  } catch (error) {
    if (error && error.name === "AbortError") return;
    console.error(error);
    setBusy(false, getAnalysisFailureStatus(error));
    finishAnalysisProgress(false, "분석을 완료하지 못했습니다");
    showToast(error.message || "분석 중 오류가 발생했습니다.");
  } finally {
    if (state.analysisController === controller) {
      state.analysisController = null;
    }
  }
}

function validateLocalAudioFile(file) {
  if (!file || !Number.isFinite(file.size) || file.size <= 0) {
    return "내용이 있는 오디오 파일을 선택하세요.";
  }
  if (file.size > MAX_AUDIO_FILE_BYTES) {
    return `오디오 파일은 최대 ${formatBytes(MAX_AUDIO_FILE_BYTES)}까지 분석할 수 있습니다.`;
  }
  const extension = String(file.name || "").split(".").pop().toLowerCase();
  const isAudioMime = String(file.type || "").toLowerCase().startsWith("audio/");
  if (!SUPPORTED_AUDIO_EXTENSIONS.has(extension) && !isAudioMime) {
    return "MP3, WAV, FLAC, M4A, AAC, OGG, OPUS 또는 WEBM 오디오를 선택하세요.";
  }
  return "";
}

async function decodeBrowserAudioFile(file, context) {
  try {
    const buffer = await file.arrayBuffer();
    const decoded = await context.decodeAudioData(buffer.slice(0));
    if (decoded.numberOfChannels !== 1 && decoded.numberOfChannels !== 2) {
      throw new Error(`Full Spatial은 mono/stereo 입력만 지원합니다 (${decoded.numberOfChannels}채널 감지)`);
    }
    return decoded;
  } catch (error) {
    const wrapped = new Error(error && error.message ? error.message : "Unable to decode audio data");
    wrapped.cause = error;
    throw wrapped;
  }
}

function analyzeAudioBufferCalibration(buffer, analysis = state.analysis) {
  const mix = analysis?.mix || {};
  const estimatedTruePeakDb = Number(mix.estimatedTruePeakDb);
  const samplePeakDb = Number(mix.peakDb);
  const integratedLufs = Number(mix.integratedLufs);
  const approxLufs = Number(mix.approxLufs);
  return {
    estimatedTruePeakDb: Number.isFinite(estimatedTruePeakDb)
      ? estimatedTruePeakDb
      : (Number.isFinite(samplePeakDb) ? samplePeakDb : -6),
    approxLufs: Number.isFinite(integratedLufs) ? integratedLufs : (Number.isFinite(approxLufs) ? approxLufs : -18),
    sampleRate: buffer?.sampleRate || Number(mix.sampleRate) || 48000
  };
}

async function calibrateSpatialProcessedOutput(buffer, analysis = state.analysis, options = {}) {
  const OfflineContext = window.OfflineAudioContext;
  if (!OfflineContext || !buffer || buffer.duration <= 0) return null;
  const previewSeconds = Math.min(2, buffer.duration);
  const tailSeconds = hasMeasuredBrirLibrary() ? 0.9 : 0.45;
  const sampleRate = buffer.sampleRate;
  const renderFrames = Math.max(1, Math.ceil((previewSeconds + tailSeconds) * sampleRate));
  const previewOffsets = getSpatialCalibrationOffsets(
    analysis,
    buffer.duration,
    previewSeconds,
    options.fast === true ? 2 : 4
  );
  const calibrationProfileId = state.playbackDeviceProfileId;
  const previousCalibration = state.spatialOutputCalibration;
  const renderPreview = async (calibration, previewOffset) => {
    let graph = null;
    const previousProfileId = state.playbackDeviceProfileId;
    try {
      const context = new OfflineContext(2, renderFrames, sampleRate);
      state.playbackDeviceProfileId = calibrationProfileId;
      state.spatialOutputCalibration = calibration;
      graph = createSpatialPlaybackGraph(context, buffer, analysis);
      state.playbackDeviceProfileId = previousProfileId;
      state.spatialOutputCalibration = previousCalibration;
      startGraphSources(graph, previewOffset);
      return await context.startRendering();
    } finally {
      state.playbackDeviceProfileId = previousProfileId;
      state.spatialOutputCalibration = previousCalibration;
      if (graph) disconnectGraph(graph);
    }
  };
  try {
    const firstRenders = [];
    for (const previewOffset of previewOffsets) {
      const rendered = await renderPreview(null, previewOffset);
      firstRenders.push({
        rendered,
        calibration: analyzeRenderedSpatialCalibration(rendered, buffer, previewOffset, previewSeconds)
      });
    }
    const firstPass = aggregateSpatialCalibrationResults(firstRenders.map((item) => item.calibration));
    if (!firstPass) return null;
    if (options.fast === true) {
      return {
        ...firstPass,
        objectiveQa: null,
        calibrationDomain: "representative-program-windows",
        calibrationOffsets: previewOffsets
      };
    }
    // 공간 DSP와 기기 보정을 적용한 실제 출력의 여러 대표 구간을 다시 측정한다.
    const initialCalibration = { gain: firstPass.gain, widthScale: firstPass.widthScale };
    const validationRenders = [];
    for (const previewOffset of previewOffsets) {
      const rendered = await renderPreview(initialCalibration, previewOffset);
      validationRenders.push({
        rendered,
        calibration: analyzeRenderedSpatialCalibration(rendered, buffer, previewOffset, previewSeconds),
        response: window.SpatialAudioQuality?.analyzeBinauralResponse(rendered) || null
      });
    }
    const validation = aggregateSpatialCalibrationResults(validationRenders.map((item) => item.calibration));
    if (!validation) return firstPass;
    const validationLevelErrorDb = getWorstCalibrationLevelErrorDb(
      validationRenders.map((item) => item.calibration)
    );
    const finalGain = clamp(firstPass.gain * validation.rmsMatchGain, 0.5, 4.5);
    const busLimits = deriveSpatialQaBusLimits(
      validationRenders.map((item) => item.calibration)
    );

    // 문제가 검출된 경우에만 원음 경로가 아닌 공간 버스를 한 차례 제한해 재검증한다.
    let finalRenders = validationRenders;
    let finalValidation = validation;
    let appliedGain = finalGain;
    if (busLimits.limited) {
      finalRenders = [];
      const limitedCalibration = {
        gain: finalGain,
        widthScale: firstPass.widthScale,
        roomScale: busLimits.roomScale,
        lateralScale: busLimits.lateralScale
      };
      for (const previewOffset of previewOffsets) {
        const rendered = await renderPreview(limitedCalibration, previewOffset);
        finalRenders.push({
          rendered,
          calibration: analyzeRenderedSpatialCalibration(rendered, buffer, previewOffset, previewSeconds),
          response: window.SpatialAudioQuality?.analyzeBinauralResponse(rendered) || null
        });
      }
      finalValidation = aggregateSpatialCalibrationResults(finalRenders.map((item) => item.calibration)) || validation;
      appliedGain = clamp(finalGain * finalValidation.rmsMatchGain, 0.5, 4.5);
    }
    const objectiveQa = buildSpatialProgramObjectiveQa(finalRenders, busLimits);
    return {
      ...finalValidation,
      gain: appliedGain,
      widthScale: firstPass.widthScale,
      roomScale: busLimits.roomScale,
      lateralScale: busLimits.lateralScale,
      firstPassGain: firstPass.gain,
      validationGain: finalValidation.rmsMatchGain,
      validationLevelErrorDb,
      objectiveQa,
      calibrationDomain: "representative-program-windows",
      calibrationOffsets: previewOffsets,
      qaLimited: busLimits.limited,
      qaLimitReasons: busLimits.reasons
    };
  } catch (error) {
    console.warn("Processed Spatial output calibration is unavailable; using predictive headroom.", error);
    return null;
  } finally {
    state.spatialOutputCalibration = previousCalibration;
  }
}

function queueSpatialImpulseQa() {
  if (!state.audioBuffer || !state.analysis || !window.OfflineAudioContext) return;
  const revision = ++state.spatialQaRevision;
  state.spatialQualityProfile = {
    ...(state.spatialQualityProfile || {}),
    objectiveQa: null,
    qaStatus: "measuring"
  };
  updateSpatialQualityUi();
  window.setTimeout(() => {
    renderSpatialImpulseQa(revision).catch((error) => {
      if (revision !== state.spatialQaRevision) return;
      console.warn("Impulse-domain Spatial QA unavailable.", error);
      state.spatialQualityProfile = {
        ...(state.spatialQualityProfile || {}),
        qaStatus: "unavailable"
      };
      updateSpatialQualityUi();
    });
  }, 50);
}

async function renderSpatialImpulseQa(revision) {
  const sampleRate = state.audioBuffer.sampleRate;
  const tailSeconds = hasMeasuredBrirLibrary()
    ? Math.min(4.2, state.measuredBrirBuffer.duration + 0.65)
    : 1.8;
  const context = new window.OfflineAudioContext(2, Math.ceil(tailSeconds * sampleRate), sampleRate);
  const impulse = context.createBuffer(2, Math.ceil(tailSeconds * sampleRate), sampleRate);
  impulse.getChannelData(0)[0] = 0.25;
  impulse.getChannelData(1)[0] = 0.25;
  const graph = createSpatialPlaybackGraph(context, impulse, state.analysis, { ignoreStems: true });
  try {
    startGraphSources(graph, 0);
    const rendered = await context.startRendering();
    if (revision !== state.spatialQaRevision) return;
    const metrics = window.SpatialAudioQuality?.analyzeBinauralResponse(rendered);
    if (!metrics) throw new Error("Impulse response metrics are empty");
    const objectiveQa = {
      ...metrics,
      levelDeltaDb: 0,
      measurementDomain: "rendered-impulse-response",
      standardBasis: "ISO-3382-inspired",
      status: Math.abs(metrics.balanceDb) <= 1.25 &&
        metrics.peakDbfs <= -0.02 &&
        Number.isFinite(metrics.edtSeconds) &&
        Number.isFinite(metrics.iacc80) ? "pass" : "review"
    };
    state.spatialQualityProfile = {
      ...(state.spatialQualityProfile || {}),
      objectiveQa,
      qaStatus: "ready"
    };
    state.spatialOutputCalibration = {
      ...(state.spatialOutputCalibration || {}),
      objectiveQa
    };
    updateSpatialQualityUi();
  } finally {
    disconnectGraph(graph);
  }
}

async function exportFullSpatialWav() {
  if (state.exportInProgress || !state.audioBuffer || !state.analysis) return;
  const OfflineContext = window.OfflineAudioContext;
  if (!OfflineContext) {
    showToast("이 브라우저는 Full Spatial 오프라인 렌더링을 지원하지 않습니다.");
    return;
  }

  const buffer = state.audioBuffer;
  const sampleRate = buffer.sampleRate;
  const tailSeconds = hasMeasuredBrirLibrary() ? 3.2 : 1.8;
  const frameCount = Math.ceil((buffer.duration + tailSeconds) * sampleRate);
  const estimatedWorkingBytes = frameCount * 2 * 4 * 4;
  if (estimatedWorkingBytes > 1024 * 1024 * 1024) {
    showToast("브라우저 메모리 보호를 위해 이 길이의 곡은 WAV로 내보낼 수 없습니다.");
    return;
  }

  state.exportInProgress = true;
  refs.exportButton.disabled = true;
  refs.exportButton.textContent = "Rendering…";
  let graph = null;
  try {
    const cached = state.spatialRenderCache.get(getSpatialRenderCacheKey());
    let rendered = cached?.buffer || null;
    if (!rendered) {
      const context = new OfflineContext(2, frameCount, sampleRate);
      graph = createSpatialPlaybackGraph(context, buffer, state.analysis);
      startGraphSources(graph, 0);
      rendered = await context.startRendering();
    }
    refs.exportButton.textContent = "Metering…";
    const meterBlob = encodeWaveBlob(rendered, { bitDepth: 32, float: true, gain: 1 });
    const response = await fetch(apiPath(`/api/measure-output?filename=${encodeURIComponent("full-spatial.wav")}`), {
      method: "POST",
      headers: { "Content-Type": "audio/wav" },
      body: meterBlob
    });
    if (!response.ok) throw new Error(await readApiError(response));
    const measurement = await response.json();
    const truePeakDb = Number(measurement.estimatedTruePeakDb);
    const finalGain = Number.isFinite(truePeakDb) && truePeakDb > -1
      ? Math.pow(10, (-1 - truePeakDb) / 20)
      : 1;
    const outputBlob = encodeWaveBlob(rendered, { bitDepth: 24, float: false, gain: finalGain });
    const baseName = String(state.file?.name || "audio").replace(/\.[^.]+$/, "");
    downloadBlob(outputBlob, `${baseName} - Full Spatial 24bit.wav`);
    const finalTruePeakDb = Number.isFinite(truePeakDb) ? Math.min(-1, truePeakDb) : -1;
    showToast(`Full Spatial WAV 완료 · ${measurement.integratedLufs} LUFS-I · ${finalTruePeakDb.toFixed(2)} dBTP`);
  } catch (error) {
    console.error(error);
    showToast(error.message || "Full Spatial WAV 렌더링에 실패했습니다.");
  } finally {
    if (graph) disconnectGraph(graph);
    state.exportInProgress = false;
    refs.exportButton.disabled = !state.audioBuffer;
    refs.exportButton.textContent = "24-bit WAV";
  }
}

function encodeWaveBlob(audioBuffer, options = {}) {
  const bitDepth = options.bitDepth === 24 ? 24 : 32;
  const isFloat = options.float === true && bitDepth === 32;
  const gain = clamp(Number(options.gain) || 1, 0, 1);
  const channels = Math.min(2, audioBuffer.numberOfChannels);
  const bytesPerSample = bitDepth / 8;
  const dataBytes = audioBuffer.length * channels * bytesPerSample;
  const array = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(array);
  const writeAscii = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, isFloat ? 3 : 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, audioBuffer.sampleRate, true);
  view.setUint32(28, audioBuffer.sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, bitDepth, true);
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);
  const channelData = Array.from({ length: channels }, (_, channel) => audioBuffer.getChannelData(channel));
  let offset = 44;
  for (let frame = 0; frame < audioBuffer.length; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = clamp(channelData[channel][frame] * gain, -1, 1);
      if (isFloat) {
        view.setFloat32(offset, sample, true);
      } else {
        const value = Math.round(sample < 0 ? sample * 0x800000 : sample * 0x7fffff);
        view.setUint8(offset, value & 0xff);
        view.setUint8(offset + 1, (value >> 8) & 0xff);
        view.setUint8(offset + 2, (value >> 16) & 0xff);
      }
      offset += bytesPerSample;
    }
  }
  return new Blob([array], { type: "audio/wav" });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function getLoudestPreviewOffset(waveform, duration, previewSeconds) {
  const points = Array.isArray(waveform) ? waveform : [];
  if (!points.length || duration <= previewSeconds) return 0;
  let loudestIndex = 0;
  let loudestValue = -Infinity;
  points.forEach((value, index) => {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > loudestValue) {
      loudestValue = numeric;
      loudestIndex = index;
    }
  });
  const center = duration * (loudestIndex + 0.5) / points.length;
  return clamp(center - previewSeconds * 0.5, 0, Math.max(0, duration - previewSeconds));
}

function getSpatialCalibrationOffsets(analysis, duration, previewSeconds, maximumWindows = 4) {
  const latestStart = Math.max(0, duration - previewSeconds);
  if (latestStart <= 0) return [0];
  const sections = Array.isArray(analysis?.sections) ? analysis.sections : [];
  const candidates = [getLoudestPreviewOffset(analysis?.waveform, duration, previewSeconds)];
  const addSectionCandidate = (score) => {
    const ranked = sections
      .map((section) => ({ section, score: Number(score(section)) }))
      .filter((item) => Number.isFinite(item.score))
      .sort((a, b) => b.score - a.score);
    if (!ranked.length) return;
    const section = ranked[0].section;
    const center = (Number(section.start) + Number(section.end)) * 0.5;
    if (Number.isFinite(center)) candidates.push(clamp(center - previewSeconds * 0.5, 0, latestStart));
  };
  addSectionCandidate((section) => section.energy);
  addSectionCandidate((section) => section.density);
  addSectionCandidate((section) => section.brightness);
  for (let index = 1; index < maximumWindows; index += 1) {
    candidates.push(latestStart * index / Math.max(1, maximumWindows - 1));
  }

  const offsets = [];
  const minimumGap = Math.min(previewSeconds * 0.5, Math.max(0.25, latestStart / maximumWindows));
  for (const candidate of candidates) {
    const offset = clamp(Number(candidate) || 0, 0, latestStart);
    if (offsets.every((existing) => Math.abs(existing - offset) >= minimumGap)) offsets.push(offset);
    if (offsets.length >= maximumWindows) break;
  }
  return offsets.length ? offsets : [0];
}

function getCalibrationLevelErrorDb(result) {
  if (!result) return 0;
  return 20 * Math.log10(
    Math.max(1e-12, result.renderedRms) / Math.max(1e-12, result.referenceRms)
  );
}

function getWorstCalibrationLevelErrorDb(results = []) {
  return results.reduce((worst, result) => {
    const current = getCalibrationLevelErrorDb(result);
    return Math.abs(current) > Math.abs(worst) ? current : worst;
  }, 0);
}

function aggregateSpatialCalibrationResults(results = []) {
  const valid = results.filter((result) => result && Number.isFinite(result.rmsMatchGain));
  if (!valid.length) return null;
  const sortedGains = valid.map((result) => result.rmsMatchGain).sort((a, b) => a - b);
  const middle = Math.floor(sortedGains.length / 2);
  const medianGain = sortedGains.length % 2
    ? sortedGains[middle]
    : (sortedGains[middle - 1] + sortedGains[middle]) * 0.5;
  const representative = valid.reduce((worst, result) => (
    Math.abs(getCalibrationLevelErrorDb(result)) > Math.abs(getCalibrationLevelErrorDb(worst)) ? result : worst
  ), valid[0]);
  return {
    ...representative,
    gain: medianGain,
    rmsMatchGain: medianGain,
    renderedPeak: Math.max(...valid.map((result) => result.renderedPeak)),
    referencePeak: Math.max(...valid.map((result) => result.referencePeak)),
    peakHeadroomGain: Math.min(...valid.map((result) => result.peakHeadroomGain)),
    widthScale: Math.min(...valid.map((result) => result.widthScale)),
    windowCount: valid.length,
    windowOffsets: valid.map((result) => result.offsetSeconds)
  };
}

function deriveSpatialQaBusLimits(results = []) {
  const valid = results.filter(Boolean);
  const maximumBalanceDelta = Math.max(0, ...valid.map((result) => Math.abs(result.balanceDeltaDb || 0)));
  const minimumCorrelation = Math.min(1, ...valid.map((result) => result.stereoCorrelation));
  const minimumReferenceCorrelation = Math.min(1, ...valid.map((result) => result.referenceStereoCorrelation));
  const maximumPeak = Math.max(0, ...valid.map((result) => result.renderedPeak));
  let roomScale = 1;
  let lateralScale = 1;
  const reasons = [];
  if (maximumBalanceDelta > 0.75) {
    lateralScale = 0.9;
    roomScale = 0.96;
    reasons.push("balance-delta");
  }
  if (minimumCorrelation < -0.2 && minimumCorrelation - minimumReferenceCorrelation < -0.3) {
    lateralScale = Math.min(lateralScale, 0.88);
    reasons.push("phase-spread");
  }
  if (maximumPeak > 0.995) {
    roomScale = Math.min(roomScale, 0.92);
    reasons.push("peak-headroom");
  }
  return { roomScale, lateralScale, limited: reasons.length > 0, reasons };
}

function buildSpatialProgramObjectiveQa(renderRows = [], busLimits = {}) {
  const rows = renderRows.filter((row) => row?.calibration);
  if (!rows.length) return null;
  const responses = rows.map((row) => row.response).filter(Boolean);
  const worstLevelDeltaDb = getWorstCalibrationLevelErrorDb(rows.map((row) => row.calibration));
  const worstBalanceDeltaDb = rows.reduce((worst, row) => {
    const current = Number(row.calibration.balanceDeltaDb) || 0;
    return Math.abs(current) > Math.abs(worst) ? current : worst;
  }, 0);
  const maximumPeak = Math.max(...rows.map((row) => row.calibration.renderedPeak));
  const averageMetric = (key, fallback = 0) => {
    const values = responses.map((response) => Number(response[key])).filter(Number.isFinite);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
  };
  return {
    ...(responses[0] || {}),
    iacc80: averageMetric("iacc80", 1),
    c80Db: averageMetric("c80Db", 0),
    edtSeconds: averageMetric("edtSeconds", 0),
    balanceDb: averageMetric("balanceDb", 0),
    levelDeltaDb: worstLevelDeltaDb,
    balanceDeltaDb: worstBalanceDeltaDb,
    renderedPeak: maximumPeak,
    measurementDomain: "representative-program-windows",
    windowCount: rows.length,
    spatialBusLimited: Boolean(busLimits.limited),
    status: Math.abs(worstLevelDeltaDb) <= 1 &&
      Math.abs(worstBalanceDeltaDb) <= 0.75 &&
      maximumPeak <= 0.995 ? "pass" : "review"
  };
}

function analyzeRenderedSpatialCalibration(rendered, referenceBuffer, offsetSeconds, previewSeconds) {
  if (!rendered || rendered.numberOfChannels < 1 || rendered.length < 1) return null;
  let peak = 0;
  let energy = 0;
  let samples = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  let crossEnergy = 0;
  const previewFrames = Math.max(1, Math.min(rendered.length, Math.round(previewSeconds * rendered.sampleRate)));
  for (let channel = 0; channel < rendered.numberOfChannels; channel += 1) {
    const data = rendered.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) {
      const value = Number(data[index]);
      if (!Number.isFinite(value)) return null;
      peak = Math.max(peak, Math.abs(value));
      if (index < previewFrames) {
        energy += value * value;
        samples += 1;
      }
    }
  }
  if (rendered.numberOfChannels >= 2) {
    const left = rendered.getChannelData(0);
    const right = rendered.getChannelData(1);
    for (let index = 0; index < Math.min(previewFrames, left.length, right.length); index += 1) {
      leftEnergy += left[index] * left[index];
      rightEnergy += right[index] * right[index];
      crossEnergy += left[index] * right[index];
    }
  }
  const rms = Math.sqrt(energy / Math.max(1, samples));
  const referenceStats = getAudioBufferWindowStats(referenceBuffer, offsetSeconds, previewSeconds);
  const sourceRms = referenceStats.rms > 1e-8 ? referenceStats.rms : rms;
  const rmsMatchGain = rms > 1e-8 ? clamp(sourceRms / rms, 0.5, 4.5) : 1;
  const interSampleMargin = 10 ** (0.5 / 20);
  const targetPeak = 10 ** (-1 / 20);
  const peakHeadroomGain = peak > 1e-8 ? clamp(targetPeak / (peak * interSampleMargin), 0.5, 4.5) : 1;
  const stereoCorrelation = leftEnergy > 1e-12 && rightEnergy > 1e-12
    ? clamp(crossEnergy / Math.sqrt(leftEnergy * rightEnergy), -1, 1)
    : 1;
  const channelBalanceDb = leftEnergy > 1e-12 && rightEnergy > 1e-12
    ? 10 * Math.log10(leftEnergy / rightEnergy)
    : 0;
  const widthScale = stereoCorrelation < -0.12
    ? clamp(mapRange(stereoCorrelation, -1, -0.12, 0.62, 1), 0.62, 1)
    : 1;
  return {
    gain: rmsMatchGain,
    renderedPeak: peak,
    renderedRms: rms,
    referencePeak: referenceStats.peak,
    referenceRms: sourceRms,
    rmsMatchGain,
    peakHeadroomGain,
    predictedMatchedPeak: peak * rmsMatchGain,
    levelErrorDb: 20 * Math.log10(Math.max(1e-12, rms * rmsMatchGain) / Math.max(1e-12, sourceRms)),
    stereoCorrelation,
    channelBalanceDb,
    referenceStereoCorrelation: referenceStats.stereoCorrelation,
    referenceChannelBalanceDb: referenceStats.channelBalanceDb,
    correlationDelta: stereoCorrelation - referenceStats.stereoCorrelation,
    balanceDeltaDb: channelBalanceDb - referenceStats.channelBalanceDb,
    widthScale,
    offsetSeconds,
    previewSeconds
  };
}

function getAudioBufferWindowStats(buffer, offsetSeconds = 0, durationSeconds = buffer?.duration || 0) {
  if (!buffer || buffer.numberOfChannels < 1 || buffer.length < 1) {
    return { rms: 0, peak: 0, samples: 0, stereoCorrelation: 1, channelBalanceDb: 0 };
  }
  const start = clamp(Math.round(Math.max(0, offsetSeconds) * buffer.sampleRate), 0, buffer.length - 1);
  const requestedFrames = Math.max(1, Math.round(Math.max(0, durationSeconds) * buffer.sampleRate));
  const end = Math.min(buffer.length, start + requestedFrames);
  let energy = 0;
  let peak = 0;
  let samples = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  let crossEnergy = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = start; index < end; index += 1) {
      const value = Number(data[index]);
      if (!Number.isFinite(value)) continue;
      energy += value * value;
      peak = Math.max(peak, Math.abs(value));
      samples += 1;
    }
  }
  if (buffer.numberOfChannels >= 2) {
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    for (let index = start; index < end; index += 1) {
      leftEnergy += left[index] * left[index];
      rightEnergy += right[index] * right[index];
      crossEnergy += left[index] * right[index];
    }
  }
  const stereoCorrelation = leftEnergy > 1e-12 && rightEnergy > 1e-12
    ? clamp(crossEnergy / Math.sqrt(leftEnergy * rightEnergy), -1, 1)
    : 1;
  const channelBalanceDb = leftEnergy > 1e-12 && rightEnergy > 1e-12
    ? 10 * Math.log10(leftEnergy / rightEnergy)
    : 0;
  return {
    rms: Math.sqrt(energy / Math.max(1, samples)),
    peak,
    samples,
    stereoCorrelation,
    channelBalanceDb
  };
}

function getBrowserDecodeMessage(file, error) {
  const type = file.type || "알 수 없는 형식";
  const name = file.name || "audio";
  const detail = error && error.message ? ` (${error.message})` : "";
  return `백엔드 분석은 완료됐지만 브라우저가 ${name} 파일을 재생용으로 디코딩하지 못했습니다. 형식: ${type}${detail}`;
}

function getAnalysisFailureStatus(error) {
  const message = String(error && error.message ? error.message : "");
  if (/Failed to fetch|NetworkError|Network request failed|Load failed/i.test(message)) {
    return "서버 연결 실패";
  }
  if (/No audio body|too large|Analysis failed|분석 요청 실패/i.test(message)) {
    return "분석 실패";
  }
  return "분석 실패";
}

async function postAudioForAnalysis(file, signal) {
  const params = new URLSearchParams({
    filename: file.name,
    demucs: "true",
    demucs_model: DEMUCS_MODEL
  });
  let response;
  try {
    response = await fetch(apiPath(`/api/analyze?${params.toString()}`), {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": file.type || "application/octet-stream"
      },
      body: file,
      signal
    });
  } catch (error) {
    if (error && error.name === "AbortError") throw error;
    const wrapped = new Error("백엔드 서버에 연결할 수 없습니다. start.ps1을 실행한 뒤 http://127.0.0.1:8768/에서 다시 시도하세요.");
    wrapped.cause = error;
    throw wrapped;
  }
  if (!response.ok) {
    let message = `분석 요청 실패 (${response.status})`;
    try {
      const payload = await response.json();
      if (payload.detail) message = payload.detail;
    } catch (parseError) {
      // 세부 오류를 표시할 수 없을 때는 기존의 일반 상태 문구를 유지한다.
    }
    throw new Error(message);
  }
  return response.json();
}

async function loadStemBuffers(context, analysis, referenceBuffer) {
  const stems = getDemucsStemItems(analysis);
  if (!stems.length) return null;
  const loaded = {};
  const settled = await Promise.allSettled(stems.map(async (stem) => {
    if (!isSafeOutputPath(stem.path)) {
      throw new Error(`${stem.label} stem 경로가 안전하지 않습니다.`);
    }
    const response = await fetch(apiPath(`/outputs/${stem.path}`));
    if (!response.ok) throw new Error(`${stem.label} stem 로드 실패 (${response.status})`);
    const data = await response.arrayBuffer();
    const buffer = await context.decodeAudioData(data.slice(0));
    if (!isAlignedStemBuffer(buffer, referenceBuffer)) {
      throw new Error(`${stem.label} stem의 길이가 원본과 일치하지 않습니다.`);
    }
    loaded[stem.id] = {
      ...stem,
      buffer
    };
  }));
  const failed = settled.filter((item) => item.status === "rejected");
  const loadedIds = Object.keys(loaded);
  if (failed.length && !loadedIds.length) {
    throw new Error("Demucs stem 파일을 브라우저에서 디코딩하지 못했습니다.");
  }
  if (failed.length || STEM_ORDER.some((stemId) => !loaded[stemId])) {
    console.warn("Stem set is incomplete or misaligned; using the balanced full-mix fallback.", failed);
    return null;
  }
  const alignment = estimateStemSetAlignment(referenceBuffer, loaded);
  state.stemAlignmentProfile = alignment;
  if (!alignment.reliable) {
    console.warn("Stem sample alignment confidence is too low; using the phase-safe full-mix fallback.", alignment);
    return null;
  }
  Object.values(loaded).forEach((stem) => {
    stem.alignmentSamples = alignment.lagSamples;
    stem.alignmentOffsetSeconds = alignment.lagSamples / referenceBuffer.sampleRate;
  });
  return loaded;
}

function isSafeOutputPath(path) {
  if (typeof path !== "string" || !path || path.includes("\0")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("/") || path.startsWith("\\")) return false;
  return !path.split(/[\\/]+/).includes("..");
}

function isAlignedStemBuffer(buffer, referenceBuffer) {
  if (!buffer || !referenceBuffer) return false;
  if (buffer.numberOfChannels < 1 || buffer.numberOfChannels > 2) return false;
  const tolerance = Math.max(
    STEM_DURATION_TOLERANCE_SECONDS,
    referenceBuffer.duration * 0.002
  );
  return Math.abs(buffer.duration - referenceBuffer.duration) <= tolerance;
}

function estimateStemSetAlignment(referenceBuffer, loadedStems) {
  const stems = Object.values(loadedStems || {}).filter((stem) => stem?.buffer);
  if (!referenceBuffer || !stems.length) {
    return { lagSamples: 0, correlation: 0, reliable: false, inspectedSamples: 0 };
  }
  const maxLag = Math.min(
    STEM_ALIGNMENT_MAX_LAG_SAMPLES,
    Math.max(0, Math.floor(referenceBuffer.length / 8))
  );
  const length = Math.min(referenceBuffer.length, ...stems.map((stem) => stem.buffer.length));
  const usable = length - maxLag * 2 - 1;
  if (usable <= 32) {
    return { lagSamples: 0, correlation: 1, reliable: true, inspectedSamples: 0 };
  }
  const sampleCount = Math.min(STEM_ALIGNMENT_SAMPLE_LIMIT, usable);
  const referenceChannels = Array.from({ length: referenceBuffer.numberOfChannels }, (_, channel) => (
    referenceBuffer.getChannelData(channel)
  ));
  const stemChannels = stems.map((stem) => (
    Array.from({ length: stem.buffer.numberOfChannels }, (_, channel) => stem.buffer.getChannelData(channel))
  ));
  const readMono = (channels, index) => {
    if (channels.length === 1) return channels[0][index] || 0;
    return ((channels[0][index] || 0) + (channels[1][index] || 0)) * 0.5;
  };
  let bestLag = 0;
  let bestCorrelation = -1;
  let referencePowerAtZero = 0;

  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    let dot = 0;
    let referencePower = 0;
    let stemPower = 0;
    for (let sample = 0; sample < sampleCount; sample += 1) {
      const index = maxLag + Math.floor(sample * usable / sampleCount);
      const reference = readMono(referenceChannels, index);
      let stemSum = 0;
      for (let stemIndex = 0; stemIndex < stemChannels.length; stemIndex += 1) {
        stemSum += readMono(stemChannels[stemIndex], index + lag);
      }
      dot += reference * stemSum;
      referencePower += reference * reference;
      stemPower += stemSum * stemSum;
    }
    if (lag === 0) referencePowerAtZero = referencePower;
    const correlation = dot / Math.sqrt(Math.max(referencePower * stemPower, 1e-18));
    if (
      correlation > bestCorrelation + 1e-6 ||
      (Math.abs(correlation - bestCorrelation) <= 1e-6 && Math.abs(lag) < Math.abs(bestLag))
    ) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  const silent = referencePowerAtZero / Math.max(1, sampleCount) < 1e-10;
  return {
    lagSamples: silent ? 0 : bestLag,
    correlation: silent ? 1 : bestCorrelation,
    reliable: silent || bestCorrelation >= STEM_ALIGNMENT_MIN_CORRELATION,
    inspectedSamples: sampleCount
  };
}

function getDemucsStemItems(analysis) {
  const separator = analysis && analysis.models && analysis.models.deepSeparator;
  if (!separator || separator.status !== "completed" || !Array.isArray(separator.stems)) return [];
  const stemQuality = separator.stemQuality || {};
  const seen = new Set();
  const stems = separator.stems.map((path) => {
    const filename = path.split("/").pop() || "";
    const id = filename.replace(/\.[^.]+$/, "").toLowerCase();
    const profile = STEM_PROFILES[id];
    if (!profile || seen.has(id)) return null;
    seen.add(id);
    const quality = stemQuality[id] || {};
    return {
      ...profile,
      path,
      kind: "stem",
      active: true,
      family: "stem",
      quality,
      separation: clamp(Number(quality.separation) || 0.72, 0, 1),
      spatialWeight: getStemQualitySpatialWeight(quality),
      displayCurve: [],
      curve: []
    };
  }).filter(Boolean);
  return stems.sort((a, b) => STEM_ORDER.indexOf(a.id) - STEM_ORDER.indexOf(b.id));
}

function getStemQualitySpatialWeight(quality = {}) {
  const explicit = Number(quality.spatialWeight);
  if (Number.isFinite(explicit)) return clamp(explicit, 0.62, 1.08);
  const separation = Number(quality.separation);
  if (Number.isFinite(separation)) return clamp(0.72 + separation * 0.36, 0.62, 1.08);
  return 1;
}

async function ensureAudioContext() {
  if (!state.audioContext) {
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)({
      latencyHint: "playback"
    });
    configureSpatialListener(state.audioContext);
    setupAudioRenderCapacityMonitor(state.audioContext);
    await ensureSpatialAnalysisWorklet(state.audioContext);
  }
  if (state.audioContext.state === "suspended") {
    const resumePromise = state.audioContext.resume();
    let resumeTimer = null;
    // 자동재생 정책이 resume을 보류해도 파일 분석과 디코딩은 계속 진행한다.
    await Promise.race([
      resumePromise,
      new Promise((resolve) => {
        resumeTimer = window.setTimeout(resolve, AUDIO_CONTEXT_RESUME_WAIT_MS);
      })
    ]).finally(() => {
      if (resumeTimer !== null) window.clearTimeout(resumeTimer);
    });
  }
  return state.audioContext;
}

async function ensureSpatialAnalysisWorklet(context) {
  if (!context?.audioWorklet || typeof window.AudioWorkletNode !== "function") {
    state.spatialWorkletStatus = "fallback";
    return false;
  }
  if (state.spatialWorkletStatus === "ready") return true;
  if (state.spatialWorkletStatus === "loading") return false;
  state.spatialWorkletStatus = "loading";
  try {
    await context.audioWorklet.addModule(apiPath("/js/spatial-analysis-worklet.js?v=20260802-v1"));
    state.spatialWorkletStatus = "ready";
    return true;
  } catch (error) {
    state.spatialWorkletStatus = "fallback";
    console.warn("Spatial AudioWorklet unavailable; using pre-analysed automation.", error);
    return false;
  }
}

function setupAudioRenderCapacityMonitor(context) {
  if (state.runtimeQualityController || !window.SpatialRuntimeQualityController) return;
  const initialTier = state.audioQualityTier;
  state.runtimeQualityController = new window.SpatialRuntimeQualityController({
    initialTier,
    ceilingTier: initialTier,
    onTierChange(change) {
      state.audioQualityTier = change.tier;
      state.perf.audioLoad = { supported: true, ...change.metrics };
      updateSpatialControlUi();
      updatePerfPanel(performance.now(), { force: true });
      const label = getAudioQualityProfile().label;
      if (change.reason === "render-overload") {
        showToast(`오디오 부하를 감지해 ${label}로 안전하게 전환했습니다.`);
      }
      if (state.playing && state.mode === "spatial") {
        crossfadePlaybackMode(getPlaybackTime()).catch((error) => console.warn("Adaptive quality graph rebuild failed", error));
      }
    }
  });
  const attached = state.runtimeQualityController.attach(context);
  if (!attached) {
    state.perf.audioLoad = { supported: false, averageLoad: 0, peakLoad: 0, underrunRatio: 0 };
    return;
  }
  const originalHandleUpdate = state.runtimeQualityController.handleUpdate.bind(state.runtimeQualityController);
  state.runtimeQualityController.handleUpdate = (event, now) => {
    const snapshot = originalHandleUpdate(event, now);
    state.perf.audioLoad = snapshot;
    return snapshot;
  };
}

function configureSpatialListener(context) {
  const listener = context?.listener;
  if (!listener) return;
  setAudioParamValue(listener.positionX, 0, context.currentTime);
  setAudioParamValue(listener.positionY, 0, context.currentTime);
  setAudioParamValue(listener.positionZ, 0, context.currentTime);
  setAudioParamValue(listener.forwardX, 0, context.currentTime);
  setAudioParamValue(listener.forwardY, 0, context.currentTime);
  setAudioParamValue(listener.forwardZ, -1, context.currentTime);
  setAudioParamValue(listener.upX, 0, context.currentTime);
  setAudioParamValue(listener.upY, 1, context.currentTime);
  setAudioParamValue(listener.upZ, 0, context.currentTime);
  if (typeof listener.setPosition === "function") {
    listener.setPosition(0, 0, 0);
  }
  if (typeof listener.setOrientation === "function") {
    listener.setOrientation(0, 0, -1, 0, 1, 0);
  }
}

function setAudioParamValue(param, value, time = 0) {
  if (!param) return;
  if (typeof param.setValueAtTime === "function") {
    param.setValueAtTime(value, time);
  } else {
    param.value = value;
  }
}

function renderAnalysis(analysis) {
  const file = analysis.file;
  setText(refs.trackKicker, "READY");
  refs.trackName.textContent = file.name;
  setText(refs.trackSubtitle, `${formatTime(file.duration)} · ${file.channels}ch · ${formatBytes(state.file.size)} · 원본 기준선`);
  refs.totalTime.textContent = formatTime(file.duration);

  refs.metrics.duration.textContent = formatTime(file.duration);
  refs.metrics.sampleRate.textContent = `${formatNumber(file.sampleRate)} Hz`;
  refs.metrics.tempo.textContent = analysis.tempo.bpm ? analysis.tempo.bpm : "--";
  refs.metrics.tempoNote.textContent = `${Math.round(analysis.tempo.confidence * 100)}% confidence`;
  refs.metrics.key.textContent = analysis.key.label;
  refs.metrics.keyNote.textContent = `${Math.round(analysis.key.confidence * 100)}% confidence`;
  refs.metrics.loudness.textContent = `${analysis.mix.rmsDb.toFixed(1)} dBFS`;
  const integratedLufs = Number(analysis.mix.integratedLufs);
  refs.metrics.loudnessNote.textContent = Number.isFinite(integratedLufs)
    ? `${integratedLufs.toFixed(1)} LUFS-I · BS.1770 gated`
    : `${analysis.mix.approxLufs.toFixed(1)} LUFS approx`;
  const estimatedTruePeakDb = Number(analysis.mix.estimatedTruePeakDb);
  refs.metrics.peak.textContent = `${(Number.isFinite(estimatedTruePeakDb) ? estimatedTruePeakDb : analysis.mix.peakDb).toFixed(1)} dBTP`;
  const truePeakOversampling = Number(analysis.mix.truePeakOversampling) || 4;
  refs.metrics.crest.textContent = `estimated ${truePeakOversampling}× · crest ${analysis.mix.crestDb.toFixed(1)} dB`;
  refs.metrics.centroid.textContent = `${Math.round(analysis.mix.centroidHz)} Hz`;
  refs.metrics.rolloff.textContent = `rolloff ${Math.round(analysis.mix.rolloffHz)} Hz`;

  setDisplayObjects(analysis);

  renderStage(analysis);
  renderInstrumentList(analysis);
  renderSpectrumGraph();
  updateRealtimeDisplay(0);
  updateSpectrumDisplay(0, { zero: true });
}

function renderStage(analysis) {
  const objects = getDisplayObjects(analysis);
  syncFieldModeState();
  refs.activeCount.textContent = state.stemBuffers ? `${objects.length} stems` : `${analysis.activeIds.length} active`;
  refs.stageMap.innerHTML = `
    <div class="field-grid" aria-hidden="true"></div>
    <div class="field-depth depth-near" aria-hidden="true"></div>
    <div class="field-depth depth-far" aria-hidden="true"></div>
    <div class="field-node-layer">
      ${createStageNodes(objects).map((node) => `
        <span class="stage-node ${node.object.active ? "" : "is-inactive"}"
          data-id="${node.object.id}"
          data-label="${escapeHtml(node.object.label)}"
          data-family="${node.object.family}"
          data-index="${node.index}"
          data-total="${objects.length}"
          style="left:${node.left.toFixed(3)}%; top:${node.top.toFixed(3)}%; --node-color:${node.color}; --level:0">
          <strong>${escapeHtml(node.short)}</strong>
          <span>${escapeHtml(node.label)}</span>
        </span>
      `).join("")}
    </div>
  `;
  cacheFieldNodes();
}

function createStageNodes(objects) {
  if (!objects.length) return [];
  return objects.map((object, index) => {
    const point = getObjectStagePoint(object, index, objects.length, state.offset, { immediate: true });
    return {
      object,
      index,
      left: point.left,
      top: point.top,
      short: object.short || SHORT_NAMES[object.id] || object.label,
      label: object.label,
      color: object.color
    };
  });
}

function getObjectStagePoint(object, index = 0, total = 1, time = 0, options = {}) {
  if (object.kind === "stem" && STEM_STAGE_LAYOUT[object.id]) {
    return STEM_STAGE_LAYOUT[object.id];
  }
  const position = getObjectRenderPosition(object, time, options);
  if (position && Number.isFinite(position.x) && Number.isFinite(position.z)) {
    return {
      left: clamp(50 + position.x * 10.7, 14, 86),
      top: clamp(72 + position.z * 8.0 - (position.y || 0) * 8.5 + index * 0.38, 16, 84)
    };
  }
  const angle = total > 1 ? (index / Math.max(1, total - 1)) * Math.PI : Math.PI * 0.5;
  return {
    left: clamp(18 + Math.cos(Math.PI - angle) * 32 + index * 0.4, 14, 86),
    top: clamp(34 + Math.sin(angle) * 36, 16, 84)
  };
}

function getObjectRenderPosition(object, time = 0, options = {}) {
  if (!object) return null;
  if (object.kind === "stem") {
    if (options.dynamic || options.immediate) {
      return getStemRenderPosition(object, time, options);
    }
    return state.stemDisplayPositions[object.id] || object.position || getStemFallbackPosition(object.id);
  }
  return getInstrumentStagePosition(object, time);
}

function getStemRenderPosition(stem, time = 0, options = {}) {
  const inference = inferStemPosition(stem.id, time, options);
  const current = state.stemDisplayPositions[stem.id] || stem.position || inference.position;
  const ratio = options.immediate || !state.playing ? 1 : 0.22;
  const next = {
    x: current.x + (inference.position.x - current.x) * ratio,
    y: current.y + (inference.position.y - current.y) * ratio,
    z: current.z + (inference.position.z - current.z) * ratio
  };
  state.stemDisplayPositions[stem.id] = next;
  stem.position = next;
  stem.inferredPosition = inference.position;
  stem.positionConfidence = inference.confidence;
  stem.positionContributors = inference.contributors;
  return next;
}

function inferStemPosition(stemId, time = null, options = {}) {
  const fallback = getStemFallbackPosition(stemId);
  if (!state.analysis || !Array.isArray(state.analysis.instruments)) {
    return { position: fallback, confidence: 0, contributors: [] };
  }
  const finiteTime = Number.isFinite(time);
  const bucket = finiteTime ? Math.max(0, Math.round(time * 6)) : "static";
  const cacheKey = options.immediate ? "" : `${stemId}:${bucket}`;
  if (cacheKey && state.stemPositionCache[cacheKey]) return state.stemPositionCache[cacheKey];

  const groups = STEM_POSITION_GROUPS[stemId] || [];
  const instruments = getAnalysisInstrumentLookup();
  let sumWeight = 0;
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  let totalBaseWeight = 0;
  const contributors = [];

  groups.forEach(([instrumentId, baseWeight]) => {
    const instrument = instruments[instrumentId];
    if (!instrument || !instrument.position) return;
    const instrumentPosition = getInstrumentStagePosition(instrument, finiteTime ? time : null);
    const activity = getInstrumentPositionActivity(instrument, finiteTime ? time : null);
    const roster = instrument.active ? 1 : 0.42;
    totalBaseWeight += baseWeight * roster;
    const confidence = clamp(
      (Number(instrument.confidence) || 0) * 0.52 +
      (Number(instrument.peak) || 0) * 0.3 +
      (Number(instrument.mean) || 0) * 0.18,
      0,
      1
    );
    const evidence = finiteTime
      ? clamp(activity * 0.82 + confidence * 0.18, 0, 1)
      : clamp(activity * 0.34 + confidence * 0.66, 0, 1);
    const weight = baseWeight * roster * evidence;
    if (weight <= 0.012) return;
    sumWeight += weight;
    sumX += instrumentPosition.x * weight;
    sumY += instrumentPosition.y * weight;
    sumZ += instrumentPosition.z * weight;
    contributors.push({
      id: instrument.id,
      label: instrument.label,
      weight
    });
  });

  if (sumWeight <= 0.035) {
    const result = { position: fallback, confidence: 0, contributors: [] };
    if (cacheKey) state.stemPositionCache[cacheKey] = result;
    return result;
  }

  contributors.sort((a, b) => b.weight - a.weight);
  const centroid = {
    x: clamp(sumX / sumWeight, STEM_POSITION_BOUNDS.x[0], STEM_POSITION_BOUNDS.x[1]),
    y: clamp(sumY / sumWeight, STEM_POSITION_BOUNDS.y[0], STEM_POSITION_BOUNDS.y[1]),
    z: clamp(sumZ / sumWeight, STEM_POSITION_BOUNDS.z[0], STEM_POSITION_BOUNDS.z[1])
  };
  const confidence = clamp(sumWeight / Math.max(totalBaseWeight * 0.55, 0.001), 0, 1);
  const mix = clamp(0.42 + confidence * 0.5, 0.38, 0.9);
  const position = applyStemPositionAnchor(stemId, {
    x: clamp(fallback.x * (1 - mix) + centroid.x * mix, STEM_POSITION_BOUNDS.x[0], STEM_POSITION_BOUNDS.x[1]),
    y: clamp(fallback.y * (1 - mix) + centroid.y * mix, STEM_POSITION_BOUNDS.y[0], STEM_POSITION_BOUNDS.y[1]),
    z: clamp(fallback.z * (1 - mix) + centroid.z * mix, STEM_POSITION_BOUNDS.z[0], STEM_POSITION_BOUNDS.z[1])
  });
  const result = {
    position,
    confidence,
    contributors: contributors.slice(0, 3)
  };
  if (cacheKey) state.stemPositionCache[cacheKey] = result;
  return result;
}

function applyStemPositionAnchor(stemId, position) {
  const anchor = STEM_POSITION_ANCHORS[stemId];
  if (!anchor) return position;
  return {
    x: clamp(
      anchor.x + (position.x - anchor.x) * anchor.lateralMix,
      anchor.x - anchor.maxAbsX,
      anchor.x + anchor.maxAbsX
    ),
    y: clamp(
      anchor.y * (1 - anchor.verticalMix) + position.y * anchor.verticalMix,
      STEM_POSITION_BOUNDS.y[0],
      STEM_POSITION_BOUNDS.y[1]
    ),
    z: clamp(
      anchor.z * (1 - anchor.depthMix) + position.z * anchor.depthMix,
      STEM_POSITION_BOUNDS.z[0],
      STEM_POSITION_BOUNDS.z[1]
    )
  };
}

function getInstrumentStagePosition(instrument, time = null) {
  const position = instrument.position || { x: 0, y: 0, z: -2.8 };
  return {
    x: position.x,
    y: position.y || 0,
    z: position.z || -2.8
  };
}

function getAnalysisInstrumentLookup() {
  if (!state.analysis || !Array.isArray(state.analysis.instruments)) return {};
  const key = state.analysis.jobId || state.analysis.cacheKey || state.analysis.file?.name || "analysis";
  if (state.stemPositionCache.instrumentKey === key && state.stemPositionCache.instrumentLookup) {
    return state.stemPositionCache.instrumentLookup;
  }
  const lookup = {};
  state.analysis.instruments.forEach((instrument) => {
    lookup[instrument.id] = instrument;
  });
  state.stemPositionCache.instrumentKey = key;
  state.stemPositionCache.instrumentLookup = lookup;
  return lookup;
}

function getInstrumentPositionActivity(instrument, time = null) {
  const curveLevel = Number.isFinite(time)
    ? getInstrumentLevelFromCurve(instrument.curve || instrument.displayCurve || [], time)
    : 0;
  if (Number.isFinite(time)) {
    return clamp(curveLevel * 0.88 + (Number(instrument.confidence) || 0) * 0.08 + (Number(instrument.mean) || 0) * 0.04, 0, 1);
  }
  return clamp(
    (Number(instrument.confidence) || 0) * 0.48 +
    (Number(instrument.peak) || 0) * 0.34 +
    (Number(instrument.mean) || 0) * 0.18,
    0,
    1
  );
}

function getStemFallbackPosition(stemId) {
  const profile = STEM_PROFILES[stemId];
  const fallback = profile && profile.position ? profile.position : { x: 0, y: 0, z: -2.8 };
  return {
    x: fallback.x,
    y: fallback.y,
    z: fallback.z
  };
}

function cacheFieldNodes() {
  const groups = {};
  refs.stageMap.querySelectorAll(".stage-node").forEach((node) => {
    const id = node.dataset.id;
    if (!id) return;
    if (!groups[id]) groups[id] = [];
    groups[id].push(node);
  });
  state.fieldNodeGroups = groups;
}

function renderSpectrumGraph() {
  resetSpectrumState();
  updateSpectrumDisplay(0, { zero: true, force: true });
}

function resetSpectrumState() {
  state.spectrumLevels.fill(0);
  state.spectrumPeaks.fill(0);
  state.spectrumRanges = null;
  state.spectrumRangeKey = "";
  state.spectrumCache.backgroundKey = "";
  state.spectrumCache.backgroundCanvas = null;
  state.spectrumCache.gradientKey = "";
  state.spectrumCache.gradient = null;
  state.lastSpectrumStatusAt = 0;
  state.lastSpectrumStatusText = "";
  invalidateCanvasRenderMetrics(state.spectrumCache);
}

function renderInstrumentList(analysis) {
  const objects = getDisplayObjects(analysis);
  state.meterLevels = Object.fromEntries(objects.map((object) => [object.id, 0]));
  state.fieldLevels = Object.fromEntries(objects.map((object) => [object.id, 0]));
  refs.instrumentList.innerHTML = objects.map((object) => `
    <div class="instrument-row ${object.active ? "" : "is-inactive"}" data-id="${object.id}" style="--bar-color:${object.color}; --level:0">
      <div class="stem-copy">
        <strong title="${object.label}">${object.label}</strong>
        <span>${escapeHtml(object.description || getFallbackObjectDescription(object))}</span>
      </div>
      <div class="bar-track"><div class="bar-fill"></div></div>
      <em>0%</em>
    </div>
  `).join("");
  cacheMeterRows();
}

function cacheMeterRows() {
  const rows = {};
  refs.instrumentList.querySelectorAll(".instrument-row").forEach((row) => {
    const id = row.dataset.id;
    if (!id) return;
    rows[id] = {
      row,
      value: row.querySelector("em"),
      cache: {
        level: -1,
        percent: -1,
        sounding: null,
        live: null,
        inactive: null
      }
    };
  });
  state.meterRows = rows;
}

function getFallbackObjectDescription(object) {
  if (object.family === "keyboard") return "넓은 대역과 어택을 추적합니다.";
  if (object.family === "percussion") return "타격과 순간 에너지를 추적합니다.";
  if (object.family === "brass" || object.family === "woodwinds") return "중고역 존재감과 거리감을 추적합니다.";
  if (object.family === "strings") return "지속음과 선율 움직임을 추적합니다.";
  return "실시간 에너지 변화를 추적합니다.";
}

function setDisplayObjects(analysis) {
  state.displayObjects = buildDisplayObjects(analysis);
}

function buildDisplayObjects(analysis) {
  if (!analysis) return [];
  if (state.stemBuffers) {
    return Object.values(state.stemBuffers)
      .sort((a, b) => STEM_ORDER.indexOf(a.id) - STEM_ORDER.indexOf(b.id))
      .map((stem) => {
        const enriched = { ...stem };
        const inference = inferStemPosition(stem.id, state.offset || 0, { immediate: true });
        enriched.position = getStemRenderPosition(enriched, state.offset || 0, { immediate: true });
        enriched.inferredPosition = inference.position;
        enriched.positionConfidence = inference.confidence;
        enriched.positionContributors = inference.contributors;
        return enriched;
      });
  }
  return analysis.instruments.map((instrument) => ({
    ...instrument,
    kind: "instrument",
    short: SHORT_NAMES[instrument.id] || instrument.label
  }));
}

function getDisplayObjects(analysis) {
  if (analysis === state.analysis && Array.isArray(state.displayObjects)) {
    return state.displayObjects;
  }
  return buildDisplayObjects(analysis);
}

function renderModelStack(analysis) {
  const separator = analysis.models.deepSeparator;
  const demucsSettings = separator.settings || {};
  const demucsProfile = separator.qualityProfile || "spatial-q2";
  refs.modelTag.textContent = hasMeasuredBrirLibrary() ? "Measured BRIR" : "Reference HRTF";
  refs.modelStack.innerHTML = `
    <div class="model-item">
      <strong>Demucs stem separator</strong>
      <span>${getDemucsStatusText(separator)}</span>
    </div>
    <div class="model-item">
      <strong>Full Spatial stem rerenderer</strong>
      <span>Aligned Demucs stems keep their native L/R sample phase on a zero-delay primary path; the original-minus-stem residual preserves missed material without a direct dry connection.</span>
    </div>
    <div class="model-item">
      <strong>Research-constrained spatial field</strong>
      <span>Each stem keeps one static dominant anchor while frequency-limited diffuse taps add width above the localization-critical low band.</span>
    </div>
    <div class="model-item">
      <strong>Reference HRTF field</strong>
      <span>${escapeHtml(getBinauralRendererSummary())}</span>
    </div>
    <div class="model-item">
      <strong>Measured venue air</strong>
      <span>${escapeHtml(getMeasuredVenueSummary())}</span>
    </div>
    <div class="model-item">
      <strong>Model quality pass</strong>
      <span>${escapeHtml(demucsProfile)} uses ${demucsSettings.device || "auto"} inference, ${demucsSettings.shifts || 1} shift averaging, overlap cleanup, and stem confidence weights.</span>
    </div>
    <div class="model-item">
      <strong>Realtime analysis</strong>
      <span>${analysis.models.primary} drives the UI; the unified Full Spatial renderer and transparent Original remain available for controlled A/B comparison.</span>
    </div>
    ${analysis.recommendations.map((item) => `
      <div class="model-item"><strong>Engine note</strong><span>${escapeHtml(item)}</span></div>
    `).join("")}
  `;
}

function getBinauralRendererSummary() {
  return "The reconstructed primary scene preserves native stereo phase; native HRTF panners or bounded FIR render only symmetric early and diffuse spatial energy.";
}

function getMeasuredVenueSummary() {
  if (!hasMeasuredBrirLibrary()) {
    return "Measured BRIR is unavailable, so playback stays on the bounded early-reflection field.";
  }
  return "Aula Carolina 3 m frontal BRIR supplies only the measured 45 ms–2.8 s binaural late field; direct sound and early object anchors remain separate.";
}

function getDemucsStatusText(separator) {
  const settings = separator.settings || {};
  const quality = separator.qualityProfile ? ` · ${separator.qualityProfile}` : "";
  const shifts = Number.isFinite(Number(settings.shifts)) ? ` · shifts ${settings.shifts}` : "";
  if (separator.status === "completed" && separator.cached) return `cache hit · ${separator.stems.length} stem files${quality}${shifts}`;
  if (separator.status === "completed") return `stem 분리 완료 · ${separator.stems.length} files${quality}${shifts}`;
  if (separator.status === "failed") return `실행 실패 · ${separator.reason || "unknown error"}`;
  if (separator.available && separator.requested) return "설치되어 있으며 분석 요청 시 자동으로 stem 분리를 실행합니다.";
  if (separator.available) return "설치됨 · 이 프로젝트에서는 기본적으로 stem 분리를 요청합니다.";
  return "현재 환경에는 설치되어 있지 않습니다. 기본 공간 분석 fallback으로 동작합니다.";
}

function renderSections(analysis) {
  refs.sectionList.innerHTML = analysis.sections.map((section) => `
    <article class="section-card">
      <strong>${formatTime(section.start)} - ${formatTime(section.end)}</strong>
      <small>energy ${Math.round(section.energy * 100)} · brightness ${Math.round(section.brightness * 100)} · density ${Math.round(section.density * 100)}</small>
      <ul>
        <li>분석 에너지 ${Math.round(clamp(section.energy * 0.62 + section.density * 0.38, 0, 1) * 100)}%</li>
      </ul>
    </article>
  `).join("");
}

async function togglePlayback() {
  if (state.playing) {
    const time = getPlaybackTime();
    stopPlayback({ keepOffset: true });
    state.offset = time;
    return;
  }
  await startPlayback();
}

async function startPlayback() {
  if (!state.audioBuffer || !state.analysis) return;
  const context = await ensureAudioContext();
  if (state.spatialRenderPromise) {
    // 이미 시작된 HQ 렌더가 실시간 재생과 겹치지 않도록 완료 후 재생한다.
    await state.spatialRenderPromise.catch(() => null);
  }
  stopPlayback({ keepOffset: true, silent: true });
  resetRuntimeQualityState();
  resetLiveAnalysisCache();
  state.perf.lastFrameAt = 0;
  state.lastVisualFrameAt = 0;
  state.lastStemDisplayFrameTime = -1;
  state.lastFieldDisplayFrameTime = -1;
  state.lastSpectrumFrameTime = -1;
  state.lastSeekFrameTime = -1;

  const graph = createPlaybackGraph(context, state.audioBuffer, state.analysis, state.mode);
  state.graph = graph;
  const safeOffset = clamp(state.offset, 0, Math.max(0, state.audioBuffer.duration - 0.02));
  const startAt = context.currentTime + 0.015;
  state.startedAt = startAt - safeOffset;
  state.playing = true;
  refs.playButton.textContent = "Ⅱ";
  if (graph.master) {
    graph.master.gain.cancelScheduledValues(context.currentTime);
    graph.master.gain.setValueAtTime(0, context.currentTime);
    scheduleGraphGainCurve(graph, 0, getGraphTargetGain(graph), startAt, 0.035, "in", "equalPower");
  }
  startGraphSources(graph, safeOffset, () => {
    if (state.playing && getPlaybackTime() >= state.audioBuffer.duration - 0.05) {
      stopPlayback();
    }
  }, startAt);
  tick();
}

async function crossfadePlaybackMode(time) {
  if (!state.audioBuffer || !state.analysis || !state.playing) return;
  const context = await ensureAudioContext();
  if (state.spatialRenderPromise) {
    await state.spatialRenderPromise.catch(() => null);
    time = getPlaybackTime();
  }
  const oldGraph = state.graph;
  const newGraph = createPlaybackGraph(context, state.audioBuffer, state.analysis, state.mode);
  const safeOffset = clamp(time, 0, Math.max(0, state.audioBuffer.duration - 0.02));
  const now = context.currentTime;
  const scheduleLead = getModeSwitchScheduleLead(context);
  const startAt = now + scheduleLead;
  const preRoll = newGraph.mode === "spatial" && !newGraph.cachedSpatial
    ? Math.min(0.08, Math.max(0, scheduleLead - 0.015))
    : 0;
  newGraph.transitionPreRollSeconds = preRoll;
  newGraph.transitionScheduleLeadSeconds = scheduleLead;
  const sourceStartAt = startAt - preRoll;
  const sourceOffset = clamp(
    safeOffset + Math.max(0, sourceStartAt - now),
    0,
    Math.max(0, state.audioBuffer.duration - 0.02)
  );
  const fadeSeconds = state.mode === "spatial" ? 0.42 : 0.34;
  const targetGain = getGraphTargetGain(newGraph);
  const incomingStartGain = 0;

  if (newGraph.master) {
    newGraph.master.gain.cancelScheduledValues(now);
    newGraph.master.gain.setValueAtTime(0, now);
    newGraph.crossfadeUntil = startAt + fadeSeconds;
    scheduleGraphGainCurve(newGraph, incomingStartGain, targetGain, startAt, fadeSeconds, "in", "linear");
  }

  state.graph = newGraph;
  state.offset = safeOffset;
  state.startedAt = now - safeOffset;
  startGraphSources(newGraph, sourceOffset, () => {
    if (state.playing && state.graph === newGraph && getPlaybackTime() >= state.audioBuffer.duration - 0.05) {
      stopPlayback();
    }
  }, sourceStartAt);

  if (oldGraph && oldGraph.master) {
    scheduleGraphGainCurve(oldGraph, getGraphCurrentGain(oldGraph, startAt), 0, startAt, fadeSeconds, "out", "linear");
    retireGraphAfterFade(oldGraph, scheduleLead + fadeSeconds);
  } else if (oldGraph) {
    retireGraphAfterFade(oldGraph, 0);
  }
}

function getModeSwitchScheduleLead(context) {
  const latency = context && Number.isFinite(context.baseLatency) ? context.baseLatency : 0.012;
  return clamp(latency * 4, 0.09, 0.16);
}

function startGraphSources(graph, offset, onEnded, startAt = 0) {
  scheduleTransientRoomAutomation(graph, offset, startAt);
  const sources = graph.sources || [graph.source];
  sources.forEach((source) => {
    if (!source) return;
    const when = Number.isFinite(startAt) && startAt > 0 ? startAt : 0;
    if (source.buffer) {
      const alignmentOffset = Number(source.spatialAlignmentOffsetSeconds) || 0;
      const sourceOffset = clamp(offset + alignmentOffset, 0, Math.max(0, source.buffer.duration - 0.02));
      source.start(when, sourceOffset);
      return;
    }
    source.start(when);
  });
  if (sources[0]) {
    sources[0].onended = onEnded;
  }
}

function scheduleTransientRoomAutomation(graph, offset, startAt = 0, windowSeconds = 35, reset = true) {
  const controls = graph?.spatialLayer?.transientControls || [];
  controls.forEach((control) => {
    const parameter = control?.gainNode?.gain;
    if (!parameter || typeof parameter.setValueAtTime !== "function") return;
    const contextTime = Number(control.gainNode.context?.currentTime) || 0;
    const baseTime = Number.isFinite(startAt) && startAt > 0 ? startAt : contextTime;
    if (reset || !Number.isFinite(control.scheduledThrough)) {
      control.scheduleContextBase = baseTime;
      control.scheduleTrackOffset = offset;
      control.scheduledThrough = offset;
      parameter.cancelScheduledValues?.(baseTime);
      parameter.setValueAtTime(1, baseTime);
    }
    const from = Math.max(offset, control.scheduledThrough);
    const until = Math.min(state.audioBuffer?.duration || Infinity, offset + windowSeconds);
    const events = (control.events || []).filter((event) => event.time >= from && event.time < until);
    events.forEach((event) => {
      const eventTime = control.scheduleContextBase + Math.max(0, event.time - control.scheduleTrackOffset);
      const leadTime = Math.max(control.scheduleContextBase, eventTime - 0.008);
      const floor = clamp(1 - (1 - control.duckFloor) * (Number(event.strength) || 0.5), control.duckFloor, 0.94);
      parameter.setValueAtTime(1, leadTime);
      parameter.linearRampToValueAtTime?.(floor, eventTime);
      parameter.linearRampToValueAtTime?.(1, eventTime + control.recoverySeconds);
    });
    control.scheduledThrough = until;
  });
}

function maintainTransientRoomAutomation(graph, playbackTime) {
  const controls = graph?.spatialLayer?.transientControls || [];
  if (!controls.length) return;
  const scheduledThrough = Math.min(...controls.map((control) => Number(control.scheduledThrough) || 0));
  if (playbackTime + 10 < scheduledThrough) return;
  scheduleTransientRoomAutomation(graph, playbackTime, 0, 40, false);
}

function scheduleGraphGainCurve(graph, fromGain, toGain, now, seconds, direction, curveType = "equalPower") {
  if (!graph || !graph.master) return;
  const gain = graph.master.gain;
  const duration = Math.max(0.04, seconds);
  const from = Number.isFinite(fromGain) ? fromGain : gain.value;
  const to = Number.isFinite(toGain) ? toGain : gain.value;
  const curve = curveType === "linear"
    ? buildLinearGainCurve(from, to)
    : buildEqualPowerGainCurve(from, to, direction);

  gain.cancelScheduledValues(now);
  gain.setValueAtTime(curve[0], now);
  try {
    gain.setValueCurveAtTime(curve, now, duration);
  } catch (curveError) {
    gain.linearRampToValueAtTime(to, now + duration);
  }
  gain.setTargetAtTime(to, now + duration + 0.006, 0.012);
  graph.gainAutomation = {
    direction,
    from,
    to,
    startTime: now,
    endTime: now + duration,
    curveType
  };
}

function buildLinearGainCurve(from, to) {
  const points = 64;
  const curve = new Float32Array(points);
  for (let index = 0; index < points; index += 1) {
    const ratio = index / (points - 1);
    curve[index] = from + (to - from) * ratio;
  }
  curve[0] = from;
  curve[points - 1] = to;
  return curve;
}

function buildEqualPowerGainCurve(from, to, direction) {
  const points = 64;
  const curve = new Float32Array(points);
  for (let index = 0; index < points; index += 1) {
    const ratio = index / (points - 1);
    if (direction === "out") {
      curve[index] = to + (from - to) * Math.cos(ratio * Math.PI * 0.5);
    } else {
      curve[index] = from + (to - from) * Math.sin(ratio * Math.PI * 0.5);
    }
  }
  curve[0] = from;
  curve[points - 1] = to;
  return curve;
}

function getGraphCurrentGain(graph, time) {
  if (!graph || !graph.master) return getGraphTargetGain(graph);
  const automation = graph.gainAutomation;
  if (!automation) return graph.master.gain.value;
  if (time <= automation.startTime) return automation.from;
  if (time >= automation.endTime) return automation.to;
  const ratio = clamp((time - automation.startTime) / Math.max(0.001, automation.endTime - automation.startTime), 0, 1);
  if (automation.curveType === "linear") {
    return automation.from + (automation.to - automation.from) * ratio;
  }
  if (automation.direction === "out") {
    return automation.to + (automation.from - automation.to) * Math.cos(ratio * Math.PI * 0.5);
  }
  return automation.from + (automation.to - automation.from) * Math.sin(ratio * Math.PI * 0.5);
}

function getGraphTargetGain(graph) {
  const scale = graph && Number.isFinite(graph.outputGainScale) ? graph.outputGainScale : 1;
  return scale;
}

function retireGraphAfterFade(graph, seconds) {
  if (!graph) return;
  const sources = graph.sources || [graph.source];
  sources.forEach((source) => {
    source.onended = null;
  });
  const timer = window.setTimeout(() => {
    disposeGraph(graph);
    state.retiredGraphs = state.retiredGraphs.filter((item) => item.graph !== graph);
  }, Math.max(0, seconds * 1000 + 80));
  state.retiredGraphs.push({ graph, timer });
}

function disposeGraph(graph) {
  if (!graph || graph.disposed) return;
  graph.disposed = true;
  const sources = graph.sources || [graph.source];
  sources.forEach((source) => {
    if (!source) return;
    try {
      source.onended = null;
      source.stop();
    } catch (stopError) {
      // 이미 정지된 소스에 stop()이 다시 호출되어도 정리 과정은 계속한다.
    }
    try {
      source.disconnect();
    } catch (disconnectError) {
      // 이미 연결이 해제된 소스도 있으므로 정리 중 발생하는 예외는 무시한다.
    }
  });
  disconnectGraph(graph);
  graph.previousLiveScores = {};
  graph.livePowerData = null;
  graph.livePowerPrefixData = null;
  graph.frequencyData = null;
  graph.timeData = null;
  graph.stemAnalysisMeters = null;
  graph.spatialLayer = null;
}

function stopPlayback(options = {}) {
  const { keepOffset = false, silent = false } = options;
  state.retiredGraphs.forEach((item) => {
    window.clearTimeout(item.timer);
    disposeGraph(item.graph);
  });
  state.retiredGraphs = [];
  if (state.graph) {
    disposeGraph(state.graph);
    state.graph = null;
  }
  if (state.animationId) {
    cancelAnimationFrame(state.animationId);
    state.animationId = 0;
  }
  state.lastMeterFrameTime = -1;
  state.lastStemDisplayFrameTime = -1;
  state.lastFieldDisplayFrameTime = -1;
  state.lastSpectrumFrameTime = -1;
  state.lastSeekFrameTime = -1;
  state.lastVisualFrameAt = 0;
  resetLiveAnalysisCache();
  if (!keepOffset) {
    state.offset = 0;
    Object.keys(state.meterLevels).forEach((id) => {
      state.meterLevels[id] = 0;
    });
    Object.keys(state.fieldLevels).forEach((id) => {
      state.fieldLevels[id] = 0;
    });
  }
  state.playing = false;
  refs.playButton.textContent = "▶";
  if (!silent) {
    drawWaveform(state.offset);
    if (state.mode === "original") {
      setRealtimeMetersToZero(state.offset);
      updateSpectrumDisplay(state.offset, { zero: true });
    } else {
      updateRealtimeDisplay(state.offset);
      updateSpectrumDisplay(state.offset, { zero: true });
    }
    updateSeek(state.offset, { force: true });
  }
}

function createPlaybackGraph(context, buffer, analysis, mode) {
  if (mode === "spatial") {
    const cached = state.spatialRenderCache.get(getSpatialRenderCacheKey());
    if (cached?.buffer) return createCachedSpatialPlaybackGraph(context, cached.buffer);
    return createSpatialPlaybackGraph(context, buffer, analysis);
  }
  return createOriginalPlaybackGraph(context, buffer, analysis);
}

function getSpatialRenderCacheKey() {
  if (!state.audioBuffer || !state.file) return "";
  const settings = state.spatialSettings;
  const calibration = state.spatialOutputCalibration;
  return [
    SPATIAL_RENDER_PIPELINE_VERSION,
    state.file.name,
    state.file.size,
    state.file.lastModified || 0,
    state.audioBuffer.sampleRate,
    state.hrtfProfileId,
    state.playbackDeviceProfileId,
    state.brirProfileId,
    settings.wet.toFixed(4),
    settings.radius.toFixed(4),
    settings.reflections.toFixed(4),
    Number(calibration?.gain || 1).toFixed(5),
    Number(calibration?.widthScale || 1).toFixed(4),
    Number(calibration?.roomScale || 1).toFixed(4),
    Number(calibration?.lateralScale || 1).toFixed(4),
    state.audioQualityTier
  ].join(":");
}

function invalidateSpatialRenderCache() {
  cancelSpatialRenderCache({ silent: true });
  state.spatialRenderCache.clear();
  state.spatialRenderCacheStatus = "idle";
  updateSpatialRenderCacheUi();
}

function queueSpatialRenderCache() {
  const key = getSpatialRenderCacheKey();
  if (!key || !state.analysis || !window.OfflineAudioContext || state.spatialRenderCache.has(key)) return;
  const buffer = state.audioBuffer;
  const tailSeconds = hasMeasuredBrirLibrary() ? Math.min(3.4, state.measuredBrirBuffer.duration + 0.4) : 1.8;
  const frames = Math.ceil((buffer.duration + tailSeconds) * buffer.sampleRate);
  const estimatedBytes = frames * 2 * 4;
  if (estimatedBytes > SPATIAL_RENDER_CACHE_MAX_BYTES) {
    state.spatialRenderCacheStatus = "realtime-only";
    updateSpatialRenderCacheUi();
    return;
  }
  const revision = ++state.spatialRenderCacheRevision;
  state.spatialRenderCacheStatus = "restoring";
  state.spatialRenderCacheProgress = 0;
  updateSpatialRenderCacheUi();
  restorePersistentSpatialCache(key).then((restored) => {
    if (revision !== state.spatialRenderCacheRevision || key !== getSpatialRenderCacheKey()) return;
    if (restored) {
      state.spatialRenderCache.set(key, { buffer: restored, createdAt: Date.now(), persistent: true });
      state.spatialRenderCacheStatus = "ready";
      state.spatialRenderCacheProgress = 100;
      updateSpatialRenderCacheUi();
      return;
    }
    state.spatialRenderCacheStatus = "queued";
    updateSpatialRenderCacheUi();
    scheduleSpatialRenderCacheBuild(key, revision, frames, 8000);
  }).catch((error) => {
    console.warn("Persistent render cache lookup failed; continuing with memory cache.", error);
    if (revision !== state.spatialRenderCacheRevision) return;
    state.spatialRenderCacheStatus = "queued";
    updateSpatialRenderCacheUi();
    scheduleSpatialRenderCacheBuild(key, revision, frames, 8000);
  });
}

function scheduleSpatialRenderCacheBuild(key, revision, frameCount, delayMs = 5000) {
  window.clearTimeout(state.spatialRenderTimer);
  state.spatialRenderTimer = window.setTimeout(() => {
    if (revision !== state.spatialRenderCacheRevision || key !== getSpatialRenderCacheKey()) return;
    if (state.playing) {
      // 실시간 오디오와 오프라인 렌더가 CPU를 경쟁하지 않도록 정지 상태까지 미룬다.
      state.spatialRenderCacheStatus = "queued";
      updateSpatialRenderCacheUi();
      scheduleSpatialRenderCacheBuild(key, revision, frameCount, 5000);
      return;
    }
    const renderPromise = renderSpatialPlaybackCache(key, revision, frameCount);
    state.spatialRenderPromise = renderPromise;
    renderPromise.catch((error) => {
      if (revision !== state.spatialRenderCacheRevision) return;
      console.warn("HQ spatial render cache unavailable; real-time DSP remains active.", error);
      state.spatialRenderCacheStatus = "realtime-only";
      updateSpatialRenderCacheUi();
    }).finally(() => {
      if (state.spatialRenderPromise === renderPromise) state.spatialRenderPromise = null;
    });
  }, Math.max(250, delayMs));
}

async function renderSpatialPlaybackCache(key, revision, frameCount) {
  if (revision !== state.spatialRenderCacheRevision || key !== getSpatialRenderCacheKey()) return;
  if (state.playing) {
    scheduleSpatialRenderCacheBuild(key, revision, frameCount, 5000);
    return;
  }
  state.spatialRenderCacheStatus = "rendering";
  state.spatialRenderCacheProgress = 2;
  updateSpatialRenderCacheUi();
  const context = new window.OfflineAudioContext(2, frameCount, state.audioBuffer.sampleRate);
  state.spatialRenderContext = context;
  const graph = createSpatialPlaybackGraph(context, state.audioBuffer, state.analysis);
  const expectedSeconds = Math.max(4, state.audioBuffer.duration * 0.12);
  const progressStartedAt = performance.now();
  state.spatialRenderProgressTimer = window.setInterval(() => {
    const elapsed = (performance.now() - progressStartedAt) / 1000;
    state.spatialRenderCacheProgress = clamp(2 + elapsed / expectedSeconds * 88, 2, 90);
    updateSpatialRenderCacheUi();
  }, 300);
  try {
    startGraphSources(graph, 0);
    const rendered = await context.startRendering();
    if (revision !== state.spatialRenderCacheRevision || key !== getSpatialRenderCacheKey()) return;
    state.spatialRenderCache.set(key, { buffer: rendered, createdAt: Date.now() });
    while (state.spatialRenderCache.size > SPATIAL_RENDER_CACHE_MAX_ENTRIES) {
      state.spatialRenderCache.delete(state.spatialRenderCache.keys().next().value);
    }
    state.spatialRenderCacheProgress = 96;
    updateSpatialRenderCacheUi();
    persistSpatialRenderCache(key, rendered).catch((error) => {
      console.warn("Persistent HQ cache write failed; memory cache remains ready.", error);
    });
    state.spatialRenderCacheStatus = "ready";
    state.spatialRenderCacheProgress = 100;
    updateSpatialRenderCacheUi();
  } finally {
    window.clearInterval(state.spatialRenderProgressTimer);
    state.spatialRenderProgressTimer = 0;
    if (state.spatialRenderContext === context) state.spatialRenderContext = null;
    disconnectGraph(graph);
  }
}

function cancelSpatialRenderCache(options = {}) {
  state.spatialRenderCacheRevision += 1;
  window.clearTimeout(state.spatialRenderTimer);
  window.clearInterval(state.spatialRenderProgressTimer);
  state.spatialRenderTimer = 0;
  state.spatialRenderProgressTimer = 0;
  if (state.spatialRenderContext?.state === "running") {
    state.spatialRenderContext.suspend?.().catch(() => {});
  }
  state.spatialRenderContext = null;
  state.spatialRenderCacheStatus = "idle";
  state.spatialRenderCacheProgress = 0;
  updateSpatialRenderCacheUi();
  if (!options.silent) showToast("HQ 사전 렌더를 취소했습니다. 실시간 DSP는 계속 사용할 수 있습니다.");
}

function openSpatialCacheDatabase() {
  if (!window.indexedDB) return Promise.resolve(null);
  if (state.spatialCacheDatabasePromise) return state.spatialCacheDatabasePromise;
  state.spatialCacheDatabasePromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(SPATIAL_CACHE_DB_NAME, SPATIAL_CACHE_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("renders")) database.createObjectStore("renders", { keyPath: "key" });
      if (!database.objectStoreNames.contains("chunks")) database.createObjectStore("chunks", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
  });
  return state.spatialCacheDatabasePromise;
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

async function restorePersistentSpatialCache(key) {
  const database = await openSpatialCacheDatabase();
  if (!database) return null;
  const metadataTransaction = database.transaction("renders", "readonly");
  const metadata = await idbRequest(metadataTransaction.objectStore("renders").get(key));
  if (!metadata?.chunkCount) return null;
  const chunkTransaction = database.transaction("chunks", "readonly");
  const requests = [];
  for (let index = 0; index < metadata.chunkCount; index += 1) {
    requests.push(idbRequest(chunkTransaction.objectStore("chunks").get(`${key}:${index}`)));
  }
  const records = await Promise.all(requests);
  if (records.some((record) => !record?.blob)) return null;
  const chunks = records.map((record) => record.blob);
  const blob = new Blob(chunks, { type: "audio/wav" });
  const context = await ensureAudioContext();
  const decoded = await context.decodeAudioData((await blob.arrayBuffer()).slice(0));
  metadata.lastAccess = Date.now();
  database.transaction("renders", "readwrite").objectStore("renders").put(metadata);
  return decoded;
}

async function persistSpatialRenderCache(key, rendered) {
  const database = await openSpatialCacheDatabase();
  if (!database) return;
  const blob = encodeWaveBlob(rendered, { bitDepth: 32, float: true, gain: 1 });
  const chunkCount = Math.ceil(blob.size / SPATIAL_CACHE_CHUNK_BYTES);
  const transaction = database.transaction(["renders", "chunks"], "readwrite");
  const renders = transaction.objectStore("renders");
  const chunks = transaction.objectStore("chunks");
  renders.put({ key, chunkCount, bytes: blob.size, createdAt: Date.now(), lastAccess: Date.now() });
  for (let index = 0; index < chunkCount; index += 1) {
    chunks.put({
      id: `${key}:${index}`,
      key,
      index,
      blob: blob.slice(index * SPATIAL_CACHE_CHUNK_BYTES, (index + 1) * SPATIAL_CACHE_CHUNK_BYTES)
    });
  }
  await new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
  });
  await prunePersistentSpatialCache(database);
}

async function prunePersistentSpatialCache(database) {
  const transaction = database.transaction("renders", "readonly");
  const records = await idbRequest(transaction.objectStore("renders").getAll());
  records.sort((a, b) => (b.lastAccess || b.createdAt) - (a.lastAccess || a.createdAt));
  let retainedBytes = 0;
  const remove = [];
  records.forEach((record) => {
    retainedBytes += Number(record.bytes) || 0;
    if (retainedBytes > SPATIAL_CACHE_PERSISTENT_MAX_BYTES || records.indexOf(record) >= 4) remove.push(record);
  });
  for (const record of remove) await deletePersistentSpatialCacheEntry(database, record);
}

async function deletePersistentSpatialCacheEntry(database, record) {
  const transaction = database.transaction(["renders", "chunks"], "readwrite");
  transaction.objectStore("renders").delete(record.key);
  for (let index = 0; index < record.chunkCount; index += 1) {
    transaction.objectStore("chunks").delete(`${record.key}:${index}`);
  }
  await new Promise((resolve) => { transaction.oncomplete = resolve; transaction.onabort = resolve; });
}

function createCachedSpatialPlaybackGraph(context, buffer) {
  const source = context.createBufferSource();
  const master = context.createGain();
  const stemAnalysisMeters = { byId: {}, nodes: [] };
  const meterSources = [];
  source.buffer = buffer;
  master.gain.value = 1;
  source.connect(master).connect(context.destination);
  const liveMeter = createLiveInstrumentMeter(context, master);
  getSpatialStemItems(state.analysis).forEach((stem) => {
    const stemSource = context.createBufferSource();
    stemSource.buffer = stem.buffer;
    stemSource.spatialAlignmentOffsetSeconds = Number(stem.alignmentOffsetSeconds) || 0;
    const meter = createStemMeterTap(context, stemSource);
    stemAnalysisMeters.byId[stem.id] = meter;
    stemAnalysisMeters.nodes.push(...meter.nodes);
    meterSources.push(stemSource);
  });
  return {
    mode: "spatial",
    source,
    sources: [source, ...meterSources],
    master,
    outputGainScale: 1,
    analyser: liveMeter.analyser,
    frequencyData: liveMeter.frequencyData,
    timeData: liveMeter.timeData,
    previousLiveScores: {},
    stemAnalysisMeters,
    spatialLayer: {
      cached: true,
      stemAnalysisMeters,
      stemObjects: [],
      transientControls: []
    },
    cachedSpatial: true,
    nodes: [master, ...liveMeter.nodes, ...stemAnalysisMeters.nodes]
  };
}

function updateSpatialRenderCacheUi() {
  const labels = {
    idle: "실시간",
    restoring: "캐시 확인",
    queued: "대기",
    rendering: "HQ 렌더링",
    ready: "HQ 캐시 준비",
    "realtime-only": "실시간 DSP"
  };
  setText(refs.spatialCacheStatus, labels[state.spatialRenderCacheStatus] || "실시간");
  setText(refs.spatialCacheDetail, state.spatialRenderCacheStatus === "ready"
    ? "동일 설정 재생·내보내기에 재사용"
    : (state.spatialRenderCacheStatus === "realtime-only" ? "메모리 보호 기준 적용" : "음질 저하 없는 오프라인 렌더"));
  const active = ["restoring", "queued", "rendering"].includes(state.spatialRenderCacheStatus);
  if (refs.spatialCacheProgress) {
    refs.spatialCacheProgress.hidden = !active;
    refs.spatialCacheProgress.value = Math.round(state.spatialRenderCacheProgress || 0);
  }
  if (refs.spatialCacheCancel) refs.spatialCacheCancel.hidden = !active;
}

function createDeviceCorrectionChain(context, profile = getPlaybackDeviceProfile()) {
  const input = context.createGain();
  const preamp = context.createGain();
  const filters = [];
  preamp.gain.value = dbToGain(Number(profile.preampDb) || 0);
  input.connect(preamp);
  let output = preamp;
  for (const definition of profile.filters || []) {
    const filter = context.createBiquadFilter();
    filter.type = definition.type;
    filter.frequency.value = clamp(Number(definition.frequency) || 1000, 20, context.sampleRate * 0.48);
    filter.gain.value = clamp(Number(definition.gain) || 0, -12, 12);
    filter.Q.value = clamp(Number(definition.q) || 0.707, 0.1, 12);
    output.connect(filter);
    filters.push(filter);
    output = filter;
  }
  return {
    input,
    output,
    preamp,
    filters,
    profile,
    nodes: [input, preamp, ...filters]
  };
}

function createPassthroughOutputChain(context, analysis, mode = "spatial") {
  const input = context.createGain();
  const deviceCorrection = createDeviceCorrectionChain(context);
  const peakTrim = context.createGain();
  const peakGuard = context.createDynamicsCompressor();
  const master = context.createGain();
  const outputGainScale = 1;
  const peakGuardPreGain = getSpatialOutputPeakGuardPreGain(state.spatialSettings, analysis);
  const loudnessMatchGain = getSpatialLoudnessMatchGain(state.spatialSettings, analysis);
  const truePeakHeadroomGain = getSpatialTruePeakHeadroomGain(state.playbackCalibration, analysis);
  const requestedCalibrationGain = Number(state.spatialOutputCalibration?.gain);
  const processedOutputGain = clamp(Number.isFinite(requestedCalibrationGain) ? requestedCalibrationGain : 1, 0.5, 4.5);
  const predictiveSafetyGain = Math.min(peakGuardPreGain, loudnessMatchGain, truePeakHeadroomGain);
  const calibratedOutputGain = clamp(predictiveSafetyGain * processedOutputGain, 0.35, 4.5);
  peakTrim.gain.value = calibratedOutputGain;
  peakGuard.threshold.value = SPATIAL_OUTPUT_PEAK_GUARD_THRESHOLD_DB;
  peakGuard.knee.value = SPATIAL_OUTPUT_PEAK_GUARD_KNEE_DB;
  peakGuard.ratio.value = SPATIAL_OUTPUT_PEAK_GUARD_RATIO;
  peakGuard.attack.value = SPATIAL_OUTPUT_PEAK_GUARD_ATTACK;
  peakGuard.release.value = SPATIAL_OUTPUT_PEAK_GUARD_RELEASE;
  master.gain.value = outputGainScale;
  input.connect(deviceCorrection.input);
  deviceCorrection.output.connect(peakTrim).connect(peakGuard).connect(master);
  master.connect(context.destination);

  const liveMeter = createLiveInstrumentMeter(context, master);
  return {
    mode,
    outputGainScale,
    peakGuardPreGain,
    loudnessMatchGain,
    truePeakHeadroomGain,
    processedOutputGain,
    predictiveSafetyGain,
    calibratedOutputGain,
    input,
    deviceCorrection,
    peakTrim,
    peakGuard,
    master,
    liveMeter,
    nodes: [input, ...deviceCorrection.nodes, peakTrim, peakGuard, master, ...liveMeter.nodes]
  };
}

function createOriginalPlaybackGraph(context, buffer, analysis) {
  const source = context.createBufferSource();
  const master = context.createGain();
  source.buffer = buffer;
  master.gain.value = 1;
  source.connect(master).connect(context.destination);
  const liveMeter = createLiveInstrumentMeter(context, master);

  return {
    mode: "original",
    source,
    sources: [source],
    master,
    outputGainScale: 1,
    analyser: liveMeter.analyser,
    frequencyData: liveMeter.frequencyData,
    timeData: liveMeter.timeData,
    previousLiveScores: {},
    nodes: [master, ...liveMeter.nodes]
  };
}

function createSpatialPlaybackGraph(context, buffer, analysis, options = {}) {
  const source = context.createBufferSource();
  source.buffer = buffer;
  const output = createPassthroughOutputChain(context, analysis, "spatial");
  const spatialLayer = createFullSpatialLayer(context, {
    mixSource: source,
    mixBuffer: buffer,
    output: output.input,
    analysis,
    ignoreStems: options.ignoreStems === true
  });

  return {
    mode: "spatial",
    source,
    sources: [source, ...spatialLayer.sources],
    master: output.master,
    outputGainScale: output.outputGainScale,
    loudnessMatchGain: output.loudnessMatchGain,
    truePeakHeadroomGain: output.truePeakHeadroomGain,
    processedOutputGain: output.processedOutputGain,
    predictiveSafetyGain: output.predictiveSafetyGain,
    calibratedOutputGain: output.calibratedOutputGain,
    peakGuardPreGain: output.peakGuardPreGain,
    analyser: output.liveMeter.analyser,
    frequencyData: output.liveMeter.frequencyData,
    timeData: output.liveMeter.timeData,
    stemAnalysisMeters: spatialLayer.stemAnalysisMeters,
    previousLiveScores: {},
    spatialLayer,
    nodes: [...spatialLayer.nodes, ...output.nodes]
  };
}

function createFullSpatialLayer(context, options) {
  const { mixSource, mixBuffer, output, analysis } = options;
  const stemItems = options.ignoreStems ? [] : getSpatialStemItems(analysis);
  const measuredBrir = hasMeasuredBrirLibrary();
  const mixtureProfile = getMixtureConsistencyProfile(mixBuffer, stemItems);
  const audioQuality = getAudioQualityProfile();
  const deviceProfile = getPlaybackDeviceProfile();
  const roomProfile = getBrirLibraryEntry();
  const distanceProfile = getSpatialDistanceBrirProfile(state.spatialSettings.radius);
  const deviceWetScale = clamp(Number(deviceProfile.wetScale) || 1, 0.6, 1);
  const deviceLateralScale = clamp(Number(deviceProfile.lateralScale) || 1, 0.5, 1);
  const calibratedWidthScale = clamp(Number(state.spatialOutputCalibration?.widthScale) || 1, 0.62, 1);
  const qaRoomScale = clamp(Number(state.spatialOutputCalibration?.roomScale) || 1, 0.82, 1);
  const qaLateralScale = clamp(Number(state.spatialOutputCalibration?.lateralScale) || 1, 0.78, 1);
  const directBus = context.createGain();
  const roomMaster = context.createGain();
  const roomLowGuard = context.createBiquadFilter();
  const roomAirGuard = context.createBiquadFilter();
  const roomResponseEq = createSpatialRoomResponseEq(context, deviceProfile);
  const reflectionBus = context.createGain();
  const lateralBus = context.createGain();
  const externalizationBus = context.createGain();
  const orchestralHallBus = context.createGain();
  const venueTailBus = context.createGain();
  const sceneSum = context.createGain();
  const residualSum = context.createGain();
  const residualPrimaryBus = context.createGain();
  const sources = [];
  const nodes = [
    directBus,
    roomMaster,
    roomLowGuard,
    roomAirGuard,
    ...roomResponseEq.filters,
    reflectionBus,
    lateralBus,
    externalizationBus,
    orchestralHallBus,
    venueTailBus,
    sceneSum,
    residualSum,
    residualPrimaryBus
  ];
  const stemObjects = [];
  const transientControls = [];
  const stemExternalizations = [];
  const residualCancellationGains = [];
  const stemAnalysisMeters = { byId: {}, nodes: [] };

  directBus.gain.value = 0.86;
  roomMaster.gain.value = getSpatialWetGain(state.spatialSettings) * 0.82 * audioQuality.roomScale *
    deviceWetScale * qaRoomScale;
  roomLowGuard.type = "highpass";
  roomLowGuard.frequency.value = SPATIAL_RESEARCH_PROFILE.wetHighpassHz;
  roomLowGuard.Q.value = 0.5;
  roomAirGuard.type = "lowpass";
  roomAirGuard.frequency.value = SPATIAL_RESEARCH_PROFILE.wetLowpassHz;
  roomAirGuard.Q.value = 0.35;
  reflectionBus.gain.value = 0.78 * state.spatialSettings.reflections;
  lateralBus.gain.value = 1.25 * state.spatialSettings.radius * deviceLateralScale *
    calibratedWidthScale * qaLateralScale;
  externalizationBus.gain.value = 0.9 * (0.72 + state.spatialSettings.radius * 0.18) * deviceWetScale;
  orchestralHallBus.gain.value = 0.82 * (0.65 + state.spatialSettings.reflections * 0.35) * deviceWetScale;
  venueTailBus.gain.value = measuredBrir
    ? 0.34 * state.spatialSettings.reflections * deviceWetScale * distanceProfile.gainScale *
      (roomProfile?.roomClass === "small" ? 0.76 :
        (roomProfile?.roomClass === "concert" || roomProfile?.roomClass === "tall" ? 1.06 : 0.92))
    : 0;
  sceneSum.gain.value = 0.86;
  residualPrimaryBus.gain.value = 1;

  directBus.connect(output);
  residualPrimaryBus.connect(directBus);
  reflectionBus.connect(roomMaster);
  lateralBus.connect(roomMaster);
  externalizationBus.connect(roomMaster);
  orchestralHallBus.connect(roomMaster);
  venueTailBus.connect(roomMaster);
  roomMaster.connect(roomLowGuard).connect(roomResponseEq.input);
  roomResponseEq.output.connect(roomAirGuard).connect(output);

  let residualPrimary;
  if (stemItems.length) {
    mixSource.connect(residualSum);
    stemItems.forEach((stem) => {
      const stemSource = context.createBufferSource();
      const sceneSend = context.createGain();
      const cancellation = context.createGain();
      const spatialConfidence = getStemObjectQualityGain(stem);
      const roomSceneScale = getStemRoomSceneScale(stem);
      stemSource.buffer = stem.buffer;
      stemSource.spatialAlignmentOffsetSeconds = Number(stem.alignmentOffsetSeconds) || 0;
      sceneSend.gain.value = mixtureProfile.stemScale * roomSceneScale;
      cancellation.gain.value = -mixtureProfile.stemScale;
      sources.push(stemSource);
      nodes.push(sceneSend, cancellation);
      residualCancellationGains.push(cancellation);

      const meter = createStemMeterTap(context, stemSource);
      nodes.push(...meter.nodes);
      stemAnalysisMeters.byId[stem.id] = meter;

      const directObject = createFullSpatialStemDirectLayer(
        context,
        stemSource,
        stem,
        directBus,
        mixtureProfile.stemScale
      );
      const reflections = createFullSpatialStemReflectionLayer(context, stemSource, stem, reflectionBus);
      if (reflections.transientControl) transientControls.push(reflections.transientControl);
      const stemExternalization = createExternalizedPerimeterLayer(context, stemSource, externalizationBus, {
        channelCount: stem.buffer?.numberOfChannels || 2,
        stemId: stem.id,
        spatialConfidence
      });
      stemSource.connect(sceneSend).connect(sceneSum);
      stemSource.connect(cancellation).connect(residualSum);
      nodes.push(...directObject.nodes, ...reflections.nodes, ...stemExternalization.nodes);
      stemExternalizations.push(stemExternalization);
      stemObjects.push({
        ...directObject,
        reflections,
        externalization: stemExternalization,
        sceneSend,
        roomSceneScale,
        spatialConfidence
      });
    });

    residualPrimary = createPhasePreservingStereoPrimaryLayer(
      context,
      residualSum,
      residualPrimaryBus,
      1,
      "mixture-residual"
    );
    residualSum.connect(sceneSum);
    nodes.push(...residualPrimary.nodes);
  } else {
    sceneSum.gain.value = 0.7;
    residualPrimaryBus.gain.value = 1;
    residualPrimary = createPhasePreservingStereoPrimaryLayer(
      context,
      mixSource,
      residualPrimaryBus,
      1,
      "full-mix-fallback",
      mixBuffer?.numberOfChannels || 2
    );
    mixSource.connect(sceneSum);
    nodes.push(...residualPrimary.nodes);
  }

  const field = createDiffuseFieldLayer(context, sceneSum, reflectionBus, { measuredBrir, distanceProfile });
  const lateral = createLateralSideExpansionLayer(context, sceneSum, lateralBus, { analysis, channelCount: 2 });
  const externalization = stemItems.length
    ? {
        layers: stemExternalizations,
        taps: stemExternalizations.flatMap((layer) => layer.taps),
        radiusRange: [3, 4],
        symmetric: true,
        nodes: []
      }
    : createExternalizedPerimeterLayer(context, sceneSum, externalizationBus, { channelCount: 2 });
  const orchestralHall = createOrchestralHallEarlyLayer(context, sceneSum, orchestralHallBus, {
    measuredBrir,
    channelCount: 2,
    distanceProfile
  });
  const venueTail = measuredBrir
    ? createMeasuredVenueTailLayer(context, sceneSum, venueTailBus, state.measuredBrirBuffer, {
        profile: "orchestral",
        roomProfile,
        distanceProfile
      })
    : createEmptySpatialLayer();
  nodes.push(...field.nodes, ...lateral.nodes, ...externalization.nodes, ...orchestralHall.nodes, ...venueTail.nodes);
  const analysisWorklet = createSpatialAnalysisWorkletTap(context, sceneSum);
  nodes.push(...analysisWorklet.nodes);

  return {
    sources,
    nodes,
    directBus,
    wetMaster: roomMaster,
    baseWetGain: roomMaster.gain.value,
    roomLowGuard,
    roomAirGuard,
    roomResponseEq,
    distanceProfile,
    roomProfile,
    reflectionBus,
    lateralBus,
    externalizationBus,
    orchestralHallBus,
    venueTailBus,
    sceneSum,
    residualSum,
    residualPrimary,
    residualCancellationGains,
    mixtureProfile,
    stemObjects,
    transientControls,
    stemAnalysisMeters,
    field,
    lateral,
    externalization,
    orchestralHall,
    venueTail,
    analysisWorklet,
    usesOriginalAnchor: false,
    originalAnchorSend: null,
    fullBandAnchorBus: null,
    fullSpatial: true,
    audioQuality,
    deviceProfile,
    qaRoomScale,
    qaLateralScale
  };
}

function createSpatialAnalysisWorkletTap(context, source) {
  if (
    context !== state.audioContext ||
    state.spatialWorkletStatus !== "ready" ||
    typeof window.AudioWorkletNode !== "function"
  ) {
    return { active: false, nodes: [] };
  }
  try {
    const node = new window.AudioWorkletNode(context, "spatial-analysis-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    });
    const silent = context.createGain();
    silent.gain.value = 0;
    source.connect(node).connect(silent).connect(context.destination);
    node.port.onmessage = (event) => {
      if (event.data?.type !== "spatial-analysis") return;
      state.spatialWorkletMetrics = event.data;
      if (event.data.transient) applyLiveWorkletTransientDuck(event.data.transientStrength);
    };
    return { active: true, node, silent, nodes: [node, silent] };
  } catch (error) {
    console.warn("Spatial AudioWorklet node creation failed.", error);
    return { active: false, nodes: [] };
  }
}

function applyLiveWorkletTransientDuck(strength) {
  if (!state.playing || state.mode !== "spatial" || !state.audioContext) return;
  const now = state.audioContext.currentTime;
  const safeStrength = clamp(Number(strength) || 0, 0, 1);
  (state.graph?.spatialLayer?.transientControls || []).forEach((control) => {
    const parameter = control.gainNode?.gain;
    if (!parameter?.setValueAtTime) return;
    const floor = clamp(1 - (1 - control.duckFloor) * safeStrength, control.duckFloor, 0.94);
    parameter.setValueAtTime(parameter.value, now);
    parameter.linearRampToValueAtTime?.(floor, now + 0.004);
    parameter.setTargetAtTime?.(1, now + 0.018, Math.max(0.025, control.recoverySeconds * 0.35));
  });
}

function getMixtureConsistencyProfile(referenceBuffer, stemItems = []) {
  if (!referenceBuffer || !stemItems.length) {
    return { stemScale: 1, residualRatio: 1, reliable: false, sampleCount: 0 };
  }
  const channelCount = Math.min(2, Math.max(1, referenceBuffer.numberOfChannels || 1));
  const length = Math.min(
    referenceBuffer.length,
    ...stemItems.map((stem) => (
      (stem.buffer?.length || referenceBuffer.length) - Math.abs(Number(stem.alignmentSamples) || 0)
    ))
  );
  const step = Math.max(1, Math.ceil((length * channelCount) / FULL_SPATIAL_RESIDUAL_SAMPLE_LIMIT));
  let dot = 0;
  let stemPower = 0;
  let referencePower = 0;
  let sampleCount = 0;

  for (let channel = 0; channel < channelCount; channel += 1) {
    const reference = referenceBuffer.getChannelData(Math.min(channel, referenceBuffer.numberOfChannels - 1));
    const stemChannels = stemItems.map((stem) => {
      const buffer = stem.buffer;
      return {
        data: buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1)),
        lag: Number(stem.alignmentSamples) || 0
      };
    });
    for (let index = 0; index < length; index += step) {
      let stemSum = 0;
      for (let stemIndex = 0; stemIndex < stemChannels.length; stemIndex += 1) {
        const stemChannel = stemChannels[stemIndex];
        stemSum += stemChannel.data[index + stemChannel.lag] || 0;
      }
      const referenceValue = reference[index] || 0;
      dot += referenceValue * stemSum;
      stemPower += stemSum * stemSum;
      referencePower += referenceValue * referenceValue;
      sampleCount += 1;
    }
  }

  const rawScale = stemPower > 1e-12 ? dot / stemPower : 1;
  const stemScale = clamp(rawScale, FULL_SPATIAL_MIXTURE_SCALE_MIN, FULL_SPATIAL_MIXTURE_SCALE_MAX);
  let residualPower = 0;
  for (let channel = 0; channel < channelCount; channel += 1) {
    const reference = referenceBuffer.getChannelData(Math.min(channel, referenceBuffer.numberOfChannels - 1));
    const stemChannels = stemItems.map((stem) => {
      const buffer = stem.buffer;
      return {
        data: buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1)),
        lag: Number(stem.alignmentSamples) || 0
      };
    });
    for (let index = 0; index < length; index += step) {
      let stemSum = 0;
      for (let stemIndex = 0; stemIndex < stemChannels.length; stemIndex += 1) {
        const stemChannel = stemChannels[stemIndex];
        stemSum += stemChannel.data[index + stemChannel.lag] || 0;
      }
      const residual = (reference[index] || 0) - stemScale * stemSum;
      residualPower += residual * residual;
    }
  }
  const residualRatio = Math.sqrt(residualPower / Math.max(referencePower, 1e-12));
  return {
    stemScale,
    residualRatio,
    reliable: residualRatio < 0.65,
    sampleCount
  };
}

function createFullSpatialStemDirectLayer(context, input, stem, output, mixtureScale = 1) {
  const channelCount = Math.max(1, stem.buffer?.numberOfChannels || 1);
  const primary = createPhasePreservingStereoPrimaryLayer(
    context,
    input,
    output,
    mixtureScale,
    stem.id,
    channelCount
  );
  return {
    id: stem.id,
    qualityGain: 1,
    phasePreserving: true,
    channelCount,
    directGain: mixtureScale,
    primaryPaths: primary.primaryPaths,
    lowBand: null,
    nodes: primary.nodes
  };
}

function createFullSpatialStemReflectionLayer(context, input, stem, output) {
  const route = STEM_OBJECT_ROUTES[stem.id] || STEM_OBJECT_ROUTES.other;
  const send = context.createGain();
  const transientSend = context.createGain();
  const highpass = context.createBiquadFilter();
  const lowpass = context.createBiquadFilter();
  const nodes = [send, transientSend, highpass, lowpass];
  const taps = [];
  const quality = getAudioQualityProfile();
  const fullTapPlan = getSymmetricStemReflectionTapPlan(route.taps);
  const retainedTapRatio = quality.id === "full" ? 1 : (quality.id === "balanced" ? 0.75 : 0.5);
  const retainedTapCount = Math.max(2, Math.ceil(fullTapPlan.length * retainedTapRatio / 2) * 2);
  const tapPlan = fullTapPlan.slice(0, retainedTapCount);
  send.gain.value = route.send * getStemObjectQualityGain(stem) * 0.72 * quality.stemReflectionScale;
  transientSend.gain.value = 1;
  highpass.type = "highpass";
  highpass.frequency.value = Math.max(route.diffuseHighpass || route.highpass, 320);
  highpass.Q.value = 0.5;
  lowpass.type = "lowpass";
  lowpass.frequency.value = route.lowpass;
  lowpass.Q.value = 0.4;
  input.connect(send).connect(transientSend).connect(highpass).connect(lowpass);

  const compositeEntries = tapPlan.map((tap, index) => ({
    position: tap,
    delaySeconds: tap.delay,
    gain: tap.gain,
    rendererOptions: {
      role: "objectRoom",
      seed: STEM_ORDER.indexOf(stem.id) * 19 + index + 503,
      forceSynthetic: false
    }
  }));
  const composite = createCompositeDirectionalRenderer(
    context,
    compositeEntries,
    `stem-reflections-${stem.id}`
  );
  if (composite) {
    lowpass.connect(composite.node).connect(output);
    tapPlan.forEach((tap) => {
      taps.push({
        ...tap,
        delayNode: { delayTime: { value: tap.delay } },
        gainNode: { gain: { value: tap.gain } },
        renderer: composite.node,
        rendererMode: composite.mode
      });
    });
    nodes.push(composite.node);
  } else {
    tapPlan.forEach((tap, index) => {
      const delay = context.createDelay(0.08);
      const gain = context.createGain();
      const renderer = createReferenceHrtfRenderer(context, tap, {
        role: "objectRoom",
        seed: STEM_ORDER.indexOf(stem.id) * 19 + index + 503,
        forceSynthetic: false
      });
      delay.delayTime.value = tap.delay;
      gain.gain.value = tap.gain;
      lowpass.connect(delay).connect(gain).connect(renderer.node).connect(output);
      taps.push({ ...tap, delayNode: delay, gainNode: gain, renderer: renderer.node, rendererMode: renderer.mode });
      nodes.push(delay, gain, renderer.node);
    });
  }
  return {
    send,
    transientSend,
    transientControl: {
      gainNode: transientSend,
      events: state.transientMaps?.[stem.id]?.events || [],
      duckFloor: stem.id === "drums" ? 0.42 : (stem.id === "bass" ? 0.62 : 0.7),
      recoverySeconds: stem.id === "drums" ? 0.13 : 0.18
    },
    highpass,
    lowpass,
    taps,
    compositeRenderer: composite,
    nodes
  };
}

function getSymmetricStemReflectionTapPlan(taps = []) {
  return getCoherentStemTapPlan(taps)
    .filter((tap) => !tap.anchor)
    .flatMap((tap) => {
      const azimuth = Math.abs(normalizeDegrees(tap.azimuth || 0));
      if (azimuth < 4 || azimuth > 176) return [{ ...tap, azimuth: normalizeDegrees(tap.azimuth || 0) }];
      const pairGain = tap.gain * Math.SQRT1_2;
      return [
        { ...tap, id: `${tap.id || "reflection"}-left`, azimuth: -azimuth, gain: pairGain },
        { ...tap, id: `${tap.id || "reflection"}-right`, azimuth, gain: pairGain }
      ];
    });
}

function createPhasePreservingStereoPrimaryLayer(context, input, output, gainValue = 1, id = "primary", channelCount = 2) {
  const gain = context.createGain();
  gain.gain.value = gainValue;
  gain.channelCountMode = "max";
  gain.channelInterpretation = "speakers";
  // 직접음은 분할·지연·재결합 없이 통과시켜 원본 L/R 샘플 위상을 보존한다.
  input.connect(gain).connect(output);
  return {
    id,
    gain,
    phasePreserving: true,
    channelCount,
    primaryPaths: [
      { channel: 0, rendererMode: "native-stereo", delaySeconds: 0 },
      { channel: channelCount > 1 ? 1 : 0, rendererMode: "native-stereo", delaySeconds: 0 }
    ],
    nodes: [gain]
  };
}

function createExternalizedPerimeterLayer(context, input, output, options = {}) {
  const channelCount = Math.max(1, options.channelCount || input?.buffer?.numberOfChannels || 2);
  const splitter = context.createChannelSplitter(2);
  const leftMid = context.createGain();
  const rightMid = context.createGain();
  const mid = context.createGain();
  const send = context.createGain();
  const bodyGuard = context.createBiquadFilter();
  const airGuard = context.createBiquadFilter();
  const nodes = [splitter, leftMid, rightMid, mid, send, bodyGuard, airGuard];
  const taps = [];
  const quality = getAudioQualityProfile();
  const stemPairLimit = quality.id === "full" ? 3 : (quality.id === "balanced" ? 2 : 1);
  const directions = getExternalizationDirections(
    options.stemId,
    options.stemId ? stemPairLimit : quality.perimeterPairs
  );
  const sendByStem = { vocals: 0.11, other: 0.14, drums: 0.14, bass: 0.085 };
  const lateralEarlyScale = SPATIAL_STEM_LATERAL_EARLY_SCALE[options.stemId] || 1;
  const spatialConfidence = clamp(Number(options.spatialConfidence) || 1, 0.42, 1);
  const confidenceSendScale = options.stemId ? clamp(0.65 + spatialConfidence * 0.35, 0.78, 1) : 1;

  leftMid.gain.value = channelCount > 1 ? 0.5 : 1;
  rightMid.gain.value = channelCount > 1 ? 0.5 : 0;
  send.gain.value = (sendByStem[options.stemId] || 0.14) * confidenceSendScale;
  bodyGuard.type = "highpass";
  bodyGuard.frequency.value = options.stemId === "bass" ? 260 : 120;
  bodyGuard.Q.value = 0.5;
  airGuard.type = "lowpass";
  airGuard.frequency.value = 14000;
  airGuard.Q.value = 0.4;

  input.connect(splitter);
  splitter.connect(leftMid, 0).connect(mid);
  if (channelCount > 1) splitter.connect(rightMid, 1).connect(mid);
  mid.connect(send).connect(bodyGuard).connect(airGuard);

  const compositeEntries = directions.map((direction, index) => {
    const azimuth = Math.abs(normalizeDegrees(direction.azimuth || 0));
    const isLateralEarlyReflection = azimuth >= 70 && azimuth <= 110;
    const appliedGainScale = isLateralEarlyReflection ? lateralEarlyScale : 1;
    return {
      position: direction,
      delaySeconds: Math.max(direction.delay, direction.distance / 343),
      gain: direction.gain * appliedGainScale,
      lowpassFrequency: clamp(16000 * Math.exp(-0.09 * direction.distance), 10500, 15000),
      lowpassQ: 0.35,
      rendererOptions: {
        role: "reflection",
        seed: index + 811,
        forceSynthetic: false,
        distanceModel: "inverse",
        refDistance: 1.2,
        rolloffFactor: 0.35
      },
      isLateralEarlyReflection,
      appliedGainScale
    };
  });
  const composite = createCompositeDirectionalRenderer(
    context,
    compositeEntries,
    `externalization-${options.stemId || "mix"}`
  );
  if (composite) {
    airGuard.connect(composite.node).connect(output);
    directions.forEach((direction, index) => {
      const entry = compositeEntries[index];
      taps.push({
        direction,
        delay: { delayTime: { value: entry.delaySeconds } },
        gain: { gain: { value: entry.gain } },
        distanceAir: {
          type: "lowpass",
          frequency: { value: entry.lowpassFrequency },
          Q: { value: entry.lowpassQ }
        },
        renderer: composite.node,
        rendererMode: composite.mode,
        isLateralEarlyReflection: entry.isLateralEarlyReflection,
        appliedGainScale: entry.appliedGainScale
      });
    });
    nodes.push(composite.node);
  } else {
    directions.forEach((direction, index) => {
      const delay = context.createDelay(0.03);
      const gain = context.createGain();
      const distanceAir = context.createBiquadFilter();
      const renderer = createReferenceHrtfRenderer(context, direction, compositeEntries[index].rendererOptions);
      delay.delayTime.value = compositeEntries[index].delaySeconds;
      gain.gain.value = compositeEntries[index].gain;
      distanceAir.type = "lowpass";
      distanceAir.frequency.value = compositeEntries[index].lowpassFrequency;
      distanceAir.Q.value = compositeEntries[index].lowpassQ;
      airGuard.connect(delay).connect(distanceAir).connect(gain).connect(renderer.node).connect(output);
      taps.push({
        direction,
        delay,
        gain,
        distanceAir,
        renderer: renderer.node,
        rendererMode: renderer.mode,
        isLateralEarlyReflection: compositeEntries[index].isLateralEarlyReflection,
        appliedGainScale: compositeEntries[index].appliedGainScale
      });
      nodes.push(delay, distanceAir, gain, renderer.node);
    });
  }

  return {
    send,
    bodyGuard,
    airGuard,
    taps,
    lateralEarlyScale,
    spatialConfidence,
    confidenceSendScale,
    compositeRenderer: composite,
    radiusRange: [3, 4],
    symmetric: true,
    nodes
  };
}

function getExternalizationDirections(stemId, pairLimit = 5) {
  const pairs = [
    FULL_SPATIAL_EXTERNALIZED_PERIMETER_DIRECTIONS.slice(0, 2),
    FULL_SPATIAL_EXTERNALIZED_PERIMETER_DIRECTIONS.slice(2, 4),
    FULL_SPATIAL_EXTERNALIZED_PERIMETER_DIRECTIONS.slice(4, 6),
    FULL_SPATIAL_EXTERNALIZED_PERIMETER_DIRECTIONS.slice(6, 8),
    FULL_SPATIAL_EXTERNALIZED_PERIMETER_DIRECTIONS.slice(8, 10)
  ];
  const pairIndexesByStem = {
    vocals: [0, 3],
    other: [0, 1, 3],
    drums: [1, 2, 4],
    bass: [2, 4]
  };
  const requested = pairIndexesByStem[stemId] || [0, 1, 2, 3, 4];
  return requested.slice(0, Math.max(1, pairLimit)).flatMap((index) => pairs[index]);
}

function createOrchestralHallEarlyLayer(context, input, output, options = {}) {
  const channelCount = Math.max(1, options.channelCount || input?.buffer?.numberOfChannels || 2);
  const splitter = context.createChannelSplitter(2);
  const leftMid = context.createGain();
  const rightMid = context.createGain();
  const mid = context.createGain();
  const send = context.createGain();
  const bodyGuard = context.createBiquadFilter();
  const airGuard = context.createBiquadFilter();
  const nodes = [splitter, leftMid, rightMid, mid, send, bodyGuard, airGuard];
  const taps = [];
  const quality = getAudioQualityProfile();
  const distanceProfile = options.distanceProfile || SPATIAL_DISTANCE_BRIR_PROFILES.mid;
  const directions = selectSymmetricDirectionPairs(
    FULL_SPATIAL_ORCHESTRAL_HALL_DIRECTIONS,
    quality.hallPairs
  );

  leftMid.gain.value = channelCount > 1 ? 0.5 : 1;
  rightMid.gain.value = channelCount > 1 ? 0.5 : 0;
  send.gain.value = (options.measuredBrir ? 0.115 : 0.135) * quality.roomScale;
  bodyGuard.type = "highpass";
  bodyGuard.frequency.value = 160;
  bodyGuard.Q.value = 0.5;
  airGuard.type = "lowpass";
  airGuard.frequency.value = options.measuredBrir ? 12500 : 11000;
  airGuard.Q.value = 0.4;

  input.connect(splitter);
  splitter.connect(leftMid, 0).connect(mid);
  if (channelCount > 1) splitter.connect(rightMid, 1).connect(mid);
  mid.connect(send).connect(bodyGuard).connect(airGuard);

  const compositeEntries = directions.map((direction, index) => ({
    position: getInterpolatedHrtfPosition(direction, { expansive: true }),
    delaySeconds: direction.delay * distanceProfile.earlyDelayScale,
    gain: direction.gain,
    rendererOptions: {
      role: "reflection",
      seed: index + 701,
      forceSynthetic: false
    }
  }));
  const composite = createCompositeDirectionalRenderer(context, compositeEntries, "orchestral-hall");
  if (composite) {
    airGuard.connect(composite.node).connect(output);
    directions.forEach((direction, index) => {
      const entry = compositeEntries[index];
      taps.push({
        direction,
        delay: { delayTime: { value: entry.delaySeconds } },
        gain: { gain: { value: entry.gain } },
        renderer: composite.node,
        rendererMode: composite.mode
      });
    });
    nodes.push(composite.node);
  } else {
    directions.forEach((direction, index) => {
      const delay = context.createDelay(0.06);
      const gain = context.createGain();
      const renderer = createReferenceHrtfRenderer(context, compositeEntries[index].position, compositeEntries[index].rendererOptions);
      delay.delayTime.value = compositeEntries[index].delaySeconds;
      gain.gain.value = compositeEntries[index].gain;
      airGuard.connect(delay).connect(gain).connect(renderer.node).connect(output);
      taps.push({ direction, delay, gain, renderer: renderer.node, rendererMode: renderer.mode });
      nodes.push(delay, gain, renderer.node);
    });
  }

  return {
    send,
    bodyGuard,
    airGuard,
    taps,
    symmetric: true,
    distanceProfile,
    compositeRenderer: composite,
    nodes
  };
}

function createSpatialRoomResponseEq(context, deviceProfile = getPlaybackDeviceProfile()) {
  const deviceScale = deviceProfile.renderer === "stereo-speaker" ? 0.72 : 1;
  const spatialScale = clamp(
    0.72 + state.spatialSettings.wet * 0.2 + state.spatialSettings.reflections * 0.12,
    0.78,
    1
  );
  const filters = SPATIAL_ROOM_RESPONSE_EQ.map((definition) => {
    const filter = context.createBiquadFilter();
    filter.type = definition.type;
    filter.frequency.value = definition.frequency;
    filter.gain.value = definition.gain * deviceScale * spatialScale;
    filter.Q.value = definition.q;
    return filter;
  });
  for (let index = 0; index < filters.length - 1; index += 1) {
    filters[index].connect(filters[index + 1]);
  }
  return {
    input: filters[0],
    output: filters[filters.length - 1],
    filters,
    maximumCorrectionDb: Math.max(...filters.map((filter) => Math.abs(filter.gain.value)))
  };
}

function getSpatialDistanceBrirProfile(radius = state.spatialSettings.radius) {
  const safeRadius = clamp(Number(radius) || 1, 0.72, 1.35);
  if (safeRadius <= SPATIAL_DISTANCE_BRIR_PROFILES.near.radiusMax) {
    return SPATIAL_DISTANCE_BRIR_PROFILES.near;
  }
  if (safeRadius <= SPATIAL_DISTANCE_BRIR_PROFILES.mid.radiusMax) {
    return SPATIAL_DISTANCE_BRIR_PROFILES.mid;
  }
  return SPATIAL_DISTANCE_BRIR_PROFILES.far;
}

function getSpatialStemItems(analysis) {
  if (!state.stemBuffers) return [];
  return Object.values(state.stemBuffers)
    .filter((stem) => stem && stem.buffer)
    .sort((a, b) => STEM_ORDER.indexOf(a.id) - STEM_ORDER.indexOf(b.id));
}

function getStemObjectQualityGain(stem) {
  const separation = clamp(Number(stem?.separation ?? stem?.quality?.separation) || 0.72, 0, 1);
  const spatialWeight = clamp(Number(stem?.spatialWeight ?? stem?.quality?.spatialWeight) || 1, 0.62, 1.08);
  return clamp((0.45 + separation * 0.55) * spatialWeight, 0.42, 1.05);
}

function getStemRoomSceneScale(stem) {
  const baseScale = SPATIAL_STEM_ROOM_SCENE_SCALE[stem?.id] || 1;
  if (baseScale >= 1) return 1;
  const confidence = clamp(getStemObjectQualityGain(stem), 0.42, 1);
  // 분리 신뢰도가 낮으면 누설 성분을 과도하게 빼지 않고 전체 장면으로 자연스럽게 되돌린다.
  return clamp(baseScale + (1 - confidence) * 0.16, baseScale, 1);
}

function getCoherentStemTapPlan(taps = []) {
  if (!Array.isArray(taps) || !taps.length) return [];
  const anchorIndex = Math.max(0, taps.findIndex((tap) => tap.anchor));
  const anchor = taps[anchorIndex];
  const anchorGain = Math.max(0.001, Number(anchor.gain) || 0);
  const diffuseGain = taps.reduce((sum, tap, index) => {
    return index === anchorIndex ? sum : sum + Math.max(0, Number(tap.gain) || 0);
  }, 0);
  const diffuseLimit = anchorGain * SPATIAL_RESEARCH_PROFILE.diffuseToAnchorMax;
  const diffuseScale = diffuseGain > diffuseLimit ? diffuseLimit / diffuseGain : 1;
  const anchorDelay = Math.max(0, Number(anchor.delay) || 0);

  return taps.map((tap, index) => ({
    ...tap,
    gain: index === anchorIndex
      ? anchorGain
      : Math.max(0, Number(tap.gain) || 0) * diffuseScale,
    delay: index === anchorIndex
      ? anchorDelay
      : Math.max(Number(tap.delay) || 0, anchorDelay + SPATIAL_RESEARCH_PROFILE.anchorLeadSeconds)
  }));
}

function createLateralSideExpansionLayer(context, source, output, options = {}) {
  const channelCount = source?.buffer?.numberOfChannels || options.channelCount || 2;
  if (!source || channelCount < 2) {
    return createEmptySpatialLayer();
  }

  const splitter = context.createChannelSplitter(2);
  const leftSide = context.createGain();
  const rightSide = context.createGain();
  const sideSum = context.createGain();
  const sideGuard = context.createBiquadFilter();
  const sideSend = context.createGain();
  const leftMid = context.createGain();
  const rightMid = context.createGain();
  const midSum = context.createGain();
  const midSideGuard = context.createBiquadFilter();
  const midSideAirGuard = context.createBiquadFilter();
  const midSideSend = context.createGain();
  const decorrelatorInput = context.createGain();
  const bandSum = context.createGain();
  const decorrelator = context.createConvolver();
  const stereoWidth = clamp(Number(options.analysis?.stereoImage?.width) || 0.36, 0, 1);
  const sideLift = getLateralSideLift(stereoWidth, state.spatialSettings);

  leftSide.gain.value = 0.5;
  rightSide.gain.value = -0.5;
  sideSum.gain.value = 1;
  sideGuard.type = "highpass";
  sideGuard.frequency.value = SPATIAL_RESEARCH_PROFILE.lateralHighpassHz;
  sideGuard.Q.value = 0.5;
  sideSend.gain.value = 1.22 * sideLift;
  leftMid.gain.value = 0.5;
  rightMid.gain.value = 0.5;
  midSum.gain.value = 1;
  midSideGuard.type = "highpass";
  midSideGuard.frequency.value = SPATIAL_RESEARCH_PROFILE.midDerivedSideHighpassHz;
  midSideGuard.Q.value = 0.5;
  midSideAirGuard.type = "lowpass";
  midSideAirGuard.frequency.value = SPATIAL_RESEARCH_PROFILE.midDerivedSideLowpassHz;
  midSideAirGuard.Q.value = 0.4;
  midSideSend.gain.value = getMidDerivedSideGain(stereoWidth, state.spatialSettings);
  decorrelatorInput.gain.value = 1;
  bandSum.gain.value = 2;
  decorrelator.normalize = false;
  decorrelator.buffer = createVelvetSideDecorrelatorImpulse(context);

  source.connect(splitter);
  splitter.connect(leftSide, 0);
  splitter.connect(rightSide, 1);
  leftSide.connect(sideSum);
  rightSide.connect(sideSum);
  sideSum
    .connect(sideGuard)
    .connect(sideSend)
    .connect(decorrelatorInput);
  splitter.connect(leftMid, 0);
  splitter.connect(rightMid, 1);
  leftMid.connect(midSum);
  rightMid.connect(midSum);
  midSum
    .connect(midSideGuard)
    .connect(midSideAirGuard)
    .connect(midSideSend)
    .connect(decorrelatorInput);
  const bandDefinitions = [
    { id: "lowMid", low: 220, high: 900, fallback: 0.72 },
    { id: "mid", low: 900, high: 2800, fallback: 0.9 },
    { id: "presence", low: 2800, high: 7500, fallback: 0.92 },
    { id: "air", low: 7500, high: Math.min(15000, context.sampleRate * 0.46), fallback: 0.82 }
  ];
  const bandControls = bandDefinitions.map((definition) => {
    const highpass = context.createBiquadFilter();
    const lowpass = context.createBiquadFilter();
    const gain = context.createGain();
    highpass.type = "highpass";
    highpass.frequency.value = definition.low;
    highpass.Q.value = 0.55;
    lowpass.type = "lowpass";
    lowpass.frequency.value = definition.high;
    lowpass.Q.value = 0.55;
    gain.gain.value = clamp(
      Number(state.spatialQualityProfile?.bandGains?.[definition.id]) || definition.fallback,
      0.38,
      1.08
    );
    decorrelatorInput.connect(highpass).connect(lowpass).connect(gain).connect(bandSum);
    return { ...definition, highpass, lowpass, gain };
  });
  bandSum.connect(decorrelator).connect(output);

  return {
    send: sideSum,
    sideGuard,
    midSideGuard,
    midSideAirGuard,
    midSideSend,
    decorrelator,
    decorrelatorInput,
    bandSum,
    bandControls,
    multibandCoherenceControlled: true,
    monoCancelling: true,
    taps: [],
    sources: [],
    nodes: [
      splitter,
      leftSide,
      rightSide,
      sideSum,
      sideGuard,
      sideSend,
      leftMid,
      rightMid,
      midSum,
      midSideGuard,
      midSideAirGuard,
      midSideSend,
      decorrelatorInput,
      bandSum,
      ...bandControls.flatMap((band) => [band.highpass, band.lowpass, band.gain]),
      decorrelator
    ]
  };
}

function createVelvetSideDecorrelatorImpulse(context) {
  const cacheKey = `${context.sampleRate}:velvet-side-v1`;
  const cached = state.decorrelatorImpulseCache.get(cacheKey);
  if (cached) return cached;
  const length = Math.max(128, Math.round(context.sampleRate * 0.021));
  const tapCount = 40;
  const firstTap = Math.round(context.sampleRate * 0.0032);
  const lastTap = Math.min(length - 1, Math.round(context.sampleRate * 0.0195));
  const tapSpacing = (lastTap - firstTap) / Math.max(1, tapCount - 1);
  const taps = [];
  let mean = 0;
  for (let index = 0; index < tapCount; index += 1) {
    const jitter = deterministicSigned(701, index) * tapSpacing * 0.32;
    const sample = clamp(Math.round(firstTap + index * tapSpacing + jitter), firstTap, lastTap);
    const decay = Math.exp(-index / (tapCount * 0.82));
    const amplitude = deterministicSigned(809, index) * decay;
    taps.push({ sample, amplitude });
    mean += amplitude;
  }
  mean /= tapCount;
  let energy = 0;
  taps.forEach((tap) => {
    tap.amplitude -= mean;
    energy += tap.amplitude * tap.amplitude;
  });
  const scale = 1 / Math.sqrt(Math.max(energy, 1e-12));
  const impulse = context.createBuffer(2, length, context.sampleRate);
  const left = impulse.getChannelData(0);
  const right = impulse.getChannelData(1);
  taps.forEach((tap) => {
    const value = tap.amplitude * scale;
    left[tap.sample] += value;
    right[tap.sample] -= value;
  });
  cacheAudioBuffer(state.decorrelatorImpulseCache, cacheKey, impulse, 4);
  return impulse;
}

function createMeasuredVenueTailLayer(context, source, output, impulseBuffer, options = {}) {
  if (!source || !impulseBuffer || impulseBuffer.numberOfChannels < 2) {
    return createEmptySpatialLayer();
  }

  const channelCount = source?.buffer?.numberOfChannels || 2;
  const splitter = context.createChannelSplitter(2);
  const leftMid = context.createGain();
  const rightMid = context.createGain();
  const mid = context.createGain();
  const preDelay = context.createDelay(0.04);
  const bodyGuard = context.createBiquadFilter();
  const airGuard = context.createBiquadFilter();
  const convolver = context.createConvolver();
  const orchestral = options.profile === "orchestral";
  const distanceProfile = options.distanceProfile || SPATIAL_DISTANCE_BRIR_PROFILES.mid;

  leftMid.gain.value = channelCount > 1 ? 0.5 : 1;
  rightMid.gain.value = channelCount > 1 ? 0.5 : 0;
  mid.gain.value = 1;
  preDelay.delayTime.value = distanceProfile.preDelay;
  bodyGuard.type = "highpass";
  bodyGuard.frequency.value = orchestral ? distanceProfile.highpass : 420;
  bodyGuard.Q.value = 0.5;
  airGuard.type = "lowpass";
  airGuard.frequency.value = orchestral ? distanceProfile.lowpass : 8200;
  airGuard.Q.value = 0.4;
  convolver.normalize = false;
  convolver.buffer = impulseBuffer;

  source.connect(splitter);
  splitter.connect(leftMid, 0);
  if (channelCount > 1) {
    splitter.connect(rightMid, 1);
  }
  leftMid.connect(mid);
  rightMid.connect(mid);
  mid.connect(preDelay).connect(bodyGuard).connect(airGuard).connect(convolver).connect(output);

  return {
    send: mid,
    preDelay,
    bodyGuard,
    airGuard,
    convolver,
    distanceProfile,
    roomProfile: options.roomProfile || null,
    profile: orchestral ? "orchestral" : "bounded",
    taps: [],
    sources: [],
    nodes: [splitter, leftMid, rightMid, mid, preDelay, bodyGuard, airGuard, convolver]
  };
}

function getLateralSideLift(stereoWidth, settings = state.spatialSettings) {
  return clamp(
    0.72 +
      (1 - clamp(stereoWidth, 0, 1)) * 0.2 +
      Math.max(0, settings.radius - 1) * 0.08 +
      Math.max(0, SPATIAL_SIDE_ENERGY_SCALE - 1) * 0.1,
    0.7,
    1.05
  );
}

function getMidDerivedSideGain(stereoWidth, settings = state.spatialSettings) {
  return clamp(
    0.28 +
      (1 - clamp(stereoWidth, 0, 1)) * 0.18 +
      Math.max(0, settings.radius - 1) * 0.08,
    0.3,
    0.5
  );
}

function createStemMeterTap(context, input) {
  const analyser = context.createAnalyser();
  analyser.fftSize = STEM_METER_FFT_SIZE;
  analyser.minDecibels = -92;
  analyser.maxDecibels = -10;
  analyser.smoothingTimeConstant = 0.16;
  const silentTap = context.createGain();
  silentTap.gain.value = 0;
  input.connect(analyser);
  analyser.connect(silentTap).connect(context.destination);
  return {
    analyser,
    timeData: new Float32Array(analyser.fftSize),
    nodes: [analyser, silentTap]
  };
}

function createDiffuseFieldLayer(context, source, output, options = {}) {
  const send = context.createGain();
  const bodyGuard = context.createBiquadFilter();
  const tone = context.createBiquadFilter();
  const nodes = [send, bodyGuard, tone];
  const taps = [];
  const directions = SPATIAL_FIELD_DIRECTIONS;
  const distanceProfile = options.distanceProfile || SPATIAL_DISTANCE_BRIR_PROFILES.mid;

  send.gain.value = options.measuredBrir ? 0.036 : 0.05;
  bodyGuard.type = "highpass";
  bodyGuard.frequency.value = SPATIAL_RESEARCH_PROFILE.diffuseFieldHighpassHz;
  bodyGuard.Q.value = 0.5;
  tone.type = "lowpass";
  tone.frequency.value = options.measuredBrir ? 10500 : 9000;
  tone.Q.value = 0.45;
  source.connect(send).connect(bodyGuard).connect(tone);

  const hrtfEntries = [];
  directions.forEach((direction, index) => {
    const gainScale = getSurroundTapGainScale(direction, options, "field");
    const delayScale = getFarFieldDelayScale(options, "field") * distanceProfile.earlyDelayScale;
    if (!shouldUseHrtfTap(direction, "field")) {
      const tap = createPannedDelayTap(context, tone, output, direction, {
        maxDelay: 0.055,
        minDelay: 0.014,
        delayScale,
        gainScale: gainScale * 0.44,
        panScale: 1.26 * SPATIAL_NATURAL_PAN_SCALE
      });
      taps.push({ direction, ...tap, baseGain: direction.gain });
      nodes.push(...tap.nodes);
      return;
    }
    hrtfEntries.push({
      direction,
      position: getInterpolatedHrtfPosition(direction),
      delaySeconds: Math.max(0.014, direction.delay * delayScale),
      gain: direction.gain * gainScale * 0.72,
      rendererOptions: {
        role: "reflection",
        seed: index + 17,
        forceSynthetic: false
      }
    });
  });

  const composite = createCompositeDirectionalRenderer(context, hrtfEntries, "diffuse-field");
  if (composite) {
    tone.connect(composite.node).connect(output);
    hrtfEntries.forEach((entry) => {
      taps.push({
        direction: entry.direction,
        delay: { delayTime: { value: entry.delaySeconds } },
        gain: { gain: { value: entry.gain } },
        renderer: composite.node,
        rendererMode: composite.mode,
        baseGain: entry.direction.gain
      });
    });
    nodes.push(composite.node);
  } else {
    hrtfEntries.forEach((entry) => {
      const delay = context.createDelay(0.06);
      const gain = context.createGain();
      const renderer = createReferenceHrtfRenderer(context, entry.position, entry.rendererOptions);
      delay.delayTime.value = entry.delaySeconds;
      gain.gain.value = entry.gain;
      tone.connect(delay).connect(gain).connect(renderer.node).connect(output);
      taps.push({
        direction: entry.direction,
        delay,
        gain,
        renderer: renderer.node,
        rendererMode: renderer.mode,
        baseGain: entry.direction.gain
      });
      nodes.push(delay, gain, renderer.node);
    });
  }

  return { send, bodyGuard, tone, taps, distanceProfile, compositeRenderer: composite, nodes };
}

function getInterpolatedHrtfPosition(position, options = {}) {
  const radius = state.spatialSettings.radius;
  const expansive = options.expansive ? 1 : 0;
  const stage = options.stage ? 1 : 0;
  const widthLift = (1 + (SPATIAL_SPACE_MULTIPLIER - 1) * 0.28) * SPATIAL_WIDTH_MULTIPLIER;
  const heightLift = 1 + (SPATIAL_SPACE_MULTIPLIER - 1) * 0.24;
  const distanceLift = 1 + (SPATIAL_SPACE_MULTIPLIER - 1) * 0.42;
  const azimuthInput = (position.azimuth || 0) *
    (1 + radius * (0.2 + expansive * 0.12 + stage * 0.03) * widthLift);
  const azimuth = softLimit(azimuthInput, SPATIAL_MAX_RENDER_AZIMUTH);
  const elevation = clamp((position.elevation || 0) * (0.98 + radius * (0.18 + expansive * 0.09 + stage * 0.03) * heightLift), -68, 84);
  const distance = clamp(
    (position.distance || 1.25) *
      (1.16 + radius * (0.62 + expansive * 0.34 + stage * 0.1) * distanceLift) *
      SPATIAL_DISTANCE_ENVELOPMENT,
    0.92,
    expansive ? 24 : 20
  );
  return { azimuth, elevation, distance };
}

function softLimit(value, limit) {
  if (!Number.isFinite(value) || !Number.isFinite(limit) || limit <= 0) return 0;
  return limit * Math.tanh(value / limit);
}

function createBinauralRendererImpulse(context, position, options = {}) {
  return createUniversalSofaImpulse(context, position, options) || createSyntheticHrtfImpulse(context, position, options);
}

function canUseCompositeDirectionalRenderer() {
  return getPlaybackDeviceProfile().renderer === "stereo-speaker" ||
    (state.universalHrtfStatus === "ready" && state.universalHrtfProfile);
}

function createCompositeDirectionalRenderer(context, entries = [], cacheId = "field") {
  if (!canUseCompositeDirectionalRenderer() || !entries.length) return null;
  const deviceProfile = getPlaybackDeviceProfile();
  const cacheKey = JSON.stringify({
    cacheId,
    sampleRate: context.sampleRate,
    device: deviceProfile.id,
    hrtf: state.hrtfProfileId,
    entries: entries.map((entry) => ({
      position: [entry.position.azimuth, entry.position.elevation, entry.position.distance],
      delay: entry.delaySeconds,
      gain: entry.gain,
      lowpass: entry.lowpassFrequency || 0,
      q: entry.lowpassQ || 0,
      role: entry.rendererOptions?.role || "",
      seed: entry.rendererOptions?.seed || 0
    }))
  });
  let impulse = state.compositeDirectionalImpulseCache.get(cacheKey);
  if (!impulse) {
    const prepared = entries.map((entry) => {
      const directionalImpulse = deviceProfile.renderer === "stereo-speaker"
        ? createSpeakerDirectionalImpulse(context, entry.position)
        : createBinauralRendererImpulse(context, entry.position, entry.rendererOptions || {});
      return {
        ...entry,
        impulse: directionalImpulse,
        delayFrames: Math.max(0, Math.round((Number(entry.delaySeconds) || 0) * context.sampleRate))
      };
    });
    const length = Math.max(1, ...prepared.map((entry) => entry.delayFrames + entry.impulse.length));
    impulse = context.createBuffer(2, length, context.sampleRate);
    const outputLeft = impulse.getChannelData(0);
    const outputRight = impulse.getChannelData(1);
    prepared.forEach((entry) => {
      const sourceLeft = entry.impulse.getChannelData(0);
      const sourceRight = entry.impulse.getChannelData(Math.min(1, entry.impulse.numberOfChannels - 1));
      const filteredLeft = entry.lowpassFrequency
        ? filterDirectionalImpulse(sourceLeft, context.sampleRate, entry.lowpassFrequency, entry.lowpassQ)
        : sourceLeft;
      const filteredRight = entry.lowpassFrequency
        ? filterDirectionalImpulse(sourceRight, context.sampleRate, entry.lowpassFrequency, entry.lowpassQ)
        : sourceRight;
      const gain = Number(entry.gain) || 0;
      for (let index = 0; index < filteredLeft.length; index += 1) {
        const outputIndex = entry.delayFrames + index;
        outputLeft[outputIndex] += filteredLeft[index] * gain;
        outputRight[outputIndex] += filteredRight[index] * gain;
      }
    });
    cacheAudioBuffer(state.compositeDirectionalImpulseCache, cacheKey, impulse, 40);
  }
  const convolver = context.createConvolver();
  convolver.normalize = false;
  convolver.buffer = impulse;
  return {
    node: convolver,
    impulse,
    mode: deviceProfile.renderer === "stereo-speaker"
      ? "composite-speaker-fir"
      : "composite-universal-sofa-fir"
  };
}

function createSpeakerDirectionalImpulse(context, position = {}) {
  const impulse = context.createBuffer(2, 1, context.sampleRate);
  const azimuth = clamp(Number(position.azimuth) || 0, -150, 150) * Math.PI / 180;
  const pan = clamp(Math.sin(azimuth) * 0.82, -0.88, 0.88);
  const angle = (pan + 1) * Math.PI * 0.25;
  impulse.getChannelData(0)[0] = Math.cos(angle);
  impulse.getChannelData(1)[0] = Math.sin(angle);
  return impulse;
}

function filterDirectionalImpulse(source, sampleRate, frequency, q = 0.35) {
  const safeFrequency = clamp(Number(frequency) || 14000, 20, sampleRate * 0.48);
  const safeQ = clamp(Number(q) || 0.35, 0.1, 12);
  const omega = 2 * Math.PI * safeFrequency / sampleRate;
  const cosine = Math.cos(omega);
  const alpha = Math.sin(omega) / (2 * safeQ);
  const a0 = 1 + alpha;
  const b0 = (1 - cosine) * 0.5 / a0;
  const b1 = (1 - cosine) / a0;
  const b2 = b0;
  const a1 = -2 * cosine / a0;
  const a2 = (1 - alpha) / a0;
  const output = new Float32Array(source.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let index = 0; index < source.length; index += 1) {
    const x0 = source[index];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    output[index] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return output;
}

function createReferenceHrtfRenderer(context, position, options = {}) {
  if (getPlaybackDeviceProfile().renderer === "stereo-speaker") {
    const speakerPanner = typeof context.createStereoPanner === "function"
      ? context.createStereoPanner()
      : context.createGain();
    if (speakerPanner.pan) {
      const azimuth = clamp(Number(position.azimuth) || 0, -150, 150) * Math.PI / 180;
      speakerPanner.pan.value = clamp(Math.sin(azimuth) * 0.82, -0.88, 0.88);
    }
    return { node: speakerPanner, mode: "speaker-safe-stereo" };
  }
  if (state.universalHrtfStatus === "ready" && state.universalHrtfProfile) {
    const convolver = context.createConvolver();
    convolver.normalize = false;
    convolver.buffer = createBinauralRendererImpulse(context, position, options);
    return { node: convolver, mode: "universal-sofa-fir" };
  }

  if (typeof context.createPanner === "function" && options.forceSynthetic !== true) {
    const panner = context.createPanner();
    configureReferenceHrtfPanner(context, panner, position, options);
    return { node: panner, mode: "native-hrtf" };
  }

  const convolver = context.createConvolver();
  convolver.normalize = false;
  convolver.buffer = createBinauralRendererImpulse(context, position, options);
  return { node: convolver, mode: "synthetic-fir" };
}

function configureReferenceHrtfPanner(context, panner, position, options = {}) {
  const cartesian = sphericalToListenerCoordinates(position);
  panner.panningModel = "HRTF";
  panner.distanceModel = options.distanceModel || "linear";
  panner.refDistance = Number.isFinite(options.refDistance) ? options.refDistance : 1;
  panner.maxDistance = 10000;
  panner.rolloffFactor = Number.isFinite(options.rolloffFactor) ? options.rolloffFactor : 0;
  panner.coneInnerAngle = 360;
  panner.coneOuterAngle = 360;
  panner.coneOuterGain = 1;
  setAudioParamValue(panner.positionX, cartesian.x, context.currentTime);
  setAudioParamValue(panner.positionY, cartesian.y, context.currentTime);
  setAudioParamValue(panner.positionZ, cartesian.z, context.currentTime);
  setAudioParamValue(panner.orientationX, -cartesian.x, context.currentTime);
  setAudioParamValue(panner.orientationY, -cartesian.y, context.currentTime);
  setAudioParamValue(panner.orientationZ, -cartesian.z, context.currentTime);
  if (typeof panner.setPosition === "function") {
    panner.setPosition(cartesian.x, cartesian.y, cartesian.z);
  }
  if (typeof panner.setOrientation === "function") {
    panner.setOrientation(-cartesian.x, -cartesian.y, -cartesian.z);
  }
}

function sphericalToListenerCoordinates(position = {}) {
  const azimuth = clamp(position.azimuth || 0, -178, 178) * Math.PI / 180;
  const elevation = clamp(position.elevation || 0, -88, 88) * Math.PI / 180;
  const distance = Math.max(0.1, Number(position.distance) || 1);
  const horizontal = Math.cos(elevation) * distance;
  return {
    x: Math.sin(azimuth) * horizontal,
    y: Math.sin(elevation) * distance,
    z: -Math.cos(azimuth) * horizontal
  };
}

function hasMeasuredBrirLibrary() {
  return Boolean(
    state.measuredBrirBuffer &&
    state.measuredBrirBuffer.numberOfChannels >= 2 &&
    state.measuredBrirBuffer.duration >= 0.45
  );
}

function isValidUniversalHrtfProfile(profile) {
  const anthropometry = profile?.anthropometry;
  const cues = profile?.cueModel;
  const schemaValid = [
    "SpatialAudioEssential.HRTFProfile/1.0",
    "SpatialAudioEssential.HRTFProfile/1.1"
  ].includes(profile?.schema);
  const parametric = profile?.profileType === "generic-parametric-symmetric";
  return Boolean(
    schemaValid &&
    typeof profile?.id === "string" && profile.id.length > 0 &&
    typeof profile?.rendering?.runtimeAsset === "string" &&
    Array.isArray(profile?.directions) && profile.directions.length >= 72 &&
    Number.isFinite(profile?.sampleRate) && profile.sampleRate >= 44100 &&
    Number.isFinite(profile?.impulseLength) && profile.impulseLength >= 128 &&
    (!parametric || (
      profile?.rendering?.symmetryRequired === true &&
      Number.isFinite(anthropometry?.headRadiusMeters) &&
      anthropometry.headRadiusMeters >= 0.07 && anthropometry.headRadiusMeters <= 0.11 &&
      Number.isFinite(anthropometry?.speedOfSoundMetersPerSecond) &&
      Number.isFinite(cues?.maximumIldDb) && cues.maximumIldDb >= 3 && cues.maximumIldDb <= 15 &&
      Number.isFinite(cues?.frontPinnaNotchHz) &&
      Number.isFinite(cues?.rearPinnaNotchHz)
    ))
  );
}

async function ensureUniversalHrtfProfile() {
  if (state.universalHrtfStatus === "ready" && state.universalHrtfProfile) {
    return state.universalHrtfProfile;
  }
  if (state.universalHrtfPromise) return state.universalHrtfPromise;

  const library = await ensureHrtfLibrary();
  const entry = getHrtfLibraryEntry() || library.profiles[0];
  if (!entry) return null;
  const requestedId = entry.id;
  state.hrtfProfileId = requestedId;
  state.universalHrtfStatus = "loading";
  const request = (async () => {
    try {
      const response = await fetch(apiPath(`/hrtf/${entry.profileAsset}`), { cache: "force-cache" });
      if (!response.ok) throw new Error(`HRTF profile HTTP ${response.status}`);
      const profile = await response.json();
      if (!isValidUniversalHrtfProfile(profile)) throw new Error("Universal HRTF profile is invalid");
      const runtimeResponse = await fetch(apiPath(`/hrtf/${profile.rendering.runtimeAsset}`), { cache: "force-cache" });
      if (!runtimeResponse.ok) throw new Error(`HRTF runtime HTTP ${runtimeResponse.status}`);
      const dataset = parseUniversalHrtfDataset(await runtimeResponse.arrayBuffer(), profile);
      if (state.hrtfProfileId !== requestedId) return null;
      state.universalHrtfProfile = Object.freeze(profile);
      state.universalHrtfDataset = dataset;
      state.universalHrtfStatus = "ready";
      state.hrtfImpulseCache.clear();
      state.compositeDirectionalImpulseCache.clear();
      updateSpatialControlUi();
      return profile;
    } catch (error) {
      state.universalHrtfProfile = null;
      state.universalHrtfDataset = null;
      state.universalHrtfStatus = "fallback";
      console.warn("Universal HRTF unavailable; using the browser native HRTF.", error);
      updateSpatialControlUi();
      return null;
    } finally {
      if (state.universalHrtfPromise === request) state.universalHrtfPromise = null;
    }
  })();
  state.universalHrtfPromise = request;
  return request;
}

function parseUniversalHrtfDataset(arrayBuffer, profile) {
  if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength < 32) {
    throw new Error("Universal HRTF runtime asset is empty");
  }
  const view = new DataView(arrayBuffer);
  const magic = String.fromCharCode(...new Uint8Array(arrayBuffer, 0, 8));
  const directionCount = view.getUint32(8, true);
  const receiverCount = view.getUint32(12, true);
  const tapCount = view.getUint32(16, true);
  const sampleRate = view.getUint32(20, true);
  const positionsOffset = 24;
  const impulseOffset = positionsOffset + directionCount * 3 * 4;
  const expectedBytes = impulseOffset + directionCount * receiverCount * tapCount * 4;
  if (
    magic !== "SAHRTF1\0" || receiverCount !== 2 || directionCount < 72 ||
    tapCount !== profile.impulseLength || sampleRate !== profile.sampleRate ||
    expectedBytes !== arrayBuffer.byteLength
  ) {
    throw new Error("Universal HRTF runtime asset header is invalid");
  }
  const positions = new Float32Array(arrayBuffer, positionsOffset, directionCount * 3);
  const unitVectors = new Float32Array(directionCount * 3);
  // 렌더 그래프 하나가 여러 HRTF 탭을 만들므로 방향의 삼각함수 계산은 로드 시 한 번만 수행한다.
  for (let direction = 0; direction < directionCount; direction += 1) {
    const offset = direction * 3;
    const vector = sphericalUnitVector(positions[offset], positions[offset + 1]);
    unitVectors[offset] = vector.x;
    unitVectors[offset + 1] = vector.y;
    unitVectors[offset + 2] = vector.z;
  }
  const impulses = new Float32Array(arrayBuffer, impulseOffset, directionCount * receiverCount * tapCount);
  const onsets = new Float32Array(directionCount * receiverCount);
  for (let direction = 0; direction < directionCount; direction += 1) {
    for (let receiver = 0; receiver < receiverCount; receiver += 1) {
      const sourceOffset = (direction * receiverCount + receiver) * tapCount;
      onsets[direction * receiverCount + receiver] = estimateHrirOnset(impulses, sourceOffset, tapCount);
    }
  }
  return Object.freeze({
    directionCount,
    tapCount,
    sampleRate,
    unitVectors,
    impulses,
    onsets
  });
}

function estimateHrirOnset(impulses, sourceOffset, tapCount) {
  const searchLength = Math.min(tapCount, 112);
  let peakIndex = 0;
  let peak = 0;
  for (let tap = 0; tap < searchLength; tap += 1) {
    const value = Math.abs(impulses[sourceOffset + tap]);
    if (value > peak) {
      peak = value;
      peakIndex = tap;
    }
  }
  if (peak <= 1e-9) return peakIndex;
  const threshold = peak * 0.18;
  for (let tap = Math.max(0, peakIndex - 18); tap <= peakIndex; tap += 1) {
    if (Math.abs(impulses[sourceOffset + tap]) >= threshold) return tap;
  }
  return peakIndex;
}

async function ensureMeasuredBrirBuffer(context) {
  const entry = getBrirLibraryEntry();
  const profileId = entry?.id || DEFAULT_BRIR_PROFILE_ID;
  const cached = state.brirBuffers.get(profileId);
  if (cached) {
    state.measuredBrirBuffer = cached;
    state.measuredBrirStatus = "ready";
    return cached;
  }
  if (hasMeasuredBrirLibrary() && state.measuredBrirBuffer.spatialBrirProfileId === profileId) {
    return state.measuredBrirBuffer;
  }
  if (state.measuredBrirPromise) return state.measuredBrirPromise;

  state.measuredBrirStatus = "loading";
  state.measuredBrirPromise = (async () => {
    try {
      const response = await fetch(apiPath(entry?.file ? `/brir/${entry.file}` : DEFAULT_MEASURED_BRIR_URL), { cache: "force-cache" });
      if (!response.ok) {
        throw new Error(`BRIR HTTP ${response.status}`);
      }
      const bytes = await response.arrayBuffer();
      const buffer = await context.decodeAudioData(bytes.slice(0));
      if (buffer.numberOfChannels < 2 || buffer.duration < 0.45) {
        throw new Error("BRIR stereo late field is invalid");
      }
      buffer.spatialBrirProfileId = profileId;
      state.brirBuffers.set(profileId, buffer);
      state.measuredBrirBuffer = buffer;
      state.measuredBrirStatus = "ready";
      return buffer;
    } catch (error) {
      state.measuredBrirBuffer = null;
      state.measuredBrirStatus = "fallback";
      console.warn("Measured BRIR unavailable; using bounded early-reflection fallback.", error);
      return null;
    } finally {
      state.measuredBrirPromise = null;
    }
  })();
  return state.measuredBrirPromise;
}

function getSurroundTapGainScale(direction, options = {}, layer = "field") {
  const azimuth = Math.abs(normalizeDegrees(direction.azimuth || 0));
  const elevation = Math.abs(Number(direction.elevation) || 0);
  const side = clamp(1 - Math.abs(azimuth - 105) / 72, 0, 1);
  const rear = clamp((azimuth - SPATIAL_FRONT_HEMISPHERE_AZIMUTH_LIMIT) / 70, 0, 1);
  const height = clamp((elevation - 38) / 42, 0, 1);
  const measuredBase = options.measuredBrir ? 0.98 : 1.04;
  const spaceLift = 1 + (SPATIAL_SPACE_MULTIPLIER - 1);
  const sideWidthLift = SPATIAL_WIDTH_MULTIPLIER - 1;
  const surroundLift = 1
    + side * (0.2 + (spaceLift - 1) * 0.08 + sideWidthLift * 0.12) * SPATIAL_SIDE_ENERGY_SCALE
    + rear * (0.08 + (spaceLift - 1) * 0.025 + sideWidthLift * 0.018) * SPATIAL_SIDE_ENERGY_SCALE
    + height * (0.12 + (spaceLift - 1) * 0.05) * (0.94 + SPATIAL_SIDE_ENERGY_SCALE * 0.04);
  return measuredBase * surroundLift;
}

function shouldUseHrtfTap(direction, layer) {
  const id = direction?.id;
  if (!id) return false;
  if (layer === "field") return SPATIAL_FIELD_HRTF_TAPS.has(id);
  return true;
}

function createPannedDelayTap(context, input, output, direction, options = {}) {
  const delay = context.createDelay(options.maxDelay || 0.18);
  const gain = context.createGain();
  const panner = createDirectionalPanner(context, direction, options);
  delay.delayTime.value = clamp(
    direction.delay * (options.delayScale || 1),
    options.minDelay || 0,
    options.maxDelay || 0.18
  );
  gain.gain.value = direction.gain * (options.gainScale || 1);
  input.connect(delay).connect(gain).connect(panner).connect(output);
  return {
    delay,
    gain,
    panner,
    nodes: [delay, gain, panner]
  };
}

function createDirectionalPanner(context, direction, options = {}) {
  if (typeof context.createStereoPanner === "function") {
    const panner = context.createStereoPanner();
    panner.pan.value = getDirectionPan(direction, options.panScale || 1);
    return panner;
  }
  const fallback = context.createGain();
  fallback.gain.value = 1;
  return fallback;
}

function getDirectionPan(direction, panScale = 1) {
  const azimuth = (direction.azimuth || 0) * Math.PI / 180;
  const side = Math.sin(azimuth);
  const widthLift = (1 + (SPATIAL_SPACE_MULTIPLIER - 1) * 0.14) * SPATIAL_WIDTH_MULTIPLIER;
  return clamp(side * 1.02 * widthLift * panScale * SPATIAL_NATURAL_PAN_SCALE, -1, 1);
}

function getFarFieldDelayScale(options = {}, layer = "field") {
  const spaceLift = 1 + (SPATIAL_SPACE_MULTIPLIER - 1);
  const naturalScale = SPATIAL_NATURAL_DELAY_SCALE;
  if (layer === "center") return (options.measuredBrir ? 1.2 : 1.3) * (1 + (spaceLift - 1) * 0.008) * naturalScale;
  return (options.measuredBrir ? 1.35 : 1.45) * (1 + (spaceLift - 1) * 0.01) * naturalScale;
}

function createEmptySpatialLayer() {
  return { send: null, taps: [], sources: [], nodes: [] };
}

function createSyntheticHrtfImpulse(context, position, options = {}) {
  const cacheKey = getHrtfImpulseCacheKey(context, position, options);
  const cached = state.hrtfImpulseCache.get(cacheKey);
  if (cached) return cached;

  const sampleRate = context.sampleRate;
  const role = options.role || "direct";
  const renderRole = role === "objectRoom" || role === "centerStage" || role === "horizon"
    ? "reflection"
    : (role === "object" ? "direct" : role);
  const lengthSeconds = renderRole === "body" ? 0.018 : (renderRole === "orbit" ? 0.034 : (renderRole === "reflection" ? 0.024 : 0.0145));
  const length = Math.max(96, Math.round(sampleRate * lengthSeconds));
  const buffer = context.createBuffer(2, length, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const cue = getBinauralCue(position);
  const baseDelay = renderRole === "body"
    ? 0.0011 + cue.rear * 0.00062 + cue.low * 0.00036
    : (renderRole === "orbit"
      ? 0.0024 + cue.rear * 0.0011
      : (renderRole === "reflection" ? 0.0018 + cue.rear * 0.0007 : 0.00018 + cue.rear * 0.00024));
  const leftStart = Math.round((baseDelay + cue.leftDelay) * sampleRate);
  const rightStart = Math.round((baseDelay + cue.rightDelay) * sampleRate);
  const rawDistanceGain = 1 / Math.sqrt(Math.max(0.72, position.distance || 1));
  const distanceGain = renderRole === "direct" ? rawDistanceGain : Math.max(rawDistanceGain, 0.48);
  const roleGain = renderRole === "body" ? 0.44 : (renderRole === "orbit" ? 0.32 : (renderRole === "reflection" ? 0.38 : 0.82));
  const seed = options.seed || 1;

  addFirTap(left, leftStart, cue.leftGain * distanceGain * roleGain);
  addFirTap(right, rightStart, cue.rightGain * distanceGain * roleGain);

  const profileCues = state.universalHrtfProfile?.cueModel || {};
  const elevationDegrees = clamp(Number(position.elevation) || 0, -70, 75);
  const baseNotchHz = cue.rear > 0.35
    ? Number(profileCues.rearPinnaNotchHz) || 6700
    : Number(profileCues.frontPinnaNotchHz) || 8900;
  const notchHz = clamp(
    baseNotchHz + elevationDegrees * (Number(profileCues.elevationNotchSlopeHzPerDegree) || 38),
    4200,
    12200
  );
  const pinnaBase = Math.max(2, Math.round(sampleRate / (2 * notchHz)));
  const rearShade = cue.rear > 0.36 ? -1 : 1;
  const tapCount = renderRole === "orbit" ? 7 : (renderRole === "body" ? 4 : 5);
  for (let tap = 1; tap <= tapCount; tap += 1) {
    const offset = pinnaBase + tap * Math.round((0.00058 + tap * 0.00018 + cue.rear * 0.00012) * sampleRate);
    const sign = tap % 2 ? 1 : -1;
    const spread = 1 + Math.abs(cue.side) * 0.2 + cue.height * 0.2 + cue.rear * 0.26;
    const amp = roleGain * distanceGain * (0.12 / (tap + 0.45)) * sign * rearShade;
    addFirTap(left, leftStart + offset, amp * (cue.leftGain * 0.68 + spread * 0.12));
    addFirTap(right, rightStart + offset + Math.round(cue.side * sampleRate * 0.00022), amp * (cue.rightGain * 0.68 - spread * 0.09));
  }

  const shoulderDelay = Math.round((0.0048 + cue.rear * 0.0038 + cue.height * 0.0014) * sampleRate);
  const shoulderAmp = roleGain * distanceGain * (
    renderRole === "body"
      ? 0.075 + cue.rear * 0.025 + cue.low * 0.024
      : 0.035 + cue.rear * 0.028 + cue.height * 0.016
  );
  addFirTap(left, rightStart + shoulderDelay, shoulderAmp * cue.crossLeft);
  addFirTap(right, leftStart + shoulderDelay + 1, shoulderAmp * cue.crossRight);

  if (renderRole === "body") {
    const wrapDelay = Math.round((0.0085 + cue.rear * 0.004 + Math.abs(cue.side) * 0.0018) * sampleRate);
    const wrapAmp = roleGain * distanceGain * 0.055;
    addFirTap(left, leftStart + wrapDelay, wrapAmp * (0.72 + cue.rear * 0.36));
    addFirTap(right, rightStart + wrapDelay + 1, wrapAmp * (0.72 + cue.rear * 0.36));
  }

  const airTap = Math.round((0.0068 + Math.abs(cue.side) * 0.0018 + cue.height * 0.0012 + cue.rear * 0.0022) * sampleRate);
  addFirTap(left, leftStart + airTap, deterministicSigned(seed, 0) * 0.018 * roleGain * (1 + cue.height * 0.5));
  addFirTap(right, rightStart + airTap + 2, deterministicSigned(seed, 1) * 0.018 * roleGain * (1 + cue.height * 0.5));
  normalizeImpulsePair(left, right, renderRole === "body" ? 0.46 : (renderRole === "orbit" ? 0.42 : (renderRole === "reflection" ? 0.56 : 0.82)));
  cacheAudioBuffer(state.hrtfImpulseCache, cacheKey, buffer, 140);
  return buffer;
}

function createUniversalSofaImpulse(context, position, options = {}) {
  const dataset = state.universalHrtfDataset;
  if (!dataset) return null;
  const cacheKey = `sofa:${getHrtfImpulseCacheKey(context, position, options)}`;
  const cached = state.hrtfImpulseCache.get(cacheKey);
  if (cached) return cached;
  const target = sphericalUnitVector(position.azimuth || 0, position.elevation || 0);
  const selected = [];
  const neighborCount = clamp(
    Math.round(Number(state.universalHrtfProfile?.rendering?.interpolationNeighbors) || 4),
    1,
    8
  );
  // 각도는 내적이 클수록 가깝다. 전체 정렬 없이 프로파일이 지정한 최근접 방향만 유지한다.
  for (let index = 0; index < dataset.directionCount; index += 1) {
    const offset = index * 3;
    const dot = clamp(
      target.x * dataset.unitVectors[offset] +
        target.y * dataset.unitVectors[offset + 1] +
        target.z * dataset.unitVectors[offset + 2],
      -1,
      1
    );
    if (selected.length === neighborCount && dot <= selected[neighborCount - 1].dot) continue;
    const insertAt = selected.findIndex((item) => dot > item.dot);
    selected.splice(insertAt < 0 ? selected.length : insertAt, 0, { index, dot });
    if (selected.length > neighborCount) selected.pop();
  }
  selected.forEach((item) => {
    item.angle = Math.acos(item.dot);
  });
  const weights = selected.map(item => 1 / Math.pow(item.angle + 0.015, 2));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const outputTapCount = Math.max(
    1,
    Math.ceil(dataset.tapCount * context.sampleRate / dataset.sampleRate)
  );
  const sourceSamplesPerOutput = dataset.sampleRate / context.sampleRate;
  const output = context.createBuffer(2, outputTapCount, context.sampleRate);
  const role = options.role || "direct";
  const renderRole = ["objectRoom", "centerStage", "horizon"].includes(role) ? "reflection" : (role === "object" ? "direct" : role);
  const roleGain = renderRole === "body" ? 0.5 : (renderRole === "orbit" ? 0.38 : (renderRole === "reflection" ? 0.46 : 0.88));
  const distanceGain = 1 / Math.sqrt(Math.max(0.72, Number(position.distance) || 1));
  for (let receiver = 0; receiver < 2; receiver += 1) {
    const channel = output.getChannelData(receiver);
    if (selected[0].angle < 1e-7) {
      const sourceOffset = (selected[0].index * 2 + receiver) * dataset.tapCount;
      for (let tap = 0; tap < outputTapCount; tap += 1) {
        channel[tap] = sampleHrtfImpulse(
          dataset.impulses,
          sourceOffset,
          dataset.tapCount,
          tap * sourceSamplesPerOutput
        ) * roleGain * distanceGain;
      }
      continue;
    }
    const targetOnset = selected.reduce((sum, item, rank) => (
      sum + dataset.onsets[item.index * 2 + receiver] * weights[rank] / weightTotal
    ), 0);
    selected.forEach((item, rank) => {
      const weight = weights[rank] / weightTotal;
      const sourceOffset = (item.index * 2 + receiver) * dataset.tapCount;
      const sourceOnset = dataset.onsets[item.index * 2 + receiver];
      const scale = weight * roleGain * distanceGain;
      for (let tap = 0; tap < outputTapCount; tap += 1) {
        const sourceTap = tap * sourceSamplesPerOutput + sourceOnset - targetOnset;
        if (sourceTap < 0 || sourceTap > dataset.tapCount - 1) continue;
        channel[tap] += sampleHrtfImpulse(
          dataset.impulses,
          sourceOffset,
          dataset.tapCount,
          sourceTap
        ) * scale;
      }
    });
  }
  cacheAudioBuffer(state.hrtfImpulseCache, cacheKey, output, 140);
  return output;
}

function sampleHrtfImpulse(impulses, sourceOffset, tapCount, position) {
  const lower = Math.floor(position);
  const upper = Math.min(tapCount - 1, lower + 1);
  const fraction = position - lower;
  const sample = impulses[sourceOffset + lower];
  return sample + (impulses[sourceOffset + upper] - sample) * fraction;
}

function sphericalUnitVector(azimuthDegrees, elevationDegrees) {
  const azimuth = Number(azimuthDegrees) * Math.PI / 180;
  const elevation = Number(elevationDegrees) * Math.PI / 180;
  const horizontal = Math.cos(elevation);
  return { x: Math.sin(azimuth) * horizontal, y: Math.sin(elevation), z: Math.cos(azimuth) * horizontal };
}

function getHrtfImpulseCacheKey(context, position, options = {}) {
  const role = options.role || "direct";
  const seed = options.seed || 1;
  const radius = Math.round(state.spatialSettings.radius * 100);
  const azimuth = Math.round((position.azimuth || 0) * 2) / 2;
  const elevation = Math.round((position.elevation || 0) * 2) / 2;
  const distance = Math.round((position.distance || 1) * 20) / 20;
  const profileId = state.universalHrtfProfile?.id || "fallback";
  return `${profileId}:${context.sampleRate}:${role}:${seed}:${radius}:${azimuth}:${elevation}:${distance}`;
}

function getBinauralCue(position) {
  const azimuthDegrees = clamp(position.azimuth || 0, -SPATIAL_MAX_RENDER_AZIMUTH, SPATIAL_MAX_RENDER_AZIMUTH);
  const azimuth = azimuthDegrees * Math.PI / 180;
  const elevation = clamp(position.elevation || 0, -70, 75) * Math.PI / 180;
  const side = Math.sin(azimuth);
  const frontBack = Math.cos(azimuth);
  const rear = clamp((Math.abs(azimuthDegrees) - SPATIAL_FRONT_HEMISPHERE_AZIMUTH_LIMIT) / 56, 0, 1);
  const front = Math.max(0, frontBack);
  const height = Math.max(0, Math.sin(elevation));
  const low = Math.max(0, -Math.sin(elevation));
  const profile = state.universalHrtfProfile;
  const headRadius = Number(profile?.anthropometry?.headRadiusMeters) || 0.0875;
  const speedOfSound = Number(profile?.anthropometry?.speedOfSoundMetersPerSecond) || 343;
  const foldedAngle = Math.min(Math.abs(azimuth), Math.PI - Math.abs(azimuth));
  const woodworthItd = (headRadius / speedOfSound) * (foldedAngle + Math.sin(foldedAngle));
  const itd = Math.sign(side) * woodworthItd * Math.cos(elevation);
  const maximumIldDb = Number(profile?.cueModel?.maximumIldDb) || 9;
  const ildDb = maximumIldDb * Math.pow(Math.abs(side), 0.82) * (0.9 + rear * 0.1);
  const farEarGain = Math.pow(10, -ildDb / 20);
  const shadow = 1 - farEarGain;
  const heightLift = height * 0.08;
  const rearDull = rear * 0.025;
  const leftGain = side > 0
    ? 1 - shadow - rearDull
    : 1 + shadow * 0.26 + heightLift;
  const rightGain = side < 0
    ? 1 - shadow - rearDull
    : 1 + shadow * 0.26 + heightLift;
  const norm = Math.max(leftGain, rightGain, 1);
  return {
    side,
    front,
    rear,
    height,
    low,
    leftDelay: Math.max(0, itd) + rear * 0.00018 + low * 0.00004 + front * height * 0.00006,
    rightDelay: Math.max(0, -itd) + rear * 0.00018 + low * 0.00004 + front * height * 0.00006,
    leftGain: leftGain / norm,
    rightGain: rightGain / norm,
    crossLeft: clamp(0.27 + front * 0.12 + rear * 0.46 + height * 0.16, 0.2, 0.86),
    crossRight: clamp(0.27 + front * 0.12 + rear * 0.46 + height * 0.16, 0.2, 0.86)
  };
}

function cacheAudioBuffer(cache, key, buffer, limit) {
  if (!cache || !key || !buffer) return;
  if (cache.has(key)) cache.delete(key);
  cache.set(key, buffer);
  while (cache.size > limit) {
    const firstKey = cache.keys().next().value;
    if (firstKey === undefined) break;
    cache.delete(firstKey);
  }
}

function addFirTap(channel, index, value) {
  if (index < 0 || index >= channel.length || !Number.isFinite(value)) return;
  channel[index] += value;
}

function deterministicSigned(index, seed = 0) {
  const value = Math.sin((index + 1) * 12.9898 + seed * 78.233) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}

function normalizeDegrees(value) {
  const normalized = ((Number(value) || 0) + 180) % 360 - 180;
  return normalized === -180 && value > 0 ? 180 : normalized;
}

function normalizeImpulsePair(left, right, targetPeak) {
  let peak = 0;
  for (let index = 0; index < left.length; index += 1) {
    peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]));
  }
  if (peak <= 0 || peak <= targetPeak) return;
  const scale = targetPeak / peak;
  for (let index = 0; index < left.length; index += 1) {
    left[index] *= scale;
    right[index] *= scale;
  }
}

function getSpatialWetGain(settings = state.spatialSettings) {
  return clamp(settings.wet, 0, 0.84);
}

function getSpatialOutputPeakGuardPreGain(settings = state.spatialSettings, analysis = state.analysis) {
  const peakDb = Number(analysis?.mix?.peakDb);
  const rmsDb = Number(analysis?.mix?.rmsDb);
  const safePeakDb = Number.isFinite(peakDb) ? peakDb : -6;
  const safeRmsDb = Number.isFinite(rmsDb) ? rmsDb : -18;
  const nearClip = clamp((safePeakDb + 6) / 6, 0, 1);
  const loudBody = clamp((safeRmsDb + 18) / 9, 0, 1);
  const spatialLoad = clamp(settings.wet * 0.34 + settings.reflections * 0.22 + (SPATIAL_SIDE_ENERGY_SCALE / 10) * 0.24, 0, 1);
  return clamp(
    SPATIAL_OUTPUT_PEAK_GUARD_PRE_GAIN
      - spatialLoad * 0.025
      - nearClip * spatialLoad * 0.07
      - nearClip * loudBody * 0.025,
    0.86,
    SPATIAL_OUTPUT_PEAK_GUARD_PRE_GAIN
  );
}

function getSpatialLoudnessMatchGain(settings = state.spatialSettings, analysis = state.analysis) {
  const quality = getAudioQualityProfile();
  const directEnergy = 0.86 * 0.86;
  const roomEstimate =
    0.42 +
    settings.wet * 0.12 +
    settings.reflections * 0.1 +
    Math.max(0, settings.radius - 1) * 0.18;
  const estimatedSpatialEnergy = directEnergy + roomEstimate * roomEstimate * quality.roomScale;
  const energyMatch = 1 / Math.sqrt(Math.max(estimatedSpatialEnergy, 1e-6));
  const sourceLufs = Number(analysis?.mix?.approxLufs);
  const loudProgramTrim = Number.isFinite(sourceLufs)
    ? clamp(1 - Math.max(0, sourceLufs + 12) * 0.012, 0.9, 1)
    : 1;
  return clamp(energyMatch * loudProgramTrim, 0.82, 1);
}

function getSpatialTruePeakHeadroomGain(calibration = state.playbackCalibration, analysis = state.analysis) {
  const truePeakDb = Number(calibration?.estimatedTruePeakDb ?? analysis?.mix?.estimatedTruePeakDb);
  if (!Number.isFinite(truePeakDb) || truePeakDb <= -1) return 1;
  return clamp(10 ** ((-1 - truePeakDb) / 20), 0.72, 1);
}

function createLiveInstrumentMeter(context, input) {
  const analyser = context.createAnalyser();
  analyser.fftSize = LIVE_ANALYSER_FFT_SIZE;
  analyser.minDecibels = -96;
  analyser.maxDecibels = -12;
  analyser.smoothingTimeConstant = 0.28;
  const silentTap = context.createGain();
  silentTap.gain.value = 0;
  input.connect(analyser);
  analyser.connect(silentTap).connect(context.destination);
  return {
    analyser,
    frequencyData: new Float32Array(analyser.frequencyBinCount),
    timeData: new Float32Array(analyser.fftSize),
    nodes: [analyser, silentTap]
  };
}

function disconnectGraph(graph) {
  if (!graph.nodes) return;
  graph.nodes.forEach((node) => {
    if (!node) return;
    try {
      node.disconnect();
    } catch (disconnectError) {
      // 일부 노드는 앞선 정리 단계에서 이미 연결이 해제될 수 있다.
    }
  });
  graph.nodes = [];
}

function tick() {
  if (!state.playing) return;
  const frameStart = performance.now();
  const frameInterval = (document.hidden ? HIDDEN_VISUAL_FRAME_INTERVAL : VISUAL_FRAME_INTERVAL) * 1000;
  if (state.lastVisualFrameAt && frameStart - state.lastVisualFrameAt < frameInterval) {
    state.animationId = requestAnimationFrame(tick);
    return;
  }
  state.lastVisualFrameAt = frameStart;
  trackFrameTiming(frameStart);
  const quality = getRuntimeQualityProfile();
  const time = getPlaybackTime();
  maintainTransientRoomAutomation(state.graph, time);
  if (time >= state.audioBuffer.duration) {
    stopPlayback();
    return;
  }
  if (document.hidden) {
    state.animationId = requestAnimationFrame(tick);
    return;
  }
  maybeUpdateSpectrumDisplay(time, { zero: !state.playing });
  if (
    state.lastMeterFrameTime < 0 ||
    time < state.lastMeterFrameTime ||
    time - state.lastMeterFrameTime >= quality.meterInterval
  ) {
    const meterStart = performance.now();
    refreshRealtimeMetersForMode(time);
    trackPerfSample("meterMs", performance.now() - meterStart);
    state.lastMeterFrameTime = time;
  }
  maybeUpdateSeek(time);
  if (!document.hidden && (time < state.lastWaveformDrawTime || time - state.lastWaveformDrawTime > quality.waveformInterval)) {
    const waveformStart = performance.now();
    drawWaveform(time);
    trackPerfSample("waveformMs", performance.now() - waveformStart);
    state.lastWaveformDrawTime = time;
  }
  trackPerfSample("frameMs", performance.now() - frameStart);
  updatePerfPanel(frameStart);
  state.animationId = requestAnimationFrame(tick);
}

function refreshRealtimeMetersForMode(time, options = {}) {
  if (!state.analysis) return;
  if (state.mode === "original") {
    setRealtimeMetersToZero(time);
    return;
  }
  if (!state.playing) {
    updateRealtimeDisplay(time);
    updateSoundFieldDisplay(time, readSoundFieldScores(time));
    return;
  }
  const liveScores = readLiveInstrumentScores(time);
  if (shouldUpdateStemDisplay(time, options)) {
    updateRealtimeDisplay(time, liveScores, { updateField: false });
    state.lastStemDisplayFrameTime = time;
  }
  if (shouldUpdateFieldDisplay(time, options)) {
    updateSoundFieldDisplay(time, readSoundFieldScores(time, liveScores));
    state.lastFieldDisplayFrameTime = time;
  }
}

function shouldUpdateStemDisplay(time, options = {}) {
  if (document.hidden && !options.forceDisplay) return false;
  const quality = getRuntimeQualityProfile();
  const interval = Number.isFinite(quality.stemDisplayInterval) ? quality.stemDisplayInterval : quality.meterInterval;
  return options.forceDisplay ||
    state.lastStemDisplayFrameTime < 0 ||
    time < state.lastStemDisplayFrameTime ||
    time - state.lastStemDisplayFrameTime >= interval;
}

function shouldUpdateFieldDisplay(time, options = {}) {
  if (document.hidden && !options.forceDisplay) return false;
  const quality = getRuntimeQualityProfile();
  const interval = Number.isFinite(quality.fieldDisplayInterval) ? quality.fieldDisplayInterval : quality.meterInterval;
  return options.forceDisplay ||
    state.lastFieldDisplayFrameTime < 0 ||
    time < state.lastFieldDisplayFrameTime ||
    time - state.lastFieldDisplayFrameTime >= interval;
}

function readMainAnalyserFrame(time = 0, options = {}) {
  const graph = state.graph;
  if (!graph || !graph.analyser || !graph.frequencyData || !graph.timeData || !state.audioContext) {
    return null;
  }
  const needsFrequency = options.frequency !== false;
  const needsTime = options.time !== false;
  const frameTime = Number.isFinite(time) ? time : getPlaybackTime();
  const maxAge = Number.isFinite(options.maxAge) ? options.maxAge : 0.024;
  const previous = state.lastLiveAnalysisFrame;
  const canReuse =
    !options.force &&
    previous &&
    previous.graph === graph &&
    Math.abs(frameTime - previous.time) <= maxAge;
  if (
    canReuse &&
    (!needsFrequency || previous.hasFrequency) &&
    (!needsTime || previous.hasTime)
  ) {
    return previous;
  }
  const frame = canReuse ? previous : {
    graph,
    time: frameTime,
    frequencyData: graph.frequencyData,
    timeData: graph.timeData,
    sampleRate: state.audioContext.sampleRate,
    outputLevel: state.liveOutputLevel,
    quality: null,
    hasFrequency: false,
    hasTime: false
  };
  frame.time = frameTime;
  if (needsFrequency && !frame.hasFrequency) {
    graph.analyser.getFloatFrequencyData(graph.frequencyData);
    frame.hasFrequency = true;
  }
  if (needsTime && !frame.hasTime) {
    graph.analyser.getFloatTimeDomainData(graph.timeData);
    frame.outputLevel = getMeterSignalLevel(graph.timeData);
    frame.hasTime = true;
  }
  state.lastLiveAnalysisFrame = frame;
  state.liveOutputLevel = frame.outputLevel;
  return frame;
}

function readLiveInstrumentScores(time = 0) {
  const graph = state.graph;
  if (!graph || !state.audioContext) return null;
  if (graph.stemAnalysisMeters && graph.stemAnalysisMeters.byId && Object.keys(graph.stemAnalysisMeters.byId).length) {
    const stemScores = readStemAnalysisMeterScores(graph.stemAnalysisMeters, graph.previousLiveScores || {});
    readMainAnalyserFrame(time, { frequency: false });
    graph.previousLiveScores = stemScores;
    state.liveScores = stemScores;
    return stemScores;
  }
  if (!graph.analyser) return null;
  const frame = readMainAnalyserFrame(time);
  if (!frame) return null;
  if (
    !graph.livePowerData ||
    graph.livePowerData.length !== frame.frequencyData.length ||
    !graph.livePowerPrefixData ||
    graph.livePowerPrefixData.length !== frame.frequencyData.length + 1
  ) {
    graph.livePowerData = new Float32Array(frame.frequencyData.length);
    graph.livePowerPrefixData = new Float64Array(frame.frequencyData.length + 1);
  }
  const scores = classifyLiveInstruments(
    frame.frequencyData,
    frame.timeData,
    frame.sampleRate,
    graph.previousLiveScores || {},
    graph.livePowerData,
    graph.livePowerPrefixData
  );
  const guardedScores = applyLiveInstrumentRoster(scores);
  graph.previousLiveScores = guardedScores;
  state.liveScores = guardedScores;
  return guardedScores;
}

function readStemAnalysisMeterScores(stemMeters, previousScores) {
  const scores = {};
  Object.entries(stemMeters.byId).forEach(([id, meter]) => {
    meter.analyser.getFloatTimeDomainData(meter.timeData);
    const raw = getStemMeterSignalLevel(meter.timeData);
    const shaped = shapeStemMeterLevel(raw);
    const previous = previousScores[id] || 0;
    scores[id] = shaped >= previous
      ? previous * 0.12 + shaped * 0.88
      : previous * 0.54 + shaped * 0.46;
  });
  return scores;
}

function getMeterSignalLevel(timeData) {
  let rms = 0;
  let peak = 0;
  for (let index = 0; index < timeData.length; index += 1) {
    const sample = timeData[index];
    rms += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  rms = Math.sqrt(rms / Math.max(1, timeData.length));
  const rmsDb = 20 * Math.log10(rms + 1e-7);
  const peakDb = 20 * Math.log10(peak + 1e-7);
  return clamp((rmsDb + 58) / 34 + Math.max(0, peakDb + 36) / 90, 0, 1);
}

function getStemMeterSignalLevel(timeData) {
  let rms = 0;
  let peak = 0;
  for (let index = 0; index < timeData.length; index += 1) {
    const sample = timeData[index];
    rms += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  rms = Math.sqrt(rms / Math.max(1, timeData.length));
  const rmsDb = 20 * Math.log10(rms + 1e-7);
  const peakDb = 20 * Math.log10(peak + 1e-7);
  return getStemMeterScoreFromDb(rmsDb, peakDb);
}

function getStemMeterScoreFromDb(rmsDb, peakDb) {
  const adjustedRmsDb = rmsDb + STEM_METER_DB_OFFSET;
  const adjustedPeakDb = peakDb + STEM_METER_DB_OFFSET;
  const rmsScore = clamp((adjustedRmsDb + 58) / 44, 0, 1);
  const peakScore = clamp((adjustedPeakDb + 30) / 20, 0, 1);
  return clamp(rmsScore * 0.82 + peakScore * 0.18, 0, 1);
}

function applyLiveInstrumentRoster(scores) {
  const activeIds = state.analysis && state.analysis.activeIds ? new Set(state.analysis.activeIds) : null;
  if (!activeIds || !activeIds.size) return scores;
  return Object.fromEntries(Object.entries(scores).map(([id, score]) => [
    id,
    activeIds.has(id) ? score : score * 0.04
  ]));
}

function classifyLiveInstruments(
  frequencyData,
  timeData,
  sampleRate,
  previousScores,
  powerBuffer = null,
  powerPrefixBuffer = null
) {
  const features = extractLiveAudioFeatures(
    frequencyData,
    timeData,
    sampleRate,
    powerBuffer,
    powerPrefixBuffer
  );
  if (features.signalLevel <= 0.025) {
    return Object.fromEntries(Object.keys(LIVE_SIGNATURES).map((id) => [id, 0]));
  }

  const rawScores = {};
  Object.entries(LIVE_SIGNATURES).forEach(([id, signature]) => {
    const signatureEnergy = signature.bands.reduce((sum, [min, max, weight]) => (
      sum + getLiveBandEnergy(features, min, max) * weight
    ), 0);
    rawScores[id] = signatureEnergy * getLiveGate(signature.gate, features);
  });

  protectLiveStringStaccato(rawScores, features);
  protectLivePiano(rawScores, features);

  const maxScore = Math.max(...Object.values(rawScores), 1e-8);
  const normalized = {};
  Object.entries(rawScores).forEach(([id, score]) => {
    const relative = score / maxScore;
    const previous = previousScores[id] || 0;
    const threshold = id === "piano" || id === "harp" || id === "percussion" ? 0.13 : 0.16;
    const gated = relative < threshold ? 0 : Math.pow(relative, 0.72) * features.signalLevel;
    normalized[id] = gated >= previous
      ? previous * 0.2 + gated * 0.8
      : previous * 0.62 + gated * 0.38;
  });
  return normalized;
}

function extractLiveAudioFeatures(
  frequencyData,
  timeData,
  sampleRate,
  powerBuffer = null,
  powerPrefixBuffer = null
) {
  const nyquist = sampleRate / 2;
  const binHz = nyquist / frequencyData.length;
  const power = powerBuffer && powerBuffer.length === frequencyData.length
    ? powerBuffer
    : new Float32Array(frequencyData.length);
  const powerPrefix = powerPrefixBuffer && powerPrefixBuffer.length === frequencyData.length + 1
    ? powerPrefixBuffer
    : new Float64Array(frequencyData.length + 1);
  powerPrefix[0] = 0;
  let total = 0;
  let centroidSum = 0;
  let logSum = 0;
  for (let index = 0; index < frequencyData.length; index += 1) {
    const db = Number.isFinite(frequencyData[index]) ? frequencyData[index] : -120;
    const amp = 10 ** (db / 20);
    const value = amp * amp;
    power[index] = value;
    powerPrefix[index + 1] = powerPrefix[index] + power[index];
    total += value;
    centroidSum += value * index * binHz;
    logSum += Math.log(value + 1e-12);
  }

  let rms = 0;
  let peak = 0;
  let diff = 0;
  let crossings = 0;
  for (let index = 0; index < timeData.length; index += 1) {
    const sample = timeData[index];
    const abs = Math.abs(sample);
    rms += sample * sample;
    peak = Math.max(peak, abs);
    if (index > 0) {
      diff += Math.abs(sample - timeData[index - 1]);
      if ((sample >= 0) !== (timeData[index - 1] >= 0)) crossings += 1;
    }
  }
  rms = Math.sqrt(rms / Math.max(1, timeData.length));
  const crest = peak / Math.max(rms, 1e-7);
  const transient = clamp((diff / Math.max(1, timeData.length - 1)) * 18 + Math.max(0, crest - 2.6) * 0.09, 0, 1);
  const signalLevel = clamp((20 * Math.log10(rms + 1e-7) + 58) / 38, 0, 1);
  const centroid = total > 0 ? centroidSum / total : 0;
  const flatness = total > 0 ? Math.exp(logSum / frequencyData.length) / (total / frequencyData.length + 1e-12) : 1;
  const tonal = clamp(1 - flatness * 2.6, 0, 1);

  return {
    power,
    powerPrefix,
    total: total + 1e-12,
    binHz,
    centroid,
    flatness,
    tonal,
    transient,
    signalLevel,
    zcr: crossings / Math.max(1, timeData.length - 1),
    bass: null,
    lowMid: null,
    mid: null,
    presence: null,
    air: null
  };
}

function getLiveBandEnergy(features, minHz, maxHz) {
  const start = Math.max(0, Math.floor(minHz / features.binHz));
  const end = Math.min(features.power.length - 1, Math.ceil(maxHz / features.binHz));
  // 누적 에너지를 사용해 악기별 주파수 대역 합산을 매 프레임 O(1)로 계산한다.
  const sum = features.powerPrefix[end + 1] - features.powerPrefix[start];
  return sum / features.total;
}

function getLiveGate(type, features) {
  const bass = getCachedLiveBand(features, "bass", 60, 250);
  const lowMid = getCachedLiveBand(features, "lowMid", 250, 700);
  const mid = getCachedLiveBand(features, "mid", 700, 1800);
  const presence = getCachedLiveBand(features, "presence", 1800, 5200);
  const air = getCachedLiveBand(features, "air", 5200, 11000);
  const tonal = features.tonal;
  const transient = features.transient;
  const sustain = clamp(1 - transient * 0.72 + tonal * 0.28, 0, 1);

  if (type === "stringHigh") return clamp((presence * 2.2 + air * 0.85 + mid * 0.55) * (0.58 + tonal * 0.6 + transient * 0.22), 0, 1.6);
  if (type === "stringMid") return clamp((mid * 1.9 + presence * 0.92 + lowMid * 0.45) * (0.62 + tonal * 0.62), 0, 1.6);
  if (type === "stringLow") return clamp((lowMid * 1.7 + mid * 0.82 + bass * 0.52) * (0.62 + tonal * 0.58), 0, 1.6);
  if (type === "woodwindHigh") return clamp((presence * 1.4 + air * 0.72 + mid * 0.48) * (0.78 + sustain * 0.42) * (1 - transient * 0.28), 0, 1.4);
  if (type === "woodwindMid") return clamp((mid * 1.35 + presence * 0.86 + lowMid * 0.28) * (0.78 + sustain * 0.42) * (1 - transient * 0.24), 0, 1.4);
  if (type === "woodwindLow") return clamp((lowMid * 1.45 + mid * 0.72 + bass * 0.32) * (0.75 + sustain * 0.42), 0, 1.4);
  if (type === "brassBright") return clamp((presence * 1.45 + mid * 0.95 + air * 0.22) * (0.62 + transient * 0.3 + tonal * 0.32), 0, 1.5);
  if (type === "brassWarm") return clamp((lowMid * 1.18 + mid * 1.05 + presence * 0.38) * (0.7 + sustain * 0.28), 0, 1.4);
  if (type === "impactLow") return clamp((bass * 2.1 + lowMid * 0.55) * (0.52 + transient * 1.15), 0, 1.7);
  if (type === "impactHigh") return clamp((presence * 0.62 + air * 1.65) * (0.46 + transient * 1.25) * (1 - tonal * 0.24), 0, 1.7);
  if (type === "pluck") return clamp((presence * 1.05 + air * 0.95 + mid * 0.44) * (0.42 + transient * 1.05) * tonal * (1 - lowMid * 0.35), 0, 1.5);
  if (type === "piano") return clamp((bass * 0.75 + lowMid * 1.15 + mid * 1.0 + presence * 0.65 + air * 0.18) * (0.5 + transient * 0.75) * (0.62 + tonal * 0.32), 0, 1.8);
  if (type === "low") return clamp((bass * 1.9 + lowMid * 0.5) * (0.65 + sustain * 0.35), 0, 1.4);
  return 1;
}

function getCachedLiveBand(features, key, minHz, maxHz) {
  if (features[key] === null) {
    features[key] = getLiveBandEnergy(features, minHz, maxHz);
  }
  return features[key];
}

function protectLiveStringStaccato(scores, features) {
  const stringMax = Math.max(scores.violins1 || 0, scores.violins2 || 0, scores.violas || 0, scores.cellos || 0);
  const stringEvidence = stringMax * (0.72 + features.tonal * 0.58 + features.transient * 0.24);
  if (stringEvidence > Math.max(scores.harp || 0, scores.piano || 0) * 0.78 && features.centroid > 850) {
    scores.harp *= 0.34;
    scores.piano *= features.transient > 0.62 ? 0.66 : 0.82;
    scores.violins1 *= 1.12;
    scores.violins2 *= 1.1;
    scores.violas *= 1.04;
  }
}

function protectLivePiano(scores, features) {
  const piano = scores.piano || 0;
  const stringMax = Math.max(scores.violins1 || 0, scores.violins2 || 0, scores.violas || 0);
  const lowCoverage = getCachedLiveBand(features, "bass", 60, 250) + getCachedLiveBand(features, "lowMid", 250, 700);
  if (piano > stringMax * 0.72 && lowCoverage > 0.14 && features.transient > 0.18) {
    scores.harp *= 0.58;
    scores.violins1 *= 0.72;
    scores.violins2 *= 0.76;
    scores.violas *= 0.82;
  }
}

function updateRealtimeDisplay(time, liveScores = null, options = {}) {
  if (!state.analysis) return;
  state.metersZeroed = false;
  const updateField = options.updateField !== false;
  setText(refs.frameTime, formatTime(time));
  getDisplayObjects(state.analysis).forEach((object) => {
    const liveLevel = liveScores ? (liveScores[object.id] || 0) : null;
    const rawLevel = getObjectDisplayLevel(object, time, liveLevel);
    const previous = state.meterLevels[object.id] || 0;
    const level = rawLevel >= previous
      ? previous * 0.18 + rawLevel * 0.82
      : previous * 0.58 + rawLevel * 0.42;
    state.meterLevels[object.id] = level;
    const meterRef = state.meterRows[object.id];
    if (meterRef) {
      const { row, value, cache } = meterRef;
      const visualLevel = clamp(level, 0, 1);
      if (Math.abs(visualLevel - cache.level) > METER_STYLE_EPSILON || (visualLevel === 0 && cache.level !== 0)) {
        cache.level = visualLevel;
        setStyleProperty(row, "--level", visualLevel.toFixed(2));
      }
      const sounding = visualLevel > 0.055;
      const live = liveLevel !== null && liveLevel > 0.12;
      const inactive = !object.active && visualLevel <= 0.055;
      if (cache.sounding !== sounding) {
        cache.sounding = sounding;
        toggleClass(row, "is-sounding", sounding);
      }
      if (cache.live !== live) {
        cache.live = live;
        toggleClass(row, "is-live-detected", live);
      }
      if (cache.inactive !== inactive) {
        cache.inactive = inactive;
        toggleClass(row, "is-inactive", inactive);
      }
      const percent = Math.round(visualLevel * 100);
      if (cache.percent !== percent) {
        cache.percent = percent;
        setText(value, `${percent}%`);
      }
    }
    if (updateField) {
      const previousField = state.fieldLevels[object.id] || 0;
      const fieldLevel = rawLevel >= previousField
        ? previousField * 0.16 + rawLevel * 0.84
        : previousField * 0.62 + rawLevel * 0.38;
      state.fieldLevels[object.id] = fieldLevel;
      updateFieldNodes(state.fieldNodeGroups[object.id] || [], object, fieldLevel, liveLevel, time);
    }
  });
}

function readSoundFieldScores(time = 0, liveScores = null) {
  if (!state.analysis || !state.graph) return null;
  if (state.mode === "original") {
    return Object.fromEntries(getDisplayObjects(state.analysis).map((object) => [object.id, 0]));
  }
  const frame = readMainAnalyserFrame(time, { frequency: false, maxAge: 0.08 });
  const globalLevel = frame ? frame.outputLevel : state.liveOutputLevel;
  const scoreSource = liveScores || state.liveScores || {};
  const objects = getDisplayObjects(state.analysis);
  const scores = {};
  objects.forEach((object, index) => {
    const hasLiveStemScore = object.kind === "stem" &&
      Object.prototype.hasOwnProperty.call(scoreSource, object.id);
    const liveStemLevel = hasLiveStemScore
      ? shapeStemDisplayLevel(scoreSource[object.id] || 0)
      : null;
    const timeline = object.kind === "stem"
      ? (liveStemLevel === null ? getStemFieldWeight(object) : liveStemLevel)
      : getInstrumentLevelFromCurve(object.displayCurve || object.curve, time);
    const activity = object.active ? 1 : 0.45;
    const drift = 0.9 + getFieldDrift(object.id, index, time) * 0.16;
    const depthLift = clamp((Math.abs(object.position.x) * 0.08) + (Math.abs(object.position.z) * 0.035), 0, 0.22);
    const stemGate = hasLiveStemScore
      ? clamp((timeline - 0.022) / 0.2, 0, 1)
      : 1;
    scores[object.id] = clamp(globalLevel * (0.52 + timeline * 0.58 + depthLift) * activity * drift * stemGate, 0, 1);
  });
  return scores;
}

function updateSoundFieldDisplay(time, fieldScores = null) {
  if (!state.analysis) return;
  state.metersZeroed = false;
  setText(refs.frameTime, formatTime(time));
  getDisplayObjects(state.analysis).forEach((object) => {
    const rawLevel = fieldScores ? (fieldScores[object.id] || 0) : 0;
    const previous = state.fieldLevels[object.id] || 0;
    const level = rawLevel >= previous
      ? previous * 0.14 + rawLevel * 0.86
      : previous * 0.64 + rawLevel * 0.36;
    state.fieldLevels[object.id] = level;
    updateFieldNodes(state.fieldNodeGroups[object.id] || [], object, level, level, time);
  });
}

function maybeUpdateSpectrumDisplay(time = 0, options = {}) {
  if (document.hidden && !options.force) return;
  const quality = getRuntimeQualityProfile();
  const interval = Number.isFinite(quality.spectrumInterval) ? quality.spectrumInterval : quality.meterInterval;
  if (
    options.force ||
    state.lastSpectrumFrameTime < 0 ||
    time < state.lastSpectrumFrameTime ||
    time - state.lastSpectrumFrameTime >= interval
  ) {
    const spectrumStart = performance.now();
    updateSpectrumDisplay(time, options);
    trackPerfSample("spectrumMs", performance.now() - spectrumStart);
    state.lastSpectrumFrameTime = time;
  }
}

function updateSpectrumDisplay(time = 0, options = {}) {
  if (!refs.spectrumCanvas) return;
  const hasLiveAnalyser = state.playing &&
    !options.zero &&
    state.graph &&
    state.graph.analyser &&
    state.graph.frequencyData &&
    state.audioContext;
  if (hasLiveAnalyser) {
    readLiveSpectrumLevels();
  } else {
    decaySpectrumLevels(state.spectrumLevels, 0.72);
  }
  updateSpectrumPeaks(state.spectrumLevels, state.spectrumPeaks, hasLiveAnalyser);
  drawSpectrumGraph(state.spectrumLevels, { time, peaks: state.spectrumPeaks, zero: !hasLiveAnalyser || options.zero, force: options.force });
  updateSpectrumStatus(hasLiveAnalyser, options);
}

function getSpectrumTargetFps() {
  const quality = getRuntimeQualityProfile();
  const interval = Number.isFinite(quality.spectrumInterval) ? quality.spectrumInterval : 1 / 30;
  return interval > 0 ? `${Math.round(1 / interval)} fps` : "RAF";
}

function updateSpectrumPeaks(levels, previousPeaks = [], active = false) {
  for (let index = 0; index < levels.length; index += 1) {
    const level = levels[index] || 0;
    const previous = previousPeaks[index] || 0;
    previousPeaks[index] = !active ? previous * 0.66 : (level >= previous ? level : Math.max(level, previous - 0.026));
  }
  return previousPeaks;
}

function updateSpectrumStatus(hasLiveAnalyser, options = {}) {
  if (!refs.spectrumStatus) return;
  const now = performance.now();
  const label = hasLiveAnalyser ? `Live ${SPECTRUM_BAR_COUNT} bands · ${getSpectrumTargetFps()}` : "Low-load analyser";
  if (
    !options.force &&
    label === state.lastSpectrumStatusText &&
    now - state.lastSpectrumStatusAt < SPECTRUM_STATUS_UPDATE_INTERVAL_MS
  ) {
    return;
  }
  state.lastSpectrumStatusAt = now;
  state.lastSpectrumStatusText = label;
  setText(refs.spectrumStatus, label);
}

function decaySpectrumLevels(levels, amount) {
  for (let index = 0; index < levels.length; index += 1) {
    levels[index] *= amount;
  }
  return levels;
}

function readLiveSpectrumLevels() {
  const graph = state.graph;
  if (!graph || !graph.analyser || !graph.frequencyData || !state.audioContext) {
    return state.spectrumLevels;
  }
  const frame = readMainAnalyserFrame(getPlaybackTime(), { time: false, maxAge: 0.08 });
  if (!frame) return state.spectrumLevels;
  buildSpectrumLevels(
    frame.frequencyData,
    frame.sampleRate,
    state.spectrumLevels
  );
  return state.spectrumLevels;
}

function buildSpectrumLevels(frequencyData, sampleRate, previousLevels = []) {
  if (!frequencyData || !frequencyData.length || !sampleRate) {
    return decaySpectrumLevels(previousLevels, 0);
  }
  const ranges = getSpectrumRanges(frequencyData.length, sampleRate);
  const lowBandLimit = Math.max(1, Math.round(SPECTRUM_BAR_COUNT * 0.145));
  const highBandStart = Math.round(SPECTRUM_BAR_COUNT * 0.708);

  for (let band = 0; band < SPECTRUM_BAR_COUNT; band += 1) {
    const [start, end] = ranges[band];
    let sum = 0;
    let peak = 0;
    for (let index = start; index < end; index += 1) {
      const db = Number.isFinite(frequencyData[index]) ? frequencyData[index] : -120;
      const normalized = clamp((db + 94) / 78, 0, 1);
      const energy = normalized * normalized;
      sum += energy;
      if (energy > peak) peak = energy;
    }
    const average = sum / Math.max(1, end - start);
    const lowCompensation = band < lowBandLimit ? 0.86 + (band / lowBandLimit) * 0.14 : 1;
    const highAirLift = band > highBandStart ? 1 + ((band - highBandStart) / Math.max(1, SPECTRUM_BAR_COUNT - highBandStart)) * 0.14 : 1;
    const raw = clamp((average * 0.48 + peak * 0.52) * lowCompensation * highAirLift, 0, 1);
    const shaped = Math.pow(raw, 0.68);
    const previous = previousLevels[band] || 0;
    previousLevels[band] = shaped >= previous
      ? previous * 0.14 + shaped * 0.86
      : previous * 0.68 + shaped * 0.32;
  }

  return previousLevels;
}

function getSpectrumRanges(binCount, sampleRate) {
  const key = `${binCount}:${sampleRate}:${SPECTRUM_BAR_COUNT}`;
  if (state.spectrumRanges && state.spectrumRangeKey === key) return state.spectrumRanges;

  const binHz = (sampleRate / 2) / binCount;
  const minHz = 20;
  const maxHz = Math.min(20000, sampleRate / 2);
  const ratio = maxHz / minHz;
  state.spectrumRanges = Array.from({ length: SPECTRUM_BAR_COUNT }, (_, band) => {
    const startHz = minHz * Math.pow(ratio, band / SPECTRUM_BAR_COUNT);
    const endHz = minHz * Math.pow(ratio, (band + 1) / SPECTRUM_BAR_COUNT);
    const start = clamp(Math.floor(startHz / binHz), 0, binCount - 1);
    const end = clamp(Math.max(start + 1, Math.ceil(endHz / binHz)), start + 1, binCount);
    return [start, end, startHz, endHz];
  });
  state.spectrumRangeKey = key;
  return state.spectrumRanges;
}

function getSpectrumContext(canvas) {
  if (!state.spectrumContext) {
    state.spectrumContext = canvas.getContext("2d");
  }
  return state.spectrumContext;
}

function getCanvasRenderMetrics(canvas, cache) {
  const dpr = Math.min(MAX_CANVAS_DPR, Math.max(1, window.devicePixelRatio || 1));
  if (!cache.cssWidth || !cache.cssHeight || cache.dpr !== dpr || !cache.width || !cache.height) {
    const rect = canvas.getBoundingClientRect();
    cache.cssWidth = rect.width;
    cache.cssHeight = rect.height;
  }
  const width = Math.max(1, Math.floor(cache.cssWidth * dpr));
  const height = Math.max(1, Math.floor(cache.cssHeight * dpr));
  const resized = canvas.width !== width || canvas.height !== height || cache.dpr !== dpr;
  if (resized) {
    canvas.width = width;
    canvas.height = height;
    cache.width = width;
    cache.height = height;
    cache.dpr = dpr;
  }
  return { width, height, dpr, resized };
}

function invalidateCanvasRenderMetrics(cache) {
  cache.cssWidth = 0;
  cache.cssHeight = 0;
}

function drawSpectrumGraph(levels = state.spectrumLevels, options = {}) {
  const canvas = refs.spectrumCanvas;
  if (!canvas) return;
  const ctx = getSpectrumContext(canvas);
  const { width, height, dpr, resized } = getCanvasRenderMetrics(canvas, state.spectrumCache);
  if (resized) {
    state.spectrumCache.backgroundKey = "";
    state.spectrumCache.gradientKey = "";
  }

  drawSpectrumBackground(ctx, width, height, dpr);

  const paddingX = Math.max(18 * dpr, width * 0.018);
  const top = 22 * dpr;
  const bottom = 44 * dpr;
  const graphHeight = Math.max(1, height - top - bottom);
  const barGap = Math.max(3 * dpr, width * 0.004);
  const barWidth = Math.max(2 * dpr, (width - paddingX * 2) / SPECTRUM_BAR_COUNT - barGap);
  const barGradient = getSpectrumGradient(ctx, height);
  ctx.fillStyle = barGradient;
  ctx.shadowBlur = 0;

  let energy = 0;
  const peaks = Array.isArray(options.peaks) ? options.peaks : [];
  levels.forEach((level, index) => {
    const visual = clamp(level, 0, 1);
    energy += visual;
    const x = paddingX + index * (barWidth + barGap);
    const barHeight = Math.max(2 * dpr, graphHeight * visual);
    const y = top + graphHeight - barHeight;
    ctx.fillRect(x, y, barWidth, barHeight);
    const peak = clamp(peaks[index] || 0, 0, 1);
    if (peak > 0.02) {
      const peakY = top + graphHeight - graphHeight * peak;
      ctx.fillStyle = cssColor("--gold", "#d7b56d");
      ctx.fillRect(x, peakY, barWidth, Math.max(2 * dpr, 2));
      ctx.fillStyle = barGradient;
    }
  });

  ctx.shadowBlur = 0;
  const average = levels.length ? energy / levels.length : 0;
  drawSpectrumEnergyLine(ctx, levels, {
    width,
    height,
    paddingX,
    top,
    graphHeight,
    time: options.time || 0,
    energy: average,
    dpr
  });
}

function drawSpectrumBackground(ctx, width, height, dpr) {
  const theme = document.documentElement.dataset.theme || "light";
  const key = `${width}:${height}:${dpr}:${theme}`;
  if (!state.spectrumCache.backgroundCanvas || state.spectrumCache.backgroundKey !== key) {
    const background = document.createElement("canvas");
    background.width = width;
    background.height = height;
    const bg = background.getContext("2d");
    drawSpectrumBackgroundLayer(bg, width, height, dpr);
    state.spectrumCache.backgroundKey = key;
    state.spectrumCache.backgroundCanvas = background;
  }
  ctx.drawImage(state.spectrumCache.backgroundCanvas, 0, 0);
}

function drawSpectrumBackgroundLayer(ctx, width, height, dpr) {
  ctx.fillStyle = cssColor("--canvas-bg", "rgba(238,244,240,0.78)");
  ctx.fillRect(0, 0, width, height);

  const zones = [
    [0, 0.22, "--green"],
    [0.22, 0.46, "--blue"],
    [0.46, 0.74, "--coral"],
    [0.74, 1, "--gold"]
  ];
  zones.forEach(([start, end, color]) => {
    ctx.globalAlpha = 0.085;
    ctx.fillStyle = cssColor(color, "rgba(81,127,150,0.18)");
    ctx.fillRect(width * start, 0, width * (end - start), height);
  });
  ctx.globalAlpha = 1;

  ctx.strokeStyle = cssColor("--line", "rgba(32,41,51,0.14)");
  ctx.lineWidth = Math.max(1, dpr);
  for (let index = 1; index <= 3; index += 1) {
    const y = (height * index) / 4;
    ctx.globalAlpha = 0.34;
    ctx.beginPath();
    ctx.moveTo(18 * dpr, y);
    ctx.lineTo(width - 18 * dpr, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawSpectrumEnergyLine(ctx, levels, layout) {
  if (!levels.length) return;
  const { width, paddingX, top, graphHeight, energy, dpr } = layout;
  const step = (width - paddingX * 2) / Math.max(1, levels.length - 1);
  ctx.beginPath();
  levels.forEach((level, index) => {
    const x = paddingX + index * step;
    const y = top + graphHeight - graphHeight * clamp(level * 0.92, 0, 1);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = cssColor("--gold", "#d7b56d");
  ctx.lineWidth = Math.max(1.2 * dpr, 1);
  ctx.globalAlpha = clamp(0.18 + energy * 0.34, 0.18, 0.52);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function getSpectrumGradient(ctx, height) {
  const theme = document.documentElement.dataset.theme || "light";
  const key = `${height}:${theme}`;
  if (state.spectrumCache.gradientKey !== key) {
    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, cssColor("--green", "#687f5b"));
    gradient.addColorStop(0.42, cssColor("--blue", "#517f96"));
    gradient.addColorStop(0.76, cssColor("--coral", "#c86f5a"));
    gradient.addColorStop(1, cssColor("--gold", "#d7b56d"));
    state.spectrumCache.gradientKey = key;
    state.spectrumCache.gradient = gradient;
  }
  return state.spectrumCache.gradient;
}

function updateFieldNodes(nodes, object, level, liveLevel, time) {
  nodes.forEach((node) => {
    if (!node._fieldNode) {
      node._fieldNode = {
        level: -1,
        sounding: null,
        live: null,
        inactive: null,
        left: null,
        top: null
      };
    }
    const cached = node._fieldNode;
    const visualLevel = clamp(level, 0, 1);
    if (Math.abs(visualLevel - cached.level) > 0.01) {
      cached.level = visualLevel;
      setStyleProperty(node, "--level", visualLevel.toFixed(2));
    }
    const sounding = visualLevel > 0.045;
    const live = liveLevel !== null && liveLevel > 0.12;
    const inactive = !object.active && visualLevel <= 0.055;
    if (cached.sounding !== sounding) {
      cached.sounding = sounding;
      node.classList.toggle("is-sounding", sounding);
    }
    if (cached.live !== live) {
      cached.live = live;
      node.classList.toggle("is-live-detected", live);
    }
    if (cached.inactive !== inactive) {
      cached.inactive = inactive;
      node.classList.toggle("is-inactive", inactive);
    }
  });
}

function getStemFieldWeight(stem) {
  if (stem.id === "vocals") return 0.9;
  if (stem.id === "other") return 0.82;
  if (stem.id === "drums") return 0.72;
  if (stem.id === "bass") return 0.52;
  return 0.7;
}

function getFieldDrift(id, index, time) {
  const seed = getFieldDriftSeed(id);
  return Math.sin(time * (0.82 + index * 0.06) + seed * 0.13) * 0.5 + 0.5;
}

function getFieldDriftSeed(id) {
  if (Number.isFinite(state.fieldDriftSeeds[id])) {
    return state.fieldDriftSeeds[id];
  }
  let seed = 0;
  for (let index = 0; index < id.length; index += 1) {
    seed += id.charCodeAt(index);
  }
  state.fieldDriftSeeds[id] = seed;
  return seed;
}

function setRealtimeMetersToZero(time = 0) {
  if (!state.analysis) return;
  state.liveScores = {};
  setText(refs.frameTime, formatTime(time));
  if (state.metersZeroed) return;
  getDisplayObjects(state.analysis).forEach((object) => {
    state.meterLevels[object.id] = 0;
    const meterRef = state.meterRows[object.id];
    const nodes = state.fieldNodeGroups[object.id] || [];
    if (meterRef) {
      const { row, value, cache } = meterRef;
      setStyleProperty(row, "--level", "0");
      toggleClass(row, "is-sounding", false);
      toggleClass(row, "is-live-detected", false);
      toggleClass(row, "is-inactive", !object.active);
      setText(value, "0%");
      if (cache) {
        cache.level = 0;
        cache.percent = 0;
        cache.sounding = false;
        cache.live = false;
        cache.inactive = !object.active;
      }
    }
    state.fieldLevels[object.id] = 0;
    nodes.forEach((node) => {
      setStyleProperty(node, "--level", "0");
      if (node._fieldNode) {
        node._fieldNode.level = 0;
        node._fieldNode.sounding = false;
        node._fieldNode.live = false;
        node._fieldNode.inactive = !object.active;
      }
      toggleClass(node, "is-sounding", false);
      toggleClass(node, "is-live-detected", false);
      toggleClass(node, "is-inactive", !object.active);
    });
  });
  state.metersZeroed = true;
}

function getObjectDisplayLevel(object, time, liveLevel = null) {
  if (object.kind === "stem") {
    return liveLevel === null ? 0 : softenStemBarLevel(liveLevel);
  }
  return getInstrumentDisplayLevel(object, time, liveLevel);
}

function shapeStemDisplayLevel(level) {
  const gated = clamp((level - 0.018) / 0.982, 0, 1);
  if (gated <= 0) return 0;
  const normalized = (1 - Math.exp(-3.1 * gated)) / (1 - Math.exp(-3.1));
  const steady = normalized * 0.9;
  const peakLift = Math.pow(gated, 10) * 0.1;
  return clamp(steady + peakLift, 0, 1);
}

function shapeStemMeterLevel(level) {
  return clamp(level, 0, 1);
}

function softenStemBarLevel(level) {
  return clamp(level, 0, 1);
}

function getInstrumentDisplayLevel(instrument, time, liveLevel = null) {
  const timelineLevel = getInstrumentLevelFromCurve(instrument.displayCurve || instrument.curve, time);
  if (state.playing && liveLevel !== null) {
    if (!instrument.active) return clamp(liveLevel, 0, 1);
    return clamp(liveLevel * 0.88 + timelineLevel * 0.12, 0, 1);
  }
  return timelineLevel;
}

function getInstrumentLevelFromCurve(curve, time) {
  if (!state.analysis || !curve.length) return 0;
  const duration = state.analysis.file.duration || 1;
  const ratio = clamp(time / duration, 0, 1);
  const indexFloat = ratio * (curve.length - 1);
  const index = Math.floor(indexFloat);
  const next = Math.min(curve.length - 1, index + 1);
  const mix = indexFloat - index;
  return clamp(curve[index] * (1 - mix) + curve[next] * mix, 0, 1);
}

function seekToSlider() {
  if (!state.analysis) return;
  const duration = state.analysis.file.duration;
  const nextTime = (Number(refs.seekSlider.value) / 1000) * duration;
  state.offset = nextTime;
  if (state.playing) {
    stopPlayback({ keepOffset: true, silent: true });
    state.offset = nextTime;
    startPlayback();
  } else {
    if (state.mode === "original") {
      setRealtimeMetersToZero(nextTime);
    } else {
      updateRealtimeDisplay(nextTime);
      updateSoundFieldDisplay(nextTime, readSoundFieldScores(nextTime));
    }
    updateSpectrumDisplay(nextTime, { zero: true });
    drawWaveform(nextTime);
    updateSeek(nextTime, { force: true });
  }
}

function getPlaybackTime() {
  if (!state.playing || !state.audioContext) return state.offset;
  return clamp(state.audioContext.currentTime - state.startedAt, 0, state.audioBuffer ? state.audioBuffer.duration : 0);
}

function maybeUpdateSeek(time, options = {}) {
  if (document.hidden && !options.force) return;
  const quality = getRuntimeQualityProfile();
  const interval = Number.isFinite(quality.seekInterval) ? quality.seekInterval : 1 / 12;
  if (
    options.force ||
    state.lastSeekFrameTime < 0 ||
    time < state.lastSeekFrameTime ||
    time - state.lastSeekFrameTime >= interval
  ) {
    updateSeek(time, { force: true });
  }
}

function updateSeek(time, options = {}) {
  const duration = Number(state.analysis?.file?.duration) || 0;
  setText(refs.currentTime, formatTime(time));
  setText(refs.totalTime, formatTime(duration));
  const sliderValue = String(duration ? Math.round((time / duration) * 1000) : 0);
  if (refs.seekSlider.value !== sliderValue) {
    refs.seekSlider.value = sliderValue;
  }
  if (options.force !== false) {
    state.lastSeekFrameTime = time;
  }
}

function drawWaveform(currentTime = 0) {
  const canvas = refs.waveformCanvas;
  if (!canvas) return;
  const ctx = getWaveformContext(canvas);
  const { width, height, dpr, resized } = getCanvasRenderMetrics(canvas, state.waveformCache);
  if (resized) {
    state.waveformCache.backgroundKey = "";
    state.waveformCache.barsKey = "";
    state.waveformCache.gradientKey = "";
  }

  if (!Array.isArray(state.analysis?.waveform) || state.analysis.waveform.length === 0) {
    drawEmptyWaveform(ctx, width, height, dpr);
    return;
  }

  ctx.drawImage(getWaveformBaseCanvas(width, height, dpr), 0, 0);

  const duration = Number(state.analysis?.file?.duration) || 0;
  const cursor = duration ? (currentTime / duration) * width : 0;
  ctx.fillStyle = cssColor("--ink", "rgba(32,41,51,0.82)");
  ctx.fillRect(cursor, 0, Math.max(2, dpr * 2), height);
}

function getWaveformContext(canvas) {
  if (!state.waveformContext) {
    state.waveformContext = canvas.getContext("2d");
  }
  return state.waveformContext;
}

function resetWaveformCache() {
  state.waveformCache.backgroundKey = "";
  state.waveformCache.backgroundCanvas = null;
  state.waveformCache.barsKey = "";
  state.waveformCache.bars = [];
  state.waveformCache.gradientKey = "";
  state.waveformCache.gradient = null;
  invalidateCanvasRenderMetrics(state.waveformCache);
}

function getWaveformBaseCanvas(width, height, dpr) {
  const values = state.analysis?.waveform || [];
  const theme = document.documentElement.dataset.theme || "light";
  const key = `${width}:${height}:${dpr}:${theme}:${values.length}`;
  if (!state.waveformCache.backgroundCanvas || state.waveformCache.backgroundKey !== key) {
    const background = document.createElement("canvas");
    background.width = width;
    background.height = height;
    const context = background.getContext("2d");
    drawWaveformBaseLayer(context, width, height, values);
    state.waveformCache.backgroundKey = key;
    state.waveformCache.backgroundCanvas = background;
  }
  return state.waveformCache.backgroundCanvas;
}

function drawWaveformBaseLayer(ctx, width, height, values) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = cssColor("--canvas-bg", "rgba(238,244,240,0.78)");
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = getWaveformGradient(ctx, width);
  getWaveformBars(values, width, height).forEach((bar) => {
    ctx.fillRect(bar.x, bar.y, bar.width, bar.height);
  });
}

function getWaveformGradient(ctx, width) {
  const theme = document.documentElement.dataset.theme || "light";
  const key = `${width}:${theme}`;
  if (state.waveformCache.gradientKey !== key) {
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, cssColor("--green", "#687f5b"));
    gradient.addColorStop(0.48, cssColor("--blue", "#517f96"));
    gradient.addColorStop(1, cssColor("--coral", "#c86f5a"));
    state.waveformCache.gradientKey = key;
    state.waveformCache.gradient = gradient;
  }
  return state.waveformCache.gradient;
}

function getWaveformBars(values, width, height) {
  const key = `${width}:${height}:${values.length}`;
  if (state.waveformCache.barsKey === key) {
    return state.waveformCache.bars;
  }
  const mid = height * 0.5;
  const maxAmp = height * 0.42;
  const barWidth = Math.max(1, width / Math.max(1, values.length));
  state.waveformCache.bars = values.map((value, index) => {
    const h = Math.max(1, value * maxAmp);
    return {
      x: (index / values.length) * width,
      y: mid - h,
      width: barWidth,
      height: h * 2
    };
  });
  state.waveformCache.barsKey = key;
  return state.waveformCache.bars;
}

function drawEmptyWaveform(ctx = null, width = 0, height = 0, dpr = window.devicePixelRatio || 1) {
  const canvas = refs.waveformCanvas;
  if (!canvas) return;
  const context = ctx || getWaveformContext(canvas);
  let canvasWidth = width;
  let canvasHeight = height;
  if (!canvasWidth || !canvasHeight) {
    const metrics = getCanvasRenderMetrics(canvas, state.waveformCache);
    canvasWidth = metrics.width;
    canvasHeight = metrics.height;
    dpr = metrics.dpr;
  }
  context.fillStyle = cssColor("--canvas-bg", "rgba(238,244,240,0.78)");
  context.fillRect(0, 0, canvasWidth, canvasHeight);
  context.fillStyle = cssColor("--line", "rgba(32,41,51,0.18)");
  context.fillRect(0, canvasHeight / 2, canvasWidth, Math.max(1, dpr));
}

function resetApp() {
  if (state.analysisController) {
    state.analysisController.abort();
    state.analysisController = null;
  }
  state.analysisRunId += 1;
  resetAnalysisProgress();
  stopPlayback();
  state.file = null;
  state.analysis = null;
  state.audioBuffer = null;
  state.stemBuffers = null;
  state.playbackCalibration = null;
  state.spatialOutputCalibration = null;
  state.spatialQualityProfile = null;
  state.transientMaps = {};
  invalidateSpatialRenderCache();
  state.stemAlignmentProfile = null;
  state.displayObjects = null;
  state.meterLevels = {};
  state.metersZeroed = false;
  state.fieldLevels = {};
  state.fieldNodeGroups = {};
  state.fieldDriftSeeds = {};
  resetSpectrumState();
  state.stemPositionCache = {};
  state.stemDisplayPositions = {};
  state.meterRows = {};
  resetWaveformCache();
  state.lastWaveformDrawTime = -1;
  state.lastMeterFrameTime = -1;
  state.lastStemDisplayFrameTime = -1;
  state.lastFieldDisplayFrameTime = -1;
  state.lastSpectrumFrameTime = -1;
  state.lastSeekFrameTime = -1;
  state.lastVisualFrameAt = 0;
  resetLiveAnalysisCache();
  resetRuntimeQualityState();
  state.liveScores = {};
  state.spatialSettings = { ...SPATIAL_ENGINE_DEFAULTS };
  state.spatialAnalysisSummary = { openness: 0, dynamics: 0, density: 0 };
  refs.fileInput.value = "";
  syncFieldModeState();
  updateSpatialControlUi();
  setText(refs.trackKicker, "READY");
  refs.trackName.textContent = "파일을 선택하세요";
  setText(refs.trackSubtitle, "로컬 백엔드에서 분석하고 브라우저에서는 원본 출력 기준선을 유지합니다.");
  refs.playButton.disabled = true;
  refs.stopButton.disabled = true;
  refs.exportButton.disabled = true;
  refs.seekSlider.disabled = true;
  refs.instrumentList.innerHTML = "";
  refs.stageMap.innerHTML = "";
  if (refs.spectrumStatus) refs.spectrumStatus.textContent = "Live analyser";
  if (refs.modelStack) refs.modelStack.innerHTML = "";
  if (refs.sectionList) refs.sectionList.innerHTML = "";
  refs.activeCount.textContent = "0 active";
  setText(refs.modelTag, "대기");
  setText(refs.waveformTag, "대기");
  refs.currentTime.textContent = "0:00";
  refs.totalTime.textContent = "0:00";
  Object.values(refs.metrics).forEach((metric) => {
    metric.textContent = metric.tagName === "STRONG" ? "--" : "";
  });
  document.body.classList.remove("has-analysis", "is-busy");
  drawEmptyWaveform();
  drawSpectrumGraph(state.spectrumLevels, { zero: true, force: true });
  setBusy(false, "분석 대기 중");
}

function applyStoredTheme() {
  const saved = localStorage.getItem("spatial-audio-essential-theme");
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(saved || (prefersDark ? "dark" : "light"));
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  localStorage.setItem("spatial-audio-essential-theme", next);
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const isDark = theme === "dark";
  refs.themeToggle.setAttribute("aria-pressed", String(isDark));
  refs.themeToggle.setAttribute("aria-label", isDark ? "라이트 모드로 전환" : "다크 모드로 전환");
  refs.themeToggleText.textContent = isDark ? "Light" : "Dark";
  state.spectrumCache.backgroundKey = "";
  state.spectrumCache.gradientKey = "";
  drawWaveform(getPlaybackTime());
  drawSpectrumGraph(state.spectrumLevels, { time: getPlaybackTime(), zero: !state.playing, force: true });
}

function setBusy(isBusy, text) {
  document.body.classList.toggle("is-busy", isBusy);
  refs.statusText.textContent = text;
}

function startAnalysisProgress() {
  window.clearInterval(state.analysisTimer);
  window.clearTimeout(state.analysisCompletionTimer);
  state.analysisStartedAt = performance.now();
  if (refs.analysisProgress) {
    refs.analysisProgress.hidden = false;
    refs.analysisProgress.classList.remove("is-error");
  }
  updateAnalysisElapsed();
  state.analysisTimer = window.setInterval(updateAnalysisElapsed, 1000);
}

function setAnalysisPhase(phaseId, text) {
  const phase = ANALYSIS_PHASES[phaseId] || ANALYSIS_PHASES.upload;
  setText(refs.analysisPhase, text);
  if (refs.analysisProgressBar) {
    refs.analysisProgressBar.style.setProperty("--analysis-progress", `${phase.progress}%`);
  }
  if (refs.analysisProgressTrack) {
    refs.analysisProgressTrack.setAttribute("aria-valuenow", String(phase.progress));
    refs.analysisProgressTrack.setAttribute("aria-valuetext", text);
  }
  refs.analysisProgressSteps.forEach((step, index) => {
    step.classList.toggle("is-current", index === phase.order);
    step.classList.toggle("is-complete", index < phase.order || phaseId === "ready");
  });
}

function updateAnalysisElapsed() {
  if (!state.analysisStartedAt) return;
  const seconds = Math.max(0, Math.floor((performance.now() - state.analysisStartedAt) / 1000));
  const label = seconds < 60
    ? `${seconds}초`
    : `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
  setText(refs.analysisElapsed, label);
}

function finishAnalysisProgress(success, text) {
  window.clearInterval(state.analysisTimer);
  state.analysisTimer = 0;
  updateAnalysisElapsed();
  if (success) {
    setAnalysisPhase("ready", text);
  } else {
    setText(refs.analysisPhase, text);
    refs.analysisProgress?.classList.add("is-error");
    refs.analysisProgressTrack?.setAttribute("aria-valuetext", text);
  }
  const runId = state.analysisRunId;
  state.analysisCompletionTimer = window.setTimeout(() => {
    if (runId === state.analysisRunId && refs.analysisProgress) {
      refs.analysisProgress.hidden = true;
    }
  }, success ? 1800 : 4200);
}

function resetAnalysisProgress() {
  window.clearInterval(state.analysisTimer);
  window.clearTimeout(state.analysisCompletionTimer);
  state.analysisTimer = 0;
  state.analysisCompletionTimer = 0;
  state.analysisStartedAt = 0;
  if (refs.analysisProgress) {
    refs.analysisProgress.hidden = true;
    refs.analysisProgress.classList.remove("is-error");
  }
  if (refs.analysisProgressBar) {
    refs.analysisProgressBar.style.setProperty("--analysis-progress", "0%");
  }
}

function showToast(message) {
  refs.toast.textContent = message;
  refs.toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => refs.toast.classList.remove("is-visible"), 2800);
}

function setPerfPanelEnabled(enabled) {
  if (!refs.perfPanel || !refs.perfToggle) return;
  state.perf.enabled = Boolean(enabled);
  refs.perfPanel.hidden = !state.perf.enabled;
  refs.perfToggle.classList.toggle("is-active", state.perf.enabled);
  refs.perfToggle.setAttribute("aria-expanded", String(state.perf.enabled));
  refs.perfToggle.setAttribute("aria-label", state.perf.enabled ? "성능 패널 닫기" : "성능 패널 열기");
  if (state.perf.enabled) {
    updatePerfPanel(performance.now(), { force: true });
  }
}

function trackFrameTiming(now) {
  if (!state.perf.lastFrameAt) {
    state.perf.lastFrameAt = now;
    return;
  }
  const delta = now - state.perf.lastFrameAt;
  state.perf.lastFrameAt = now;
  if (delta > 42) state.perf.droppedFrames += 1;
  const instantFps = delta > 0 ? 1000 / delta : 0;
  state.perf.fps = state.perf.fps
    ? state.perf.fps * 0.86 + instantFps * 0.14
    : instantFps;
}

function trackPerfSample(key, value) {
  if (!Number.isFinite(value)) return;
  const samples = state.perf[key];
  if (!Array.isArray(samples)) return;
  samples.push(value);
  if (samples.length > 80) samples.shift();
}

function averagePerfSample(key) {
  const samples = state.perf[key];
  if (!Array.isArray(samples) || !samples.length) return 0;
  return samples.reduce((sum, value) => sum + value, 0) / samples.length;
}

function updatePerfPanel(now = performance.now(), options = {}) {
  if (!state.perf.enabled) return;
  if (!options.force && now - state.perf.lastPanelAt < 500) return;
  state.perf.lastPanelAt = now;
  setText(refs.perf.fps, state.perf.fps ? `${Math.round(state.perf.fps)} fps` : "--");
  setText(refs.perf.frame, `${averagePerfSample("frameMs").toFixed(1)} ms`);
  setText(refs.perf.meter, `${averagePerfSample("meterMs").toFixed(1)} ms`);
  setText(refs.perf.waveform, `${averagePerfSample("waveformMs").toFixed(1)} ms`);
  setText(refs.perf.nodes, `${formatNumber(getLiveNodeCount())} · ${getRuntimeQualityProfile().label}`);
  const audioLoad = state.perf.audioLoad;
  setText(refs.perf.audioLoad, audioLoad?.supported
    ? `${Math.round(audioLoad.averageLoad * 100)}% avg · ${Math.round(audioLoad.peakLoad * 100)}% peak${audioLoad.underrunRatio > 0 ? " · underrun" : ""}`
    : "unsupported");
  setText(refs.perf.heap, getHeapLabel());
}

function getLiveNodeCount() {
  if (!state.graph) return 0;
  const graphNodes = Array.isArray(state.graph.nodes) ? state.graph.nodes.length : 0;
  const retiredNodes = state.retiredGraphs.reduce((sum, item) => {
    return sum + (Array.isArray(item.graph?.nodes) ? item.graph.nodes.length : 0);
  }, 0);
  return graphNodes + retiredNodes;
}

function getHeapLabel() {
  const memory = performance.memory;
  if (!memory || !Number.isFinite(memory.usedJSHeapSize)) return "--";
  return formatBytes(memory.usedJSHeapSize);
}

function scheduleWaveformDraw() {
  if (state.resizeFrame) return;
  state.resizeFrame = requestAnimationFrame(() => {
    state.resizeFrame = 0;
    invalidateCanvasRenderMetrics(state.waveformCache);
    invalidateCanvasRenderMetrics(state.spectrumCache);
    drawWaveform(getPlaybackTime());
    drawSpectrumGraph(state.spectrumLevels, { time: getPlaybackTime(), zero: !state.playing, force: true });
  });
}

function setupCanvasResizeObserver() {
  if (!window.ResizeObserver || state.canvasResizeObserver) return;
  state.canvasResizeObserver = new ResizeObserver(scheduleWaveformDraw);
  [refs.waveformCanvas, refs.spectrumCanvas]
    .filter(Boolean)
    .forEach((canvas) => state.canvasResizeObserver.observe(canvas));
}

window.addEventListener("resize", scheduleWaveformDraw);
