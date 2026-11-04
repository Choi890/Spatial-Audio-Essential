const renderConfig = window.SpatialAudioRenderer.config;

const { apiPath, clamp, formatBytes, mapRange } = window.SpatialAudioUtils;

const { CORE_STEM_ORDER, STEM_ORDER, STEM_PROFILES } = window.SpatialAudioConfig;

const DEMUCS_MODEL = "htdemucs_ft";
const MAX_AUDIO_FILE_BYTES = 420 * 1024 * 1024;

const AUDIO_CONTEXT_RESUME_WAIT_MS = 250;
const STEM_DURATION_TOLERANCE_SECONDS = 0.12;
const SUPPORTED_AUDIO_EXTENSIONS = new Set(["aac", "flac", "m4a", "mp3", "ogg", "opus", "wav", "webm"]);

const DEFAULT_MEASURED_BRIR_URL = "/brir/air_aula_carolina_front_late.wav";
// 레지스트리 스키마가 바뀌어도 이전 immutable 캐시와 섞이지 않도록 버전을 URL에 포함한다.
const BRIR_LIBRARY_URL = "/brir/profiles.json?v=20260803-brir-library-v2";
const DEFAULT_BRIR_PROFILE_ID = "aula";

const HRTF_LIBRARY_URL = "/hrtf/profiles.json";
const DEFAULT_HRTF_PROFILE_ID = "sadie-kemar";

const SPATIAL_ENGINE_DEFAULTS = {
  wet: 1,
  radius: 1.8,
  reflections: 0.78,
};
const SPATIAL_CUBIC_HALL = Object.freeze({
  width: 20,
  depth: 20,
  height: 20,
  wallDistance: 10,
  wallCornerDistance: 14.14,
  roomCornerDistance: 17.32,
  speedOfSound: 343,
});
// 청취자를 20 m 정육면체 공연장 중앙에 놓고 벽·천장까지의 실제 거리를 지연에 반영한다.

// Pair columns: id, azimuth, elevation, distance, gain, delay.

// 80ms 이후에는 무대 폭(ASW)과 분리된 측면·후면·상부 에너지로 포위감(LEV)을 만든다.
// Pair columns: id, azimuth, elevation, distance, gain, delay.

// Pair columns: id, azimuth, elevation, distance, gain, delay.

// 연주자는 모두 청취자 앞 스테이지에 두고, 사방 공간은 별도의 홀·스피커 반사 경로가 담당한다.

// Tap columns: azimuth, elevation, distance, delay, gain; first tap is the anchor.

// 악기 장면은 유지하고 보컬의 공간 전송량을 낮춰 전방 초점을 보존한다.

const STEM_ALIGNMENT_MAX_LAG_SAMPLES = 128;
const STEM_ALIGNMENT_SAMPLE_LIMIT = 24000;
const STEM_ALIGNMENT_MIN_CORRELATION = 0.12;

function createTrackState() {
  return {
    analysis: null,
    audioBuffer: null,
    stemBuffers: null,
    mixtureProfileMemo: {},
    playbackCalibration: null,
    spatialOutputCalibration: null,
    spatialQualityProfile: null,
    stemAlignmentProfile: null,
  };
}

function resetTrackAnalysis() {
  Object.assign(state, createTrackState());
  studioView.resetTrack();
}

const state = {
  ...createTrackState(),
  file: null,
  audioContext: null,
  audioQualityTier: detectAudioQualityTier(),
  runtimeQualityController: null,
  hrtfLibrary: null,
  hrtfLibraryPromise: null,
  hrtfProfileId: DEFAULT_HRTF_PROFILE_ID,
  brirLibrary: null,
  brirLibraryPromise: null,
  brirProfileId: DEFAULT_BRIR_PROFILE_ID,
  brirBuffers: new Map(),
  spatialQaRevision: 0,
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
    density: 0,
  },
};

const analysisTasks = new window.SpatialTaskScope();
const audioRenderer = window.SpatialAudioRenderer.createRenderer(state);

function createSpatialPlaybackGraph(context, buffer, analysis, options = {}) {
  return window.SpatialAudioRenderer.createRenderPlan(state, buffer, analysis, options).render(context);
}

const studioView = window.createSpatialStudioView(state, {
  transport: () => transport,
  analysisRevision: () => analysisTasks.revision,
});
const refs = studioView.refs;

const transport = window.createSpatialTransport({
  readTrack: () => state,
  ensureContext: () => ensureAudioContext(),
  createGraph: (...args) => createPlaybackGraph(...args),
  startSources: (...args) => startGraphSources(...args),
  disconnectGraph: (graph) => disconnectGraph(graph),
  renderGraph(context, buffer, analysis, mode) {
    return mode === "spatial"
      ? createSpatialPlaybackGraph(context, buffer, analysis)
      : audioRenderer.createOriginalPlaybackGraph(context, buffer, analysis);
  },
  onPrepare() {
    studioView.preparePlayback();
  },
  onStart() {
    studioView.onStart();
  },
  onStop({ keepOffset, silent }) {
    studioView.onStop({ keepOffset, silent });
  },
});
state.playback = transport.state;
let {
  togglePlayback,
  startPlayback,
  crossfadePlaybackMode,
  startGraphSources,
  stopPlayback,
  createPlaybackGraph,
  getPlaybackTime,
} = transport;

init();

function init() {
  studioView.applyStoredTheme();
  initializeHrtfProfileControl().catch((error) => {
    console.warn("Measured HRTF library is unavailable; using the parametric fallback.", error);
  });
  initializeBrirProfileControl().catch((error) => {
    console.warn("BRIR library is unavailable; using the early-reflection fallback.", error);
    showBrirProfileFallback();
  });
  studioView.syncFieldModeState();

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
  refs.themeToggle.addEventListener("click", studioView.toggleTheme);
  refs.playButton.addEventListener("click", togglePlayback);
  refs.stopButton.addEventListener("click", stopPlayback);
  refs.exportButton.addEventListener("click", exportFullSpatialWav);
  refs.seekSlider.addEventListener("input", seekToSlider);
  document.addEventListener("keydown", handlePlaybackShortcut);

  refs.modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const nextMode = button.dataset.mode;
      if (!nextMode || nextMode === state.playback.mode) return;
      state.playback.mode = nextMode;
      const time = getPlaybackTime();
      refs.modeButtons.forEach((item) => item.classList.toggle("is-active", item === button));
      studioView.syncFieldModeState();
      if (state.playback.mode === "original") {
        studioView.setRealtimeMetersToZero(time);
      }
      if (!state.playback.playing) {
        if (state.playback.mode === "original") {
          studioView.setRealtimeMetersToZero(state.playback.offset);
        } else {
          studioView.updateRealtimeDisplay(state.playback.offset);
          studioView.updateSoundFieldDisplay(
            state.playback.offset,
            studioView.readSoundFieldScores(state.playback.offset),
          );
        }
        studioView.updateSpectrumDisplay(state.playback.offset, { zero: true });
      }
      if (state.playback.playing) {
        crossfadePlaybackMode(time).catch((error) => {
          if (!state.playback.playing || state.playback.mode !== nextMode) return;
          console.error(error);
          stopPlayback({ keepOffset: true, silent: true });
          state.playback.offset = time;
          startPlayback();
        });
      }
    });
  });

  studioView.drawSpectrumGraph(studioView.state.spectrumLevels, {
    zero: true,
    force: true,
  });
  studioView.setupCanvasResizeObserver();
}

async function ensureHrtfLibrary() {
  if (state.hrtfLibrary) return state.hrtfLibrary;
  if (state.hrtfLibraryPromise) return state.hrtfLibraryPromise;
  state.hrtfLibraryPromise = (async () => {
    const response = await fetch(apiPath(HRTF_LIBRARY_URL), {
      cache: "force-cache",
    });
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
      profiles: Object.freeze(library.profiles.map((profile) => Object.freeze({ ...profile }))),
    });
    return state.hrtfLibrary;
  })().finally(() => {
    state.hrtfLibraryPromise = null;
  });
  return state.hrtfLibraryPromise;
}

function getHrtfLibraryEntry(profileId = state.hrtfProfileId) {
  const profiles = state.hrtfLibrary?.profiles || [];
  return (
    profiles.find((profile) => profile.id === profileId) ||
    profiles.find((profile) => profile.id === state.hrtfLibrary?.defaultId) ||
    profiles[0] ||
    null
  );
}

async function initializeHrtfProfileControl() {
  const library = await ensureHrtfLibrary();
  // 개인 측정값이 없는 기본 환경에서는 가장 보편적인 KEMAR 프로파일을 자동 적용한다.
  state.hrtfProfileId = library.profiles.some((profile) => profile.id === DEFAULT_HRTF_PROFILE_ID)
    ? DEFAULT_HRTF_PROFILE_ID
    : library.defaultId || library.profiles[0].id;
  await ensureUniversalHrtfProfile();
}

async function ensureBrirLibrary() {
  if (state.brirLibrary) return state.brirLibrary;
  if (state.brirLibraryPromise) return state.brirLibraryPromise;
  state.brirLibraryPromise = (async () => {
    const response = await fetch(apiPath(BRIR_LIBRARY_URL), {
      cache: "force-cache",
    });
    if (!response.ok) throw new Error(`BRIR library HTTP ${response.status}`);
    const library = await response.json();
    if (library?.schema !== "SpatialAudioEssential.BRIRLibrary/2.0" || !Array.isArray(library.profiles)) {
      throw new Error("BRIR library registry is invalid");
    }
    state.brirLibrary = Object.freeze({
      ...library,
      profiles: Object.freeze(library.profiles.map((profile) => Object.freeze({ ...profile }))),
    });
    return state.brirLibrary;
  })().finally(() => {
    state.brirLibraryPromise = null;
  });
  return state.brirLibraryPromise;
}

async function initializeBrirProfileControl() {
  const library = await ensureBrirLibrary();
  // 프로젝트가 지향하는 대형 오케스트라 공간을 별도 선택 없이 자동 적용한다.
  state.brirProfileId = library.profiles.some((profile) => profile.id === DEFAULT_BRIR_PROFILE_ID)
    ? DEFAULT_BRIR_PROFILE_ID
    : library.defaultId || library.profiles[0].id;
}

function showBrirProfileFallback() {
  state.brirLibrary = null;
  state.brirProfileId = DEFAULT_BRIR_PROFILE_ID;
}

function handlePlaybackShortcut(event) {
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.code === "Escape" && (state.playback.playing || state.playback.desired)) {
    event.preventDefault();
    stopPlayback();
    return;
  }
  if (event.code !== "Space") return;
  if (!state.audioBuffer || !state.analysis || refs.playButton.disabled) return;
  event.preventDefault();
  event.stopPropagation();
  togglePlayback().catch((error) => {
    console.error(error);
    studioView.showToast("재생 상태를 전환하지 못했습니다.");
  });
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
    wet: clamp(0.78 + openness * 0.05 + dynamics * 0.025 - lowWeight * 0.005, 0.76, 0.86),
    radius: clamp(1.23 + openness * 0.07 + stereoWidth * 0.05 + density * 0.025, 1.2, 1.36),
    reflections: clamp(0.65 + density * 0.1 + sectionEnergy * 0.06 + brightness * 0.03, 0.64, 0.82),
  };
}

function analyzeSpatialQualityInputs(audioBuffer) {
  const quality = window.SpatialAudioQuality;
  if (!quality || !audioBuffer) return;
  const coherence = quality.analyzeMultibandCoherence(audioBuffer);
  const safety = quality.buildSafetyProfile(coherence);
  state.spatialQualityProfile = {
    coherence,
    ...safety,
    objectiveQa: null,
  };
}

function detectAudioQualityTier() {
  const cores = Number(navigator.hardwareConcurrency) || 4;
  const memory = Number(navigator.deviceMemory) || 8;
  if (cores <= 2 || memory <= 2) return "safe";
  if (cores <= 4 || memory <= 4) return "balanced";
  return "full";
}

async function analyzeFile(file) {
  const validationMessage = validateLocalAudioFile(file);
  if (validationMessage) {
    studioView.showToast(validationMessage);
    return;
  }
  const run = analysisTasks.begin();

  stopPlayback();
  state.file = file;
  resetTrackAnalysis();

  studioView.startAnalysisProgress();
  studioView.setAnalysisPhase("upload", "오디오 업로드 및 디코딩 준비 중");
  studioView.setBusy(true, "Demucs stem 분리 및 원본 분석 중");
  refs.trackName.textContent = file.name;
  refs.playButton.disabled = true;
  refs.stopButton.disabled = true;
  refs.seekSlider.disabled = true;

  try {
    const context = await ensureAudioContext();
    if (!run.isCurrent()) return;
    const measuredBrirPromise = ensureMeasuredBrirBuffer(context);
    const universalHrtfPromise = ensureUniversalHrtfProfile();
    const decodePromise = decodeBrowserAudioFile(file, context);
    studioView.setAnalysisPhase("separate", "특성 분석 및 Demucs stem 분리 중");
    const analyzePromise = postAudioForAnalysis(file, run.signal);
    const [decodeResult, analysisResult] = await Promise.allSettled([decodePromise, analyzePromise]);

    if (analysisResult.status === "rejected") {
      throw analysisResult.reason;
    }
    if (!run.isCurrent()) return;

    const analysis = analysisResult.value;
    analysis.clientTiming = {
      uploadAndBackendSeconds: (performance.now() - studioView.state.analysisStartedAt) / 1000,
    };
    const audioBuffer = decodeResult.status === "fulfilled" ? decodeResult.value : null;
    const browserDecodeError = decodeResult.status === "rejected" ? decodeResult.reason : null;

    state.audioBuffer = audioBuffer;
    state.analysis = analysis;
    state.playbackCalibration = audioBuffer ? analyzeAudioBufferCalibration(audioBuffer) : null;
    updateSpatialSettingsFromAnalysis(analysis);
    studioView.setAnalysisPhase("decode", "분석 결과와 stem 오디오 정합성 확인 중");
    const separator = analysis.models.deepSeparator;
    const stemDecodeStarted = performance.now();
    if (separator.status === "completed" && audioBuffer) {
      studioView.setBusy(true, separator.cached ? "캐시된 stem 디코딩 중" : "분리된 stem 디코딩 중");
      const decoded = await loadStemBuffers(context, analysis, audioBuffer, run.signal);
      if (!run.isCurrent()) return;
      state.stemBuffers = decoded.stems;
      state.stemAlignmentProfile = decoded.alignment;
    }
    analysis.clientTiming.stemDecodeSeconds = (performance.now() - stemDecodeStarted) / 1000;
    const qualityStarted = performance.now();
    if (audioBuffer) analyzeSpatialQualityInputs(audioBuffer);
    analysis.clientTiming.qualitySeconds = (performance.now() - qualityStarted) / 1000;
    // 무거운 HRTF/BRIR 검증과 오프라인 보정 중에도 분석 결과를 먼저 표시한다.
    studioView.renderAnalysis(analysis);
    document.body.classList.add("has-analysis");
    refs.playButton.disabled = !audioBuffer;
    refs.stopButton.disabled = !audioBuffer;
    refs.seekSlider.disabled = !audioBuffer;
    await Promise.all([measuredBrirPromise, universalHrtfPromise]);
    if (!run.isCurrent()) return;
    studioView.setAnalysisPhase("render", "공간 오디오 그래프와 시각화 준비 중");
    const calibrationStarted = performance.now();
    if (audioBuffer) {
      const calibration = await calibrateSpatialProcessedOutput(audioBuffer, analysis, { fast: true });
      if (!run.isCurrent()) return;
      state.spatialOutputCalibration = calibration;
      if (state.playback.playing) {
        crossfadePlaybackMode(getPlaybackTime()).catch((error) =>
          console.warn("Calibrated playback refresh failed", error),
        );
      }
      if (state.spatialOutputCalibration?.objectiveQa) {
        state.spatialQualityProfile = {
          ...(state.spatialQualityProfile || {}),
          objectiveQa: state.spatialOutputCalibration.objectiveQa,
        };
      }
    }
    analysis.clientTiming.calibrationSeconds = (performance.now() - calibrationStarted) / 1000;
    if (!run.isCurrent()) return;
    studioView.setBusy(true, "재설계용 원본 출력 경로 준비 중");
    studioView.renderAnalysis(analysis);
    queueSpatialImpulseQa();
    refs.playButton.disabled = !audioBuffer;
    refs.stopButton.disabled = !audioBuffer;
    refs.exportButton.disabled = !audioBuffer;
    refs.seekSlider.disabled = !audioBuffer;
    document.body.classList.add("has-analysis");
    if (browserDecodeError) {
      studioView.setBusy(false, "분석 완료 · 브라우저 디코딩 불가");
      studioView.finishAnalysisProgress(false, "분석 완료 · 재생 디코딩 불가");
      studioView.showToast(getBrowserDecodeMessage(file, browserDecodeError));
      return;
    }
    studioView.setBusy(
      false,
      state.stemBuffers ? (separator.cached ? "캐시 기반 분석 준비 완료" : "Demucs 분석 준비 완료") : "원본 분석 완료",
    );
    studioView.finishAnalysisProgress(
      true,
      state.stemBuffers ? "Demucs Spatial 준비 완료" : "Full-mix fallback 준비 완료",
    );
    studioView.showToast(
      state.stemBuffers
        ? separator.cached
          ? "캐시된 stem 분석 준비가 완료됐습니다."
          : "Demucs stem 분석 준비가 완료됐습니다."
        : "원본 기준선 분석이 완료됐습니다.",
    );
  } catch (error) {
    if (!run.isCurrent() || error?.name === "AbortError") return;
    console.error(error);
    studioView.setBusy(false, getAnalysisFailureStatus(error));
    studioView.finishAnalysisProgress(false, "분석을 완료하지 못했습니다");
    studioView.showToast(error.message || "분석 중 오류가 발생했습니다.");
  } finally {
    analysisTasks.finish(run);
  }
}

function validateLocalAudioFile(file) {
  if (!file || !Number.isFinite(file.size) || file.size <= 0) {
    return "내용이 있는 오디오 파일을 선택하세요.";
  }
  if (file.size > MAX_AUDIO_FILE_BYTES) {
    return `오디오 파일은 최대 ${formatBytes(MAX_AUDIO_FILE_BYTES)}까지 분석할 수 있습니다.`;
  }
  const extension = String(file.name || "")
    .split(".")
    .pop()
    .toLowerCase();
  const isAudioMime = String(file.type || "")
    .toLowerCase()
    .startsWith("audio/");
  if (!SUPPORTED_AUDIO_EXTENSIONS.has(extension) && !isAudioMime) {
    return "MP3, WAV, FLAC, M4A, AAC, OGG, OPUS 또는 WEBM 오디오를 선택하세요.";
  }
  return "";
}

async function decodeBrowserAudioFile(file, context) {
  try {
    const buffer = await file.arrayBuffer();
    const decoded = await context.decodeAudioData(buffer);
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
      : Number.isFinite(samplePeakDb)
        ? samplePeakDb
        : -6,
    approxLufs: Number.isFinite(integratedLufs) ? integratedLufs : Number.isFinite(approxLufs) ? approxLufs : -18,
    sampleRate: buffer?.sampleRate || Number(mix.sampleRate) || 48000,
  };
}

async function calibrateSpatialProcessedOutput(buffer, analysis = state.analysis, options = {}) {
  const OfflineContext = window.OfflineAudioContext;
  if (!OfflineContext || !buffer || buffer.duration <= 0) return null;
  const previewSeconds = Math.min(2, buffer.duration);
  const tailSeconds = audioRenderer.hasMeasuredBrirLibrary() ? 0.9 : 0.45;
  const sampleRate = buffer.sampleRate;
  const renderFrames = Math.max(1, Math.ceil((previewSeconds + tailSeconds) * sampleRate));
  const previewOffsets = getSpatialCalibrationOffsets(
    analysis,
    buffer.duration,
    previewSeconds,
    options.fast === true ? 2 : 4,
    buffer,
  );
  const renderPlan = window.SpatialAudioRenderer.createRenderPlan(state, buffer, analysis, { visualMeters: false });
  const sourcePeakDb = Number(renderPlan.snapshot.playbackCalibration?.estimatedTruePeakDb ?? analysis?.mix?.peakDb);
  const sourcePeak = Number.isFinite(sourcePeakDb) ? 10 ** (sourcePeakDb / 20) : 0;
  const renderPreview = async (calibration, previewOffset, measureLinear = false) => {
    let graph = null;
    try {
      const context = new OfflineContext(2, renderFrames, sampleRate);
      graph = renderPlan.withCalibration(calibration).render(context);
      // Measure the linear signal: an active limiter would hide peaks and invite
      // excessive makeup gain. Playback keeps the emergency peak guard enabled.
      if (measureLinear) graph.peakGuard.ratio.value = 1;
      startGraphSources(graph, previewOffset);
      return await context.startRendering();
    } finally {
      if (graph) disconnectGraph(graph);
    }
  };
  try {
    const firstRenders = [];
    for (const previewOffset of previewOffsets) {
      const rendered = await renderPreview(null, previewOffset, true);
      firstRenders.push({
        rendered,
        calibration: analyzeRenderedSpatialCalibration(rendered, buffer, previewOffset, previewSeconds),
      });
    }
    const firstPass = aggregateSpatialCalibrationResults(firstRenders.map((item) => item.calibration));
    if (!firstPass) return null;
    const toneCurves = firstRenders.map((item, index) =>
      window.SpatialAudioBinauralScene.measureToneCurve(buffer, item.rendered, previewOffsets[index], previewSeconds),
    );
    const toneFrequencies = [...new Set(toneCurves.flatMap((curve) => curve.map((point) => point.frequency)))].sort(
      (a, b) => a - b,
    );
    const measuredToneCurve = toneFrequencies.map((frequency) => {
      const values = toneCurves
        .flatMap((curve) => curve.filter((item) => item.frequency === frequency).map((item) => item.logGain))
        .sort((a, b) => a - b);
      return { frequency, logGain: values[Math.floor(values.length / 2)] };
    });
    const toneCurve = addSpatialClarityTarget(measuredToneCurve);
    if (options.fast === true) {
      const matchedWindows = [];
      for (const previewOffset of previewOffsets) {
        const rendered = await renderPreview({ ...firstPass, toneCurve }, previewOffset);
        matchedWindows.push(analyzeRenderedSpatialCalibration(rendered, buffer, previewOffset, previewSeconds));
      }
      const validated = matchedWindows.filter(Boolean);
      const peakScale = validated.length
        ? Math.min(1, ...validated.map((window) => window.peakHeadroomGain))
        : 1;
      const safeGain = clamp(firstPass.gain * peakScale, 0.5, 4.5);
      return {
        ...firstPass,
        gain: safeGain,
        headroomLimited: firstPass.headroomLimited || safeGain < firstPass.gain - 1e-6,
        originalMatchGain: measureOriginalMatchGain(matchedWindows, safeGain, firstPass.gain, sourcePeak),
        toneCurve,
        objectiveQa: null,
        calibrationDomain: "representative-program-windows",
        calibrationOffsets: previewOffsets,
      };
    }
    // 공간 DSP를 적용한 실제 출력의 여러 대표 구간을 다시 측정한다.
    const initialCalibration = {
      gain: firstPass.gain,
      widthScale: firstPass.widthScale,
      toneCurve,
    };
    const validationRenders = [];
    for (const previewOffset of previewOffsets) {
      const rendered = await renderPreview(initialCalibration, previewOffset);
      validationRenders.push({
        rendered,
        calibration: analyzeRenderedSpatialCalibration(rendered, buffer, previewOffset, previewSeconds),
        response: window.SpatialAudioQuality?.analyzeBinauralResponse(rendered) || null,
      });
    }
    const validation = aggregateSpatialCalibrationResults(validationRenders.map((item) => item.calibration));
    if (!validation) return firstPass;
    const validationLevelErrorDb = getWorstCalibrationLevelErrorDb(validationRenders.map((item) => item.calibration));
    const finalGain = clamp(firstPass.gain * validation.gain, 0.5, 4.5);
    const busLimits = deriveSpatialQaBusLimits(validationRenders.map((item) => item.calibration));

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
        lateralScale: busLimits.lateralScale,
        toneCurve,
      };
      for (const previewOffset of previewOffsets) {
        const rendered = await renderPreview(limitedCalibration, previewOffset);
        finalRenders.push({
          rendered,
          calibration: analyzeRenderedSpatialCalibration(rendered, buffer, previewOffset, previewSeconds),
          response: window.SpatialAudioQuality?.analyzeBinauralResponse(rendered) || null,
        });
      }
      finalValidation = aggregateSpatialCalibrationResults(finalRenders.map((item) => item.calibration)) || validation;
      appliedGain = clamp(finalGain * finalValidation.gain, 0.5, 4.5);
    }
    const objectiveQa = buildSpatialProgramObjectiveQa(finalRenders, busLimits);
    return {
      ...finalValidation,
      gain: appliedGain,
      originalMatchGain: measureOriginalMatchGain(
        finalRenders.map((item) => item.calibration),
        appliedGain,
        busLimits.limited ? finalGain : firstPass.gain,
        sourcePeak,
      ),
      toneCurve,
      widthScale: firstPass.widthScale,
      roomScale: busLimits.roomScale,
      lateralScale: busLimits.lateralScale,
      firstPassGain: firstPass.gain,
      headroomLimited: firstPass.headroomLimited || validation.headroomLimited || finalValidation.headroomLimited,
      validationGain: finalValidation.rmsMatchGain,
      validationLevelErrorDb,
      objectiveQa,
      calibrationDomain: "representative-program-windows",
      calibrationOffsets: previewOffsets,
      qaLimited: busLimits.limited,
      qaLimitReasons: busLimits.reasons,
    };
  } catch (error) {
    console.warn("Processed Spatial output calibration is unavailable; using predictive headroom.", error);
    return null;
  }
}

function queueSpatialImpulseQa() {
  if (!state.audioBuffer || !state.analysis || !window.OfflineAudioContext) return;
  const revision = ++state.spatialQaRevision;
  state.spatialQualityProfile = {
    ...(state.spatialQualityProfile || {}),
    objectiveQa: null,
    qaStatus: "measuring",
  };
  const measureWhenIdle = () => {
    if (revision !== state.spatialQaRevision) return;
    if (state.playback.playing || state.playback.desired) {
      window.setTimeout(measureWhenIdle, 1000);
      return;
    }
    renderSpatialImpulseQa(revision).catch((error) => {
      if (revision !== state.spatialQaRevision) return;
      console.warn("Impulse-domain Spatial QA unavailable.", error);
      state.spatialQualityProfile = {
        ...(state.spatialQualityProfile || {}),
        qaStatus: "unavailable",
      };
    });
  };
  window.setTimeout(measureWhenIdle, 50);
}

async function renderSpatialImpulseQa(revision) {
  const sampleRate = state.audioBuffer.sampleRate;
  const tailSeconds = audioRenderer.hasMeasuredBrirLibrary()
    ? Math.min(4.2, state.measuredBrirBuffer.duration + 0.65)
    : 1.8;
  const context = new window.OfflineAudioContext(2, Math.ceil(tailSeconds * sampleRate), sampleRate);
  const impulse = context.createBuffer(2, Math.ceil(tailSeconds * sampleRate), sampleRate);
  impulse.getChannelData(0)[0] = 0.25;
  impulse.getChannelData(1)[0] = 0.25;
  const graph = createSpatialPlaybackGraph(context, impulse, state.analysis, {
    ignoreStems: true,
  });
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
      status:
        Math.abs(metrics.balanceDb) <= 1.25 &&
        metrics.peakDbfs <= -0.02 &&
        Number.isFinite(metrics.edtSeconds) &&
        Number.isFinite(metrics.iacc80) &&
        Number.isFinite(metrics.iaccLate)
          ? "pass"
          : "review",
    };
    state.spatialQualityProfile = {
      ...(state.spatialQualityProfile || {}),
      objectiveQa,
      qaStatus: "ready",
    };
    state.spatialOutputCalibration = {
      ...(state.spatialOutputCalibration || {}),
      objectiveQa,
    };
  } finally {
    disconnectGraph(graph);
  }
}

async function exportFullSpatialWav() {
  if (state.exportInProgress || !state.audioBuffer || !state.analysis) return;
  const OfflineContext = window.OfflineAudioContext;
  if (!OfflineContext) {
    studioView.showToast("이 브라우저는 Full Spatial 오프라인 렌더링을 지원하지 않습니다.");
    return;
  }

  const buffer = state.audioBuffer;
  const exportName = String(state.file?.name || "audio").replace(/\.[^.]+$/, "");
  const sampleRate = buffer.sampleRate;
  const tailSeconds = audioRenderer.hasMeasuredBrirLibrary() ? 3.2 : 1.8;
  const frameCount = Math.ceil((buffer.duration + tailSeconds) * sampleRate);
  const estimatedWorkingBytes = frameCount * 2 * 4 * 4;
  if (estimatedWorkingBytes > 1024 * 1024 * 1024) {
    studioView.showToast("브라우저 메모리 보호를 위해 이 길이의 곡은 WAV로 내보낼 수 없습니다.");
    return;
  }

  state.exportInProgress = true;
  refs.exportButton.disabled = true;
  refs.exportButton.textContent = "Rendering…";
  let graph = null;
  try {
    const context = new OfflineContext(2, frameCount, sampleRate);
    graph = createSpatialPlaybackGraph(context, buffer, state.analysis, { visualMeters: false });
    startGraphSources(graph, 0);
    const rendered = await context.startRendering();
    refs.exportButton.textContent = "Metering…";
    const meterBlob = await encodeWaveBlobAsync(rendered, {
      bitDepth: 32,
      float: true,
      gain: 1,
    });
    const response = await fetch(apiPath(`/api/measure-output?filename=${encodeURIComponent("full-spatial.wav")}`), {
      method: "POST",
      headers: { "Content-Type": "audio/wav" },
      body: meterBlob,
    });
    if (!response.ok) throw new Error(await readApiError(response));
    const measurement = await response.json();
    const truePeakDb = Number(measurement.estimatedTruePeakDb);
    const finalGain = Number.isFinite(truePeakDb) && truePeakDb > -1 ? Math.pow(10, (-1 - truePeakDb) / 20) : 1;
    const outputBlob = await encodeWaveBlobAsync(rendered, {
      bitDepth: 24,
      float: false,
      gain: finalGain,
    });
    downloadBlob(outputBlob, `${exportName} - Full Spatial 24bit.wav`);
    const finalTruePeakDb = Number.isFinite(truePeakDb) ? Math.min(-1, truePeakDb) : -1;
    studioView.showToast(
      `Full Spatial WAV 완료 · ${measurement.integratedLufs} LUFS-I · ${finalTruePeakDb.toFixed(2)} dBTP`,
    );
  } catch (error) {
    console.error(error);
    studioView.showToast(error.message || "Full Spatial WAV 렌더링에 실패했습니다.");
  } finally {
    if (graph) disconnectGraph(graph);
    state.exportInProgress = false;
    refs.exportButton.disabled = !state.audioBuffer;
    refs.exportButton.textContent = "24-bit WAV";
  }
}

function createWaveEncoder(audioBuffer, options = {}) {
  const bitDepth = options.bitDepth === 24 ? 24 : 32;
  const isFloat = options.float === true && bitDepth === 32;
  const requestedGain = Number(options.gain ?? 1);
  const gain = Number.isFinite(requestedGain) ? clamp(requestedGain, 0, 1) : 1;
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
  function writeFrames(start, end) {
    let offset = 44 + start * channels * bytesPerSample;
    for (let frame = start; frame < end; frame += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        const inputSample = channelData[channel][frame] * gain;
        const finiteSample = Number.isFinite(inputSample) ? inputSample : 0;
        if (isFloat) {
          // Float WAV is used for metering and must preserve peaks above 0 dBFS.
          view.setFloat32(offset, finiteSample, true);
        } else {
          const sample = clamp(finiteSample, -1, 1);
          const value = Math.round(sample < 0 ? sample * 0x800000 : sample * 0x7fffff);
          view.setUint8(offset, value & 0xff);
          view.setUint8(offset + 1, (value >> 8) & 0xff);
          view.setUint8(offset + 2, (value >> 16) & 0xff);
        }
        offset += bytesPerSample;
      }
    }
  }
  return { writeFrames, finish: () => new Blob([array], { type: "audio/wav" }) };
}

function encodeWaveBlob(audioBuffer, options = {}) {
  const encoder = createWaveEncoder(audioBuffer, options);
  encoder.writeFrames(0, audioBuffer.length);
  return encoder.finish();
}

async function encodeWaveBlobAsync(audioBuffer, options = {}) {
  const encoder = createWaveEncoder(audioBuffer, options);
  const framesPerChunk = 65536;
  for (let start = 0; start < audioBuffer.length; start += framesPerChunk) {
    encoder.writeFrames(start, Math.min(start + framesPerChunk, audioBuffer.length));
    // Give playback and user input a chance to run between encoding chunks.
    if (start + framesPerChunk < audioBuffer.length) {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
  }
  return encoder.finish();
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
  const center = (duration * (loudestIndex + 0.5)) / points.length;
  return clamp(center - previewSeconds * 0.5, 0, Math.max(0, duration - previewSeconds));
}

function getSpatialCalibrationOffsets(analysis, duration, previewSeconds, maximumWindows = 4, buffer = null) {
  const latestStart = Math.max(0, duration - previewSeconds);
  if (latestStart <= 0) return [0];
  const sections = Array.isArray(analysis?.sections) ? analysis.sections : [];
  const candidates = [];
  if (buffer?.length && buffer.sampleRate > 0) {
    let peak = 0;
    let peakIndex = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const samples = buffer.getChannelData(channel);
      for (let index = 0; index < samples.length; index += 1) {
        const amplitude = Math.abs(samples[index]);
        if (amplitude > peak) {
          peak = amplitude;
          peakIndex = index;
        }
      }
    }
    if (peak > 1e-8) {
      // Include lead-in for the directional and room filters before the peak.
      candidates.push(clamp(peakIndex / buffer.sampleRate - previewSeconds * 0.5, 0, latestStart));
    }
  }
  candidates.push(getLoudestPreviewOffset(analysis?.waveform, duration, previewSeconds));
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
    candidates.push((latestStart * index) / Math.max(1, maximumWindows - 1));
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

// A gentle, fixed common target keeps the direct and ambient paths coherent.
// A small low shelf preserves bass while the upper target stays fixed over time.
function addSpatialClarityTarget(points = []) {
  const base = points.filter((point) => Number.isFinite(point.frequency) && point.frequency > 0 &&
    Number.isFinite(point.logGain)).slice().sort((a, b) => a.frequency - b.frequency);
  const frequencies = [...new Set([...base.map((point) => point.frequency),
    40, 100, 250, 500, 1000, 2000, 3000, 4000, 6000, 9000, 14000, 20000])].sort((a, b) => a - b);
  return frequencies.map((frequency) => {
    const upper = base.findIndex((point) => point.frequency >= frequency);
    let original = 0;
    if (base.length) {
      if (upper < 0) original = base[base.length - 1].logGain;
      else if (upper === 0) original = base[0].logGain;
      else {
        const a = base[upper - 1], b = base[upper];
        const amount = Math.log(frequency / a.frequency) / Math.log(b.frequency / a.frequency);
        original = a.logGain + amount * (b.logGain - a.logGain);
      }
    }
    const distance = Math.log(frequency / 3000) / 0.55;
    const presenceDb = Math.exp(-0.5 * distance * distance);
    const ratio = frequency / 6500;
    const airDb = 0.7 * ratio * ratio / (1 + ratio * ratio);
    const bassRatio = frequency / 130;
    const bassDb = 0.3 / (1 + bassRatio ** 4);
    return {frequency, logGain: clamp(original + (bassDb + presenceDb + airDb) * Math.LN10 / 20, -Math.LN2, Math.LN2)};
  });
}

function getCalibrationLevelErrorDb(result) {
  if (!result) return 0;
  return 20 * Math.log10(Math.max(1e-12, result.renderedRms) / Math.max(1e-12, result.referenceRms));
}

function getWorstCalibrationLevelErrorDb(results = []) {
  return results.reduce((worst, result) => {
    const current = getCalibrationLevelErrorDb(result);
    return Math.abs(current) > Math.abs(worst) ? current : worst;
  }, 0);
}

function measureOriginalMatchGain(results = [], appliedGain = 1, renderedGain = appliedGain, sourcePeak = 0) {
  const ratios = results
    .filter((result) => result && result.referenceRms > 1e-8 && Number.isFinite(result.renderedRms))
    .map((result) => result.renderedRms / result.referenceRms * appliedGain / renderedGain)
    .filter((gain) => Number.isFinite(gain) && gain > 0)
    .sort((a, b) => a - b);
  if (!ratios.length) return 1;
  const middle = Math.floor(ratios.length / 2);
  const median = ratios.length % 2 ? ratios[middle] : (ratios[middle - 1] + ratios[middle]) * 0.5;
  const peak = Math.max(sourcePeak, ...results.filter(Boolean).map((result) => Number(result.referencePeak) || 0));
  const safeMaximum = peak > 1e-8 ? Math.min(4.5, 0.98 / peak) : 4.5;
  return clamp(median, 0.05, safeMaximum);
}

function aggregateSpatialCalibrationResults(results = []) {
  const valid = results.filter((result) => result && Number.isFinite(result.rmsMatchGain));
  if (!valid.length) return null;
  const sortedGains = valid.map((result) => result.rmsMatchGain).sort((a, b) => a - b);
  const middle = Math.floor(sortedGains.length / 2);
  const medianGain =
    sortedGains.length % 2 ? sortedGains[middle] : (sortedGains[middle - 1] + sortedGains[middle]) * 0.5;
  const safeGain = Math.min(medianGain, ...valid.map((result) => result.peakHeadroomGain));
  const representative = valid.reduce(
    (worst, result) =>
      Math.abs(getCalibrationLevelErrorDb(result)) > Math.abs(getCalibrationLevelErrorDb(worst)) ? result : worst,
    valid[0],
  );
  return {
    ...representative,
    gain: safeGain,
    headroomLimited: safeGain < medianGain - 1e-6,
    rmsMatchGain: medianGain,
    renderedPeak: Math.max(...valid.map((result) => result.renderedPeak)),
    referencePeak: Math.max(...valid.map((result) => result.referencePeak)),
    peakHeadroomGain: Math.min(...valid.map((result) => result.peakHeadroomGain)),
    widthScale: Math.min(...valid.map((result) => result.widthScale)),
    windowCount: valid.length,
    windowOffsets: valid.map((result) => result.offsetSeconds),
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
    iaccLate: averageMetric("iaccLate", 1),
    listenerEnvelopment: averageMetric("listenerEnvelopment", 0),
    c80Db: averageMetric("c80Db", 0),
    edtSeconds: averageMetric("edtSeconds", 0),
    balanceDb: averageMetric("balanceDb", 0),
    levelDeltaDb: worstLevelDeltaDb,
    balanceDeltaDb: worstBalanceDeltaDb,
    renderedPeak: maximumPeak,
    measurementDomain: "representative-program-windows",
    windowCount: rows.length,
    spatialBusLimited: Boolean(busLimits.limited),
    status:
      Math.abs(worstLevelDeltaDb) <= 1 && Math.abs(worstBalanceDeltaDb) <= 0.75 && maximumPeak <= 0.995
        ? "pass"
        : "review",
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
  const stereoCorrelation =
    leftEnergy > 1e-12 && rightEnergy > 1e-12 ? clamp(crossEnergy / Math.sqrt(leftEnergy * rightEnergy), -1, 1) : 1;
  const channelBalanceDb = leftEnergy > 1e-12 && rightEnergy > 1e-12 ? 10 * Math.log10(leftEnergy / rightEnergy) : 0;
  const widthScale = stereoCorrelation < -0.12 ? clamp(mapRange(stereoCorrelation, -1, -0.12, 0.62, 1), 0.62, 1) : 1;
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
    previewSeconds,
  };
}

function getAudioBufferWindowStats(buffer, offsetSeconds = 0, durationSeconds = buffer?.duration || 0) {
  if (!buffer || buffer.numberOfChannels < 1 || buffer.length < 1) {
    return {
      rms: 0,
      peak: 0,
      samples: 0,
      stereoCorrelation: 1,
      channelBalanceDb: 0,
    };
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
  const stereoCorrelation =
    leftEnergy > 1e-12 && rightEnergy > 1e-12 ? clamp(crossEnergy / Math.sqrt(leftEnergy * rightEnergy), -1, 1) : 1;
  const channelBalanceDb = leftEnergy > 1e-12 && rightEnergy > 1e-12 ? 10 * Math.log10(leftEnergy / rightEnergy) : 0;
  return {
    rms: Math.sqrt(energy / Math.max(1, samples)),
    peak,
    samples,
    stereoCorrelation,
    channelBalanceDb,
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
    demucs_model: DEMUCS_MODEL,
  });
  let response;
  try {
    response = await fetch(apiPath(`/api/analyze?${params.toString()}`), {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
      signal,
    });
  } catch (error) {
    if (error && error.name === "AbortError") throw error;
    const wrapped = new Error(
      "백엔드 서버에 연결할 수 없습니다. start.ps1을 실행한 뒤 http://127.0.0.1:8768/에서 다시 시도하세요.",
    );
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

async function loadStemBuffers(context, analysis, referenceBuffer, signal) {
  const stems = getDemucsStemItems(analysis);
  if (!stems.length) return { stems: null, alignment: null };
  const loaded = {};
  const settled = await Promise.allSettled(
    stems.map(async (stem) => {
      if (!isSafeOutputPath(stem.path)) {
        throw new Error(`${stem.label} stem 경로가 안전하지 않습니다.`);
      }
      const response = await fetch(apiPath(`/outputs/${stem.path}`), {
        signal,
      });
      if (!response.ok) throw new Error(`${stem.label} stem 로드 실패 (${response.status})`);
      const data = await response.arrayBuffer();
      const buffer = await context.decodeAudioData(data);
      if (!isAlignedStemBuffer(buffer, referenceBuffer)) {
        throw new Error(`${stem.label} stem의 길이가 원본과 일치하지 않습니다.`);
      }
      loaded[stem.id] = {
        ...stem,
        buffer,
        stereoPosition: await analyzeStemStereoPositionAsync(buffer, signal),
      };
    }),
  );
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const failed = settled
    .map((item, index) => ({ item, stem: stems[index] }))
    .filter(({ item }) => item.status === "rejected");
  if (failed.length || CORE_STEM_ORDER.some((stemId) => !loaded[stemId])) {
    console.warn(
      "Demucs Stem을 검증하지 못해 위상 안전 Full-mix 경로로 전환합니다.",
      failed.map(({ item, stem }) => ({
        stem: stem.id,
        reason: item.reason instanceof Error ? item.reason.message : String(item.reason),
      })),
    );
    return { stems: null, alignment: null };
  }
  const alignment = await estimateStemSetAlignmentAsync(referenceBuffer, loaded, signal);
  if (!alignment.reliable) {
    console.warn("Stem sample alignment confidence is too low; using the phase-safe full-mix fallback.", alignment);
    return { stems: null, alignment: null };
  }
  Object.values(loaded).forEach((stem) => {
    stem.alignmentSamples = alignment.lagSamples;
    stem.alignmentOffsetSeconds = alignment.lagSamples / referenceBuffer.sampleRate;
  });
  return { stems: loaded, alignment };
}

function analyzeStemStereoPosition(buffer) {
  const analysis = stemStereoPositionSteps(buffer);
  let step;
  do { step = analysis.next(); } while (!step.done);
  return step.value;
}

async function analyzeStemStereoPositionAsync(buffer, signal) {
  const analysis = stemStereoPositionSteps(buffer);
  let step, processed = 0;
  let sliceStarted = performance.now();
  do {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    step = analysis.next();
    if (!step.done && (++processed >= 16 || performance.now() - sliceStarted >= 8)) {
      await yieldStemAnalysis();
      processed = 0;
      sliceStarted = performance.now();
    }
  } while (!step.done);
  return step.value;
}

function yieldStemAnalysis() {
  if (typeof MessageChannel !== "function") return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(0);
  });
}

function* stemStereoPositionSteps(buffer) {
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
  const count = Math.max(1, Math.min(900, Math.ceil(buffer.duration * 6)));
  const windows = [];
  let totalLeft = 0,
    totalRight = 0;
  for (let index = 0; index < count; index += 1) {
    const start = Math.floor((index * buffer.length) / count);
    const end = Math.floor(((index + 1) * buffer.length) / count);
    let l = 0,
      r = 0;
    for (let chunkStart = start; chunkStart < end; chunkStart += 32768) {
      const chunkEnd = Math.min(end, chunkStart + 32768);
      if (right) {
        for (let frame = chunkStart; frame < chunkEnd; frame += 1) {
          l += left[frame] ** 2;
          r += right[frame] ** 2;
        }
      } else {
        for (let frame = chunkStart; frame < chunkEnd; frame += 1) l += left[frame] ** 2;
      }
      if (chunkEnd < end) yield;
    }
    if (!right) r = l;
    totalLeft += l;
    totalRight += r;
    windows.push({ l, r, energy: (l + r) / Math.max(1, end - start) });
    yield;
  }
  const pan = (totalRight - totalLeft) / Math.max(1e-12, totalRight + totalLeft);
  const peak = Math.max(...windows.map((item) => item.energy), 1e-12);
  return {
    pan,
    confidence: totalLeft + totalRight > 1e-9 ? 1 : 0,
    panCurve: windows.map(({ l, r, energy }) =>
      energy > Math.max(1e-10, peak * 0.002) ? (r - l) / Math.max(1e-12, r + l) : pan,
    ),
  };
}

function isSafeOutputPath(path) {
  if (typeof path !== "string" || !path || path.includes("\0")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("/") || path.startsWith("\\")) return false;
  return !path.split(/[\\/]+/).includes("..");
}

function isAlignedStemBuffer(buffer, referenceBuffer) {
  if (!buffer || !referenceBuffer) return false;
  if (buffer.numberOfChannels < 1 || buffer.numberOfChannels > 2) return false;
  const tolerance = Math.max(STEM_DURATION_TOLERANCE_SECONDS, referenceBuffer.duration * 0.002);
  return Math.abs(buffer.duration - referenceBuffer.duration) <= tolerance;
}

function estimateStemSetAlignment(referenceBuffer, loadedStems) {
  const analysis = stemAlignmentSteps(referenceBuffer, loadedStems);
  let step;
  do { step = analysis.next(); } while (!step.done);
  return step.value;
}

async function estimateStemSetAlignmentAsync(referenceBuffer, loadedStems, signal) {
  const analysis = stemAlignmentSteps(referenceBuffer, loadedStems);
  let step, processed = 0, sliceStarted = performance.now();
  do {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    step = analysis.next();
    if (!step.done && (++processed >= 4 || performance.now() - sliceStarted >= 8)) {
      await yieldStemAnalysis();
      processed = 0;
      sliceStarted = performance.now();
    }
  } while (!step.done);
  return step.value;
}

function* stemAlignmentSteps(referenceBuffer, loadedStems) {
  const stems = Object.values(loadedStems || {}).filter((stem) => stem?.buffer);
  if (!referenceBuffer || !stems.length) {
    return {
      lagSamples: 0,
      correlation: 0,
      reliable: false,
      inspectedSamples: 0,
    };
  }
  const maxLag = Math.min(STEM_ALIGNMENT_MAX_LAG_SAMPLES, Math.max(0, Math.floor(referenceBuffer.length / 8)));
  const length = Math.min(referenceBuffer.length, ...stems.map((stem) => stem.buffer.length));
  const usable = length - maxLag * 2 - 1;
  if (usable <= 32) {
    return {
      lagSamples: 0,
      correlation: 0,
      reliable: false,
      inspectedSamples: 0,
    };
  }
  const sampleCount = Math.min(STEM_ALIGNMENT_SAMPLE_LIMIT, usable);
  const windowCount = Math.min(8, Math.max(1, Math.ceil(sampleCount / 3000)));
  const windowLength = Math.floor(sampleCount / windowCount);
  const windows = Array.from({ length: windowCount }, (_, index) => {
    const start = maxLag + (windowCount === 1 ? 0 : Math.floor(index * (usable - windowLength) / (windowCount - 1)));
    return { start, end: start + windowLength };
  });
  const referenceChannels = Array.from({ length: referenceBuffer.numberOfChannels }, (_, channel) =>
    referenceBuffer.getChannelData(channel),
  );
  const hasWindowSignal = windows.some(({ start, end }) => referenceChannels.some((data) => {
    for (let index = start; index < end; index += 1) if (Math.abs(data[index]) > 1e-5) return true;
    return false;
  }));
  if (!hasWindowSignal) {
    // A sparse track can fall entirely between the distributed windows.
    let found = false;
    for (let index = maxLag; index < maxLag + usable; index += 1) {
      let active = false;
      for (const data of referenceChannels) {
        if (Math.abs(data[index]) > 1e-5) { active = true; break; }
      }
      if (active) {
        const start = Math.max(maxLag, Math.min(index - Math.floor(windowLength / 2), maxLag + usable - windowLength));
        windows[0] = { start, end: start + windowLength };
        found = true;
        break;
      }
      if ((index - maxLag + 1) % 32768 === 0) yield;
    }
    if (!found) return { lagSamples: 0, correlation: 0, reliable: false, inspectedSamples: windowCount * windowLength };
  }
  const stemChannels = stems.map((stem) =>
    Array.from({ length: stem.buffer.numberOfChannels }, (_, channel) => stem.buffer.getChannelData(channel)),
  );
  const channelCount = Math.min(2, Math.max(referenceChannels.length, ...stemChannels.map((channels) => channels.length)));
  const summedWindows = windows.map(({ start, end }) => {
    const first = start - maxLag;
    const channels = Array.from({ length: channelCount }, () => new Float64Array(end - start + maxLag * 2));
    for (let channel = 0; channel < channelCount; channel += 1) {
      const output = channels[channel];
      for (let frame = 0; frame < output.length; frame += 1) {
        const index = first + frame;
        let sum = 0;
        for (const stem of stemChannels) {
          sum += stem[Math.min(channel, stem.length - 1)][index] || 0;
        }
        output[frame] = sum;
      }
    }
    return { start, end, first, channels };
  });
  let bestLag = 0;
  let bestCorrelation = -1;
  let referencePowerAtZero = 0;

  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    let dot = 0;
    let referencePower = 0;
    let stemPower = 0;
    for (const { start, end, first, channels } of summedWindows) for (let index = start; index < end; index += 1) {
      for (let channel = 0; channel < channelCount; channel += 1) {
        const reference = referenceChannels[Math.min(channel, referenceChannels.length - 1)][index] || 0;
        const stemSum = channels[channel][index + lag - first];
        dot += reference * stemSum;
        referencePower += reference * reference;
        stemPower += stemSum * stemSum;
      }
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
    yield;
  }

  const inspectedSamples = windowCount * windowLength;
  const silent = referencePowerAtZero / Math.max(1, inspectedSamples * channelCount) < 1e-10;
  return {
    lagSamples: silent ? 0 : bestLag,
    correlation: silent ? 0 : bestCorrelation,
    reliable: !silent && bestCorrelation >= STEM_ALIGNMENT_MIN_CORRELATION,
    inspectedSamples,
  };
}

function getDemucsStemItems(analysis) {
  const separator = analysis && analysis.models && analysis.models.deepSeparator;
  if (!separator || separator.status !== "completed" || !Array.isArray(separator.stems)) return [];
  const stemQuality = separator.stemQuality || {};
  const seen = new Set();
  const stems = separator.stems
    .map((path) => {
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
        curve: [],
      };
    })
    .filter(Boolean);
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
  if (state.audioContext?.state === "closed") {
    state.runtimeQualityController?.detach();
    state.audioContext = null;
  }
  if (!state.audioContext) {
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)({
      latencyHint: 0.15,
    });
    const context = state.audioContext;
    context.addEventListener("statechange", () => {
      if (context.state !== "closed" || state.audioContext !== context) return;
      state.runtimeQualityController?.detach();
      if (state.playback.playing) {
        const position = getPlaybackTime();
        stopPlayback({ keepOffset: true });
        state.playback.offset = position;
      }
    });
    configureSpatialListener(state.audioContext);
    setupAudioRenderCapacityMonitor(state.audioContext);
  }
  if (state.audioContext.state === "suspended") {
    const resumePromise = state.audioContext.resume();
    let resumeTimer = null;
    // 자동재생 정책이 resume을 보류해도 파일 분석과 디코딩은 계속 진행한다.
    await Promise.race([
      resumePromise,
      new Promise((resolve) => {
        resumeTimer = window.setTimeout(resolve, AUDIO_CONTEXT_RESUME_WAIT_MS);
      }),
    ]).finally(() => {
      if (resumeTimer !== null) window.clearTimeout(resumeTimer);
    });
  }
  return state.audioContext;
}

function setupAudioRenderCapacityMonitor(context) {
  if (!window.SpatialRuntimeQualityController) return;
  if (state.runtimeQualityController) {
    state.runtimeQualityController.attach(context);
    return;
  }
  const initialTier = state.audioQualityTier;
  state.runtimeQualityController = new window.SpatialRuntimeQualityController({
    initialTier,
    ceilingTier: initialTier,
    onTierChange(change) {
      state.audioQualityTier = change.tier;
      const label = audioRenderer.getAudioQualityProfile().label;
      if (change.reason === "render-overload") {
        studioView.showToast(`오디오 부하를 감지해 ${label}로 안전하게 전환했습니다.`);
      }
      if (state.playback.playing && state.playback.mode === "spatial") {
        crossfadePlaybackMode(getPlaybackTime()).catch((error) =>
          console.warn("Adaptive quality graph rebuild failed", error),
        );
      }
    },
  });
  state.runtimeQualityController.attach(context);
}

function configureSpatialListener(context) {
  const listener = context?.listener;
  if (!listener) return;
  audioRenderer.setAudioParamValue(listener.positionX, 0, context.currentTime);
  audioRenderer.setAudioParamValue(listener.positionY, 0, context.currentTime);
  audioRenderer.setAudioParamValue(listener.positionZ, 0, context.currentTime);
  audioRenderer.setAudioParamValue(listener.forwardX, 0, context.currentTime);
  audioRenderer.setAudioParamValue(listener.forwardY, 0, context.currentTime);
  audioRenderer.setAudioParamValue(listener.forwardZ, -1, context.currentTime);
  audioRenderer.setAudioParamValue(listener.upX, 0, context.currentTime);
  audioRenderer.setAudioParamValue(listener.upY, 1, context.currentTime);
  audioRenderer.setAudioParamValue(listener.upZ, 0, context.currentTime);
  if (typeof listener.setPosition === "function") {
    listener.setPosition(0, 0, 0);
  }
  if (typeof listener.setOrientation === "function") {
    listener.setOrientation(0, 0, -1, 0, 1, 0);
  }
}

function isValidUniversalHrtfProfile(profile) {
  const anthropometry = profile?.anthropometry;
  const cues = profile?.cueModel;
  const schemaValid = ["SpatialAudioEssential.HRTFProfile/1.0", "SpatialAudioEssential.HRTFProfile/1.1"].includes(
    profile?.schema,
  );
  const parametric = profile?.profileType === "generic-parametric-symmetric";
  return Boolean(
    schemaValid &&
      typeof profile?.id === "string" &&
      profile.id.length > 0 &&
      typeof profile?.rendering?.runtimeAsset === "string" &&
      Array.isArray(profile?.directions) &&
      profile.directions.length >= 72 &&
      Number.isFinite(profile?.sampleRate) &&
      profile.sampleRate >= 44100 &&
      Number.isFinite(profile?.impulseLength) &&
      profile.impulseLength >= 128 &&
      (!parametric ||
        (profile?.rendering?.symmetryRequired === true &&
          Number.isFinite(anthropometry?.headRadiusMeters) &&
          anthropometry.headRadiusMeters >= 0.07 &&
          anthropometry.headRadiusMeters <= 0.11 &&
          Number.isFinite(anthropometry?.speedOfSoundMetersPerSecond) &&
          Number.isFinite(cues?.maximumIldDb) &&
          cues.maximumIldDb >= 3 &&
          cues.maximumIldDb <= 15 &&
          Number.isFinite(cues?.frontPinnaNotchHz) &&
          Number.isFinite(cues?.rearPinnaNotchHz))),
  );
}

async function ensureUniversalHrtfProfile() {
  if (state.universalHrtfStatus === "ready" && state.universalHrtfProfile) {
    return state.universalHrtfProfile;
  }
  if (state.universalHrtfPromise) return state.universalHrtfPromise;

  state.universalHrtfStatus = "loading";
  const request = (async () => {
    try {
      // Reserve the request before awaiting the registry so concurrent callers share it.
      const library = await ensureHrtfLibrary();
      const entry = getHrtfLibraryEntry() || library.profiles[0];
      if (!entry) throw new Error("HRTF library has no profiles");
      const requestedId = entry.id;
      state.hrtfProfileId = requestedId;
      const response = await fetch(apiPath(`/hrtf/${entry.profileAsset}`), {
        cache: "force-cache",
      });
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
      return profile;
    } catch (error) {
      state.universalHrtfProfile = null;
      state.universalHrtfDataset = null;
      state.universalHrtfStatus = "fallback";
      console.warn("Universal HRTF unavailable; using the browser native HRTF.", error);
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
    magic !== "SAHRTF1\0" ||
    receiverCount !== 2 ||
    directionCount < 72 ||
    tapCount !== profile.impulseLength ||
    sampleRate !== profile.sampleRate ||
    expectedBytes !== arrayBuffer.byteLength
  ) {
    throw new Error("Universal HRTF runtime asset header is invalid");
  }
  const positions = new Float32Array(arrayBuffer, positionsOffset, directionCount * 3);
  const unitVectors = new Float32Array(directionCount * 3);
  // 렌더 그래프 하나가 여러 HRTF 탭을 만들므로 방향의 삼각함수 계산은 로드 시 한 번만 수행한다.
  for (let direction = 0; direction < directionCount; direction += 1) {
    const offset = direction * 3;
    const vector = audioRenderer.sphericalUnitVector(positions[offset], positions[offset + 1]);
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
    onsets,
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
  const entry = audioRenderer.getBrirLibraryEntry();
  const profileId = entry?.id || DEFAULT_BRIR_PROFILE_ID;
  const cached = state.brirBuffers.get(profileId);
  if (cached) {
    state.measuredBrirBuffer = cached;
    state.measuredBrirStatus = "ready";
    return cached;
  }
  if (audioRenderer.hasMeasuredBrirLibrary() && state.measuredBrirBuffer.spatialBrirProfileId === profileId) {
    return state.measuredBrirBuffer;
  }
  if (state.measuredBrirPromise) return state.measuredBrirPromise;

  state.measuredBrirStatus = "loading";
  state.measuredBrirPromise = (async () => {
    try {
      const response = await fetch(apiPath(entry?.file ? `/brir/${entry.file}` : DEFAULT_MEASURED_BRIR_URL), {
        cache: "force-cache",
      });
      if (!response.ok) {
        throw new Error(`BRIR HTTP ${response.status}`);
      }
      const bytes = await response.arrayBuffer();
      const buffer = await context.decodeAudioData(bytes);
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

function seekToSlider() {
  if (!state.analysis) return;
  const duration = state.analysis.file.duration;
  const nextTime = (Number(refs.seekSlider.value) / 1000) * duration;
  state.playback.offset = nextTime;
  if (state.playback.playing) {
    stopPlayback({ keepOffset: true, silent: true });
    state.playback.offset = nextTime;
    startPlayback();
  } else {
    if (state.playback.mode === "original") {
      studioView.setRealtimeMetersToZero(nextTime);
    } else {
      studioView.updateRealtimeDisplay(nextTime);
      studioView.updateSoundFieldDisplay(nextTime, studioView.readSoundFieldScores(nextTime));
    }
    studioView.updateSpectrumDisplay(nextTime, { zero: true });
    studioView.updateSeek(nextTime, { force: true });
  }
}

function resetApp() {
  analysisTasks.cancel();
  studioView.resetAnalysisProgress();
  stopPlayback();
  state.file = null;
  resetTrackAnalysis();

  studioView.state.liveScores = {};
  state.spatialSettings = { ...SPATIAL_ENGINE_DEFAULTS };
  state.spatialAnalysisSummary = { openness: 0, dynamics: 0, density: 0 };
  refs.fileInput.value = "";
  studioView.syncFieldModeState();
  refs.trackName.textContent = "파일을 선택하세요";
  refs.playButton.disabled = true;
  refs.stopButton.disabled = true;
  refs.exportButton.disabled = true;
  refs.seekSlider.disabled = true;
  refs.instrumentList.innerHTML = "";
  refs.stageMap.innerHTML = "";
  refs.activeCount.textContent = "0 active";
  refs.currentTime.textContent = "0:00";
  refs.totalTime.textContent = "0:00";
  Object.values(refs.metrics).forEach((metric) => {
    metric.textContent = metric.tagName === "STRONG" ? "--" : "";
  });
  document.body.classList.remove("has-analysis", "is-busy");
  drawEmptyWaveform();
  studioView.drawSpectrumGraph(studioView.state.spectrumLevels, {
    zero: true,
    force: true,
  });
  studioView.setBusy(false, "분석 대기 중");
}

window.addEventListener("resize", studioView.scheduleCanvasRedraw);
