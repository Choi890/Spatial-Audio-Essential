(function (global) {
  "use strict";
  const { $, clamp, cssColor, escapeHtml, formatNumber, formatTime, setStyleProperty, setText, toggleClass } =
    global.SpatialAudioUtils;
  const { LIVE_SIGNATURES, METER_FRAME_INTERVAL, SHORT_NAMES, STEM_ORDER, STEM_PROFILES } = global.SpatialAudioConfig;
  const SPECTRUM_BAR_COUNT = 24;
  const VISUAL_FRAME_INTERVAL = 0;
  const UI_FRAME_INTERVAL = METER_FRAME_INTERVAL;
  const HIDDEN_VISUAL_FRAME_INTERVAL = 1 / 8;
  const SPECTRUM_FRAME_INTERVAL = 0;
  const METER_STYLE_EPSILON = 0.001;
  const STEM_METER_DB_OFFSET = -10;
  const MAX_CANVAS_DPR = 2;
  const ANALYSIS_PHASES = {
    upload: { progress: 16, order: 0 },
    separate: { progress: 46, order: 1 },
    decode: { progress: 80, order: 2 },
    render: { progress: 95, order: 3 },
    ready: { progress: 100, order: 4 },
  };
  const RUNTIME_QUALITY_PROFILE = {
    label: "Full",
    meterInterval: 0,
    stemDisplayInterval: 0,
    fieldDisplayInterval: UI_FRAME_INTERVAL,
    spectrumInterval: SPECTRUM_FRAME_INTERVAL,
    seekInterval: UI_FRAME_INTERVAL,
  };
  const STEM_POSITION_GROUPS = {
    vocals: [
      ["piano", 0.92],
      ["violins1", 0.82],
      ["violins2", 0.58],
      ["flute", 0.58],
      ["oboe", 0.5],
      ["trumpet", 0.38],
      ["harp", 0.34],
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
      ["piano", 0.52],
    ],
    drums: [
      ["percussion", 1],
      ["timpani", 0.86],
      ["harp", 0.3],
      ["piano", 0.24],
    ],
    bass: [
      ["basses", 1],
      ["cellos", 0.74],
      ["bassoon", 0.42],
      ["timpani", 0.34],
      ["trombone", 0.24],
    ],
  };
  const STEM_POSITION_BOUNDS = {
    x: [-3.85, 3.85],
    y: [-0.2, 0.68],
    z: [-5.35, -1.15],
  };
  const STEM_POSITION_ANCHORS = {
    vocals: {
      x: 0,
      y: 0.24,
      z: -2.35,
      lateralMix: 0.08,
      verticalMix: 0.34,
      depthMix: 0.46,
      maxAbsX: 0.16,
    },
  };

  function createStudioView(state, hooks) {
    const ui = {
      displayObjects: null,
      liveScores: {},
      meterLevels: {},
      metersZeroed: false,
      fieldLevels: {},
      fieldNodeGroups: {},
      fieldDriftSeeds: {},
      stemPositionCache: {},
      stemDisplayPositions: {},
      meterRows: {},
      lastMeterFrameTime: -1,
      lastStemDisplayFrameTime: -1,
      lastFieldDisplayFrameTime: -1,
      lastSpectrumFrameTime: -1,
      lastSeekFrameTime: -1,
      lastVisualFrameAt: 0,
      visualFrameSeconds: 1 / 30,
      animationId: 0,
      analysisTimer: 0,
      analysisCompletionTimer: 0,
      analysisStartedAt: 0,
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
        gradient: null,
      },
      canvasResizeObserver: null,
      resizeFrame: 0,
      lastLiveAnalysisFrame: null,
      liveOutputLevel: 0,
    };
    const refs = {
      fileInput: $("#audio-file"),
      dropZone: $("#drop-zone"),
      resetButton: $("#reset-button"),
      themeToggle: $("#theme-toggle"),
      themeToggleText: $("#theme-toggle-text"),
      statusText: $("#status-text"),
      toast: $("#toast"),
      analysisProgress: $("#analysis-progress"),
      analysisPhase: $("#analysis-phase"),
      analysisElapsed: $("#analysis-elapsed"),
      analysisProgressTrack: $("#analysis-progress-track"),
      analysisProgressBar: $("#analysis-progress-bar"),
      analysisProgressSteps: Array.from(document.querySelectorAll("[data-analysis-step]")),
      trackName: $("#track-name"),
      playButton: $("#play-button"),
      stopButton: $("#stop-button"),
      exportButton: $("#export-button"),
      seekSlider: $("#seek-slider"),
      currentTime: $("#current-time"),
      totalTime: $("#total-time"),
      modeButtons: Array.from(document.querySelectorAll(".mode-button")),
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
        rolloff: $("#rolloff-value"),
      },
      activeCount: $("#active-count"),
      frameTime: $("#frame-time"),
      stageMap: $("#stage-map"),
      spectrumCanvas: $("#spectrum-canvas"),
      instrumentList: $("#instrument-list"),
    };
    const getPlaybackTime = () => hooks.transport().getPlaybackTime();
    const stopPlayback = (...args) => hooks.transport().stopPlayback(...args);

    function preparePlayback() {
      resetLiveAnalysisCache();
      ui.lastVisualFrameAt = 0;
      ui.lastStemDisplayFrameTime = -1;
      ui.lastFieldDisplayFrameTime = -1;
      ui.lastSpectrumFrameTime = -1;
      ui.lastSeekFrameTime = -1;
    }
    function onStart() {
      refs.playButton.textContent = "Ⅱ";
      tick();
    }
    function onStop({ keepOffset, silent }) {
      if (ui.animationId) {
        cancelAnimationFrame(ui.animationId);
        ui.animationId = 0;
      }
      ui.lastMeterFrameTime = -1;
      ui.lastStemDisplayFrameTime = -1;
      ui.lastFieldDisplayFrameTime = -1;
      ui.lastSpectrumFrameTime = -1;
      ui.lastSeekFrameTime = -1;
      ui.lastVisualFrameAt = 0;
      resetLiveAnalysisCache();
      if (!keepOffset) {
        Object.keys(ui.meterLevels).forEach((id) => {
          ui.meterLevels[id] = 0;
        });
        Object.keys(ui.fieldLevels).forEach((id) => {
          ui.fieldLevels[id] = 0;
        });
      }

      refs.playButton.textContent = "▶";
      if (!silent) {
        if (state.playback.mode === "original") {
          setRealtimeMetersToZero(state.playback.offset);
          updateSpectrumDisplay(state.playback.offset, { zero: true });
        } else {
          updateRealtimeDisplay(state.playback.offset);
          updateSpectrumDisplay(state.playback.offset, { zero: true });
        }
        updateSeek(state.playback.offset, { force: true });
      }
    }
    function resetTrack() {
      Object.assign(ui, {
        displayObjects: null,
        liveScores: {},
        meterLevels: {},
        metersZeroed: false,
        fieldLevels: {},
        fieldNodeGroups: {},
        fieldDriftSeeds: {},
        stemPositionCache: {},
        stemDisplayPositions: {},
        meterRows: {},
        lastMeterFrameTime: -1,
        lastStemDisplayFrameTime: -1,
        lastFieldDisplayFrameTime: -1,
        lastSpectrumFrameTime: -1,
        lastSeekFrameTime: -1,
        lastVisualFrameAt: 0,
      });
      resetSpectrumState();
      resetLiveAnalysisCache();
    }
    function syncFieldModeState() {
      refs.stageMap.dataset.mode = state.playback.mode;
      document.body.dataset.playbackMode = state.playback.mode;
    }

    function resetLiveAnalysisCache() {
      ui.lastLiveAnalysisFrame = null;
      ui.liveOutputLevel = 0;
    }

    function getRuntimeQualityProfile() {
      return RUNTIME_QUALITY_PROFILE;
    }

    function renderAnalysis(analysis) {
      const file = analysis.file;
      refs.trackName.textContent = file.name;
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
      refs.activeCount.textContent = state.stemBuffers
        ? `${objects.length} stems`
        : `${analysis.activeIds.length} active`;
      refs.stageMap.innerHTML = `
        <div class="field-grid" aria-hidden="true"></div>
        <div class="field-depth depth-near" aria-hidden="true"></div>
        <div class="field-depth depth-far" aria-hidden="true"></div>
        <div class="field-node-layer">
          ${createStageNodes(objects)
            .map(
              (node) => `
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
          `,
            )
            .join("")}
        </div>
      `;
      cacheFieldNodes();
      updateStagePositions();
    }

    function createStageNodes(objects) {
      if (!objects.length) return [];
      return objects.map((object, index) => {
        const point = getObjectStagePoint(object, index, objects.length, null, {
          immediate: true,
        });
        return {
          object,
          index,
          left: point.left,
          top: point.top,
          short: object.short || SHORT_NAMES[object.id] || object.label,
          label: object.label,
          color: object.color,
        };
      });
    }

    function getObjectStagePoint(object, index = 0, total = 1, time = 0, options = {}) {
      const position = getObjectRenderPosition(object, time, options);
      if (position && Number.isFinite(position.x) && Number.isFinite(position.z)) {
        return {
          left: clamp(50 + position.x * 10.7, 14, 86),
          top: clamp(72 + position.z * 8.0 - (position.y || 0) * 8.5 + index * 0.38, 16, 84),
        };
      }
      const angle = total > 1 ? (index / Math.max(1, total - 1)) * Math.PI : Math.PI * 0.5;
      return {
        left: clamp(18 + Math.cos(Math.PI - angle) * 32 + index * 0.4, 14, 86),
        top: clamp(34 + Math.sin(angle) * 36, 16, 84),
      };
    }

    function getPositionPan(stereo, time) {
      const curve = stereo?.panCurve;
      if (!curve?.length || !Number.isFinite(time)) return clamp(Number(stereo?.pan) || 0, -1, 1);
      const duration = state.analysis?.file?.duration || 1;
      const value = clamp(time / duration, 0, 1) * (curve.length - 1);
      const index = Math.floor(value);
      return clamp(
        curve[index] + (curve[Math.min(index + 1, curve.length - 1)] - curve[index]) * (value - index),
        -1,
        1,
      );
    }

    function updateStagePositions() {
      if (!state.analysis) return;
      const objects = getDisplayObjects(state.analysis);
      const width = refs.stageMap.clientWidth;
      const height = refs.stageMap.clientHeight;
      if (!width || !height) return;
      const first = refs.stageMap.querySelector(".stage-node");
      const cardWidth = (first?.offsetWidth || 118) * 1.03;
      const cardHeight = (first?.offsetHeight || 56) + 12;
      const placed = [];
      objects.forEach((object, index) => {
        const anchor = getObjectStagePoint(object, index, objects.length, null, { immediate: true });
        const target = {
          x: (anchor.left * width) / 100,
          y: (anchor.top * height) / 100,
        };
        let best = null;
        for (let row = -5; row <= 5; row += 1) {
          for (let column = -2; column <= 2; column += 1) {
            const x = clamp(target.x + column * (cardWidth + 10), cardWidth / 2 + 8, width - cardWidth / 2 - 8);
            const y = clamp(target.y + row * (cardHeight + 8), cardHeight / 2 + 8, height - cardHeight / 2 - 8);
            const overlap = placed.reduce(
              (sum, item) =>
                sum +
                Math.max(0, cardWidth + 8 - Math.abs(item.x - x)) * Math.max(0, cardHeight + 4 - Math.abs(item.y - y)),
              0,
            );
            const score = overlap * 10000 + (x - target.x) ** 2 * 4 + (y - target.y) ** 2;
            if (!best || score < best.score) best = { x, y, score };
          }
        }
        placed.push(best);
        (ui.fieldNodeGroups[object.id] || []).forEach((node) => {
          setStyleProperty(node, "left", `${((best.x / width) * 100).toFixed(3)}%`);
          setStyleProperty(node, "top", `${((best.y / height) * 100).toFixed(3)}%`);
          node.dataset.pan = ((anchor.left - 50) / 34).toFixed(3);
          node.title = `${object.label} · 스테레오 좌우 추정 위치 · 겹침 방지 배치`;
        });
      });
    }

    function getObjectRenderPosition(object, time = 0, options = {}) {
      if (!object) return null;
      if (object.kind === "stem") {
        if (options.dynamic || options.immediate) {
          return getStemRenderPosition(object, time, options);
        }
        return ui.stemDisplayPositions[object.id] || object.position || getStemFallbackPosition(object.id);
      }
      return getInstrumentStagePosition(object, time);
    }

    function getStemRenderPosition(stem, time = 0, options = {}) {
      const inference = inferStemPosition(stem.id, time, options);
      const current = ui.stemDisplayPositions[stem.id] || stem.position || inference.position;
      const ratio = options.immediate || !state.playback.playing ? 1 : 0.22;
      const next = {
        x: current.x + (inference.position.x - current.x) * ratio,
        y: current.y + (inference.position.y - current.y) * ratio,
        z: current.z + (inference.position.z - current.z) * ratio,
      };
      ui.stemDisplayPositions[stem.id] = next;
      stem.position = next;
      stem.inferredPosition = inference.position;
      stem.positionConfidence = inference.confidence;
      stem.positionContributors = inference.contributors;
      return next;
    }

    function inferStemPosition(stemId, time = null, options = {}) {
      const fallback = getStemFallbackPosition(stemId);
      const measured = state.stemBuffers?.[stemId]?.stereoPosition;
      if (measured?.confidence > 0) {
        return {
          position: { ...fallback, x: getPositionPan(measured, time) * 3.18 },
          confidence: measured.confidence,
          contributors: [],
        };
      }
      if (!state.analysis || !Array.isArray(state.analysis.instruments)) {
        return { position: fallback, confidence: 0, contributors: [] };
      }
      const finiteTime = Number.isFinite(time);
      const bucket = finiteTime ? Math.max(0, Math.round(time * 6)) : "static";
      const cacheKey = options.immediate ? "" : `${stemId}:${bucket}`;
      if (cacheKey && ui.stemPositionCache[cacheKey]) return ui.stemPositionCache[cacheKey];

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
          1,
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
          weight,
        });
      });

      if (sumWeight <= 0.035) {
        const result = { position: fallback, confidence: 0, contributors: [] };
        if (cacheKey) ui.stemPositionCache[cacheKey] = result;
        return result;
      }

      contributors.sort((a, b) => b.weight - a.weight);
      const centroid = {
        x: clamp(sumX / sumWeight, STEM_POSITION_BOUNDS.x[0], STEM_POSITION_BOUNDS.x[1]),
        y: clamp(sumY / sumWeight, STEM_POSITION_BOUNDS.y[0], STEM_POSITION_BOUNDS.y[1]),
        z: clamp(sumZ / sumWeight, STEM_POSITION_BOUNDS.z[0], STEM_POSITION_BOUNDS.z[1]),
      };
      const confidence = clamp(sumWeight / Math.max(totalBaseWeight * 0.55, 0.001), 0, 1);
      const mix = clamp(0.42 + confidence * 0.5, 0.38, 0.9);
      const position = applyStemPositionAnchor(stemId, {
        x: clamp(fallback.x * (1 - mix) + centroid.x * mix, STEM_POSITION_BOUNDS.x[0], STEM_POSITION_BOUNDS.x[1]),
        y: clamp(fallback.y * (1 - mix) + centroid.y * mix, STEM_POSITION_BOUNDS.y[0], STEM_POSITION_BOUNDS.y[1]),
        z: clamp(fallback.z * (1 - mix) + centroid.z * mix, STEM_POSITION_BOUNDS.z[0], STEM_POSITION_BOUNDS.z[1]),
      });
      const result = {
        position,
        confidence,
        contributors: contributors.slice(0, 3),
      };
      if (cacheKey) ui.stemPositionCache[cacheKey] = result;
      return result;
    }

    function applyStemPositionAnchor(stemId, position) {
      const anchor = STEM_POSITION_ANCHORS[stemId];
      if (!anchor) return position;
      return {
        x: clamp(
          anchor.x + (position.x - anchor.x) * anchor.lateralMix,
          anchor.x - anchor.maxAbsX,
          anchor.x + anchor.maxAbsX,
        ),
        y: clamp(
          anchor.y * (1 - anchor.verticalMix) + position.y * anchor.verticalMix,
          STEM_POSITION_BOUNDS.y[0],
          STEM_POSITION_BOUNDS.y[1],
        ),
        z: clamp(
          anchor.z * (1 - anchor.depthMix) + position.z * anchor.depthMix,
          STEM_POSITION_BOUNDS.z[0],
          STEM_POSITION_BOUNDS.z[1],
        ),
      };
    }

    function getInstrumentStagePosition(instrument, time = null) {
      const position = instrument.position || { x: 0, y: 0, z: -2.8 };
      const stereo = instrument.stereo || state.analysis?.stereoImage?.instruments?.[instrument.id];
      return {
        x: Number(stereo?.confidence) > 0 ? getPositionPan(stereo, time) * 3.18 : position.x,
        y: position.y || 0,
        z: position.z || -2.8,
      };
    }

    function getAnalysisInstrumentLookup() {
      if (!state.analysis || !Array.isArray(state.analysis.instruments)) return {};
      const key = state.analysis.jobId || state.analysis.cacheKey || state.analysis.file?.name || "analysis";
      if (ui.stemPositionCache.instrumentKey === key && ui.stemPositionCache.instrumentLookup) {
        return ui.stemPositionCache.instrumentLookup;
      }
      const lookup = {};
      state.analysis.instruments.forEach((instrument) => {
        lookup[instrument.id] = instrument;
      });
      ui.stemPositionCache.instrumentKey = key;
      ui.stemPositionCache.instrumentLookup = lookup;
      return lookup;
    }

    function getInstrumentPositionActivity(instrument, time = null) {
      const curveLevel = Number.isFinite(time)
        ? getInstrumentLevelFromCurve(instrument.curve || instrument.displayCurve || [], time)
        : 0;
      if (Number.isFinite(time)) {
        return clamp(
          curveLevel * 0.88 + (Number(instrument.confidence) || 0) * 0.08 + (Number(instrument.mean) || 0) * 0.04,
          0,
          1,
        );
      }
      return clamp(
        (Number(instrument.confidence) || 0) * 0.48 +
          (Number(instrument.peak) || 0) * 0.34 +
          (Number(instrument.mean) || 0) * 0.18,
        0,
        1,
      );
    }

    function getStemFallbackPosition(stemId) {
      const profile = STEM_PROFILES[stemId];
      const fallback = profile && profile.position ? profile.position : { x: 0, y: 0, z: -2.8 };
      return {
        x: fallback.x,
        y: fallback.y,
        z: fallback.z,
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
      ui.fieldNodeGroups = groups;
    }

    function renderSpectrumGraph() {
      resetSpectrumState();
      updateSpectrumDisplay(0, { zero: true, force: true });
    }

    function resetSpectrumState() {
      ui.spectrumLevels.fill(0);
      ui.spectrumPeaks.fill(0);
      ui.spectrumRanges = null;
      ui.spectrumRangeKey = "";
      ui.spectrumCache.backgroundKey = "";
      ui.spectrumCache.backgroundCanvas = null;
      ui.spectrumCache.gradientKey = "";
      ui.spectrumCache.gradient = null;
      invalidateCanvasRenderMetrics(ui.spectrumCache);
    }

    function renderInstrumentList(analysis) {
      const objects = getDisplayObjects(analysis);
      ui.meterLevels = Object.fromEntries(objects.map((object) => [object.id, 0]));
      ui.fieldLevels = Object.fromEntries(objects.map((object) => [object.id, 0]));
      refs.instrumentList.innerHTML = objects
        .map(
          (object) => `
        <div class="instrument-row ${object.active ? "" : "is-inactive"}" data-id="${object.id}" style="--bar-color:${object.color}; --level:0">
          <div class="stem-copy">
            <strong title="${object.label}">${object.label}</strong>
            <span>${escapeHtml(object.description || getFallbackObjectDescription(object))}</span>
          </div>
          <div class="bar-track"><div class="bar-fill"></div></div>
          <em>0%</em>
        </div>
      `,
        )
        .join("");
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
            inactive: null,
          },
        };
      });
      ui.meterRows = rows;
    }

    function getFallbackObjectDescription(object) {
      if (object.family === "keyboard") return "넓은 대역과 어택을 추적합니다.";
      if (object.family === "percussion") return "타격과 순간 에너지를 추적합니다.";
      if (object.family === "brass" || object.family === "woodwinds") return "중고역 존재감과 거리감을 추적합니다.";
      if (object.family === "strings") return "지속음과 선율 움직임을 추적합니다.";
      return "실시간 에너지 변화를 추적합니다.";
    }

    function setDisplayObjects(analysis) {
      ui.displayObjects = buildDisplayObjects(analysis);
    }

    function buildDisplayObjects(analysis) {
      if (!analysis) return [];
      if (state.stemBuffers) {
        return Object.values(state.stemBuffers)
          .sort((a, b) => STEM_ORDER.indexOf(a.id) - STEM_ORDER.indexOf(b.id))
          .map((stem) => {
            const enriched = { ...stem };
            const inference = inferStemPosition(stem.id, state.playback.offset || 0, { immediate: true });
            enriched.position = getStemRenderPosition(enriched, state.playback.offset || 0, { immediate: true });
            enriched.inferredPosition = inference.position;
            enriched.positionConfidence = inference.confidence;
            enriched.positionContributors = inference.contributors;
            return enriched;
          });
      }
      return analysis.instruments.map((instrument) => ({
        ...instrument,
        kind: "instrument",
        short: SHORT_NAMES[instrument.id] || instrument.label,
      }));
    }

    function getDisplayObjects(analysis) {
      if (analysis === state.analysis && Array.isArray(ui.displayObjects)) {
        return ui.displayObjects;
      }
      return buildDisplayObjects(analysis);
    }

    function tick() {
      if (!state.playback.playing) return;
      const frameStart = performance.now();
      const frameInterval = (document.hidden ? HIDDEN_VISUAL_FRAME_INTERVAL : VISUAL_FRAME_INTERVAL) * 1000;
      if (ui.lastVisualFrameAt && frameStart - ui.lastVisualFrameAt < frameInterval) {
        ui.animationId = requestAnimationFrame(tick);
        return;
      }
      ui.visualFrameSeconds = ui.lastVisualFrameAt ? clamp((frameStart - ui.lastVisualFrameAt) / 1000, 0, 0.1) : 1 / 30;
      ui.lastVisualFrameAt = frameStart;
      const quality = getRuntimeQualityProfile();
      const time = getPlaybackTime();
      if (time >= state.audioBuffer.duration) {
        stopPlayback();
        return;
      }
      if (document.hidden) {
        ui.animationId = requestAnimationFrame(tick);
        return;
      }
      maybeUpdateSpectrumDisplay(time, { zero: !state.playback.playing });
      if (
        ui.lastMeterFrameTime < 0 ||
        time < ui.lastMeterFrameTime ||
        time - ui.lastMeterFrameTime >= quality.meterInterval
      ) {
        refreshRealtimeMetersForMode(time);
        ui.lastMeterFrameTime = time;
      }
      maybeUpdateSeek(time);
      ui.animationId = requestAnimationFrame(tick);
    }

    function refreshRealtimeMetersForMode(time, options = {}) {
      if (!state.analysis) return;
      if (state.playback.mode === "original") {
        setRealtimeMetersToZero(time);
        return;
      }
      if (!state.playback.playing) {
        updateRealtimeDisplay(time);
        updateSoundFieldDisplay(time, readSoundFieldScores(time));
        return;
      }
      const liveScores = readLiveInstrumentScores(time);
      if (shouldUpdateStemDisplay(time, options)) {
        updateRealtimeDisplay(time, liveScores, { updateField: false });
        ui.lastStemDisplayFrameTime = time;
      }
      if (shouldUpdateFieldDisplay(time, options)) {
        updateSoundFieldDisplay(time, readSoundFieldScores(time, liveScores));
        ui.lastFieldDisplayFrameTime = time;
      }
    }

    function shouldUpdateStemDisplay(time, options = {}) {
      if (document.hidden && !options.forceDisplay) return false;
      const quality = getRuntimeQualityProfile();
      const interval = Number.isFinite(quality.stemDisplayInterval)
        ? quality.stemDisplayInterval
        : quality.meterInterval;
      return (
        options.forceDisplay ||
        ui.lastStemDisplayFrameTime < 0 ||
        time < ui.lastStemDisplayFrameTime ||
        time - ui.lastStemDisplayFrameTime >= interval
      );
    }

    function shouldUpdateFieldDisplay(time, options = {}) {
      if (document.hidden && !options.forceDisplay) return false;
      const quality = getRuntimeQualityProfile();
      const interval = Number.isFinite(quality.fieldDisplayInterval)
        ? quality.fieldDisplayInterval
        : quality.meterInterval;
      return (
        options.forceDisplay ||
        ui.lastFieldDisplayFrameTime < 0 ||
        time < ui.lastFieldDisplayFrameTime ||
        time - ui.lastFieldDisplayFrameTime >= interval
      );
    }

    function readMainAnalyserFrame(time = 0, options = {}) {
      const graph = state.playback.graph;
      if (!graph || !graph.analyser || !graph.frequencyData || !graph.timeData || !state.audioContext) {
        return null;
      }
      const needsFrequency = options.frequency !== false;
      const needsTime = options.time !== false;
      const frameTime = Number.isFinite(time) ? time : getPlaybackTime();
      const maxAge = Number.isFinite(options.maxAge) ? options.maxAge : 0.024;
      const previous = ui.lastLiveAnalysisFrame;
      const canReuse =
        !options.force && previous && previous.graph === graph && Math.abs(frameTime - previous.time) <= maxAge;
      if (canReuse && (!needsFrequency || previous.hasFrequency) && (!needsTime || previous.hasTime)) {
        return previous;
      }
      const frame = canReuse
        ? previous
        : {
            graph,
            time: frameTime,
            frequencyData: graph.frequencyData,
            timeData: graph.timeData,
            sampleRate: state.audioContext.sampleRate,
            outputLevel: ui.liveOutputLevel,
            quality: null,
            hasFrequency: false,
            hasTime: false,
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
      ui.lastLiveAnalysisFrame = frame;
      ui.liveOutputLevel = frame.outputLevel;
      return frame;
    }

    function readLiveInstrumentScores(time = 0) {
      const graph = state.playback.graph;
      if (!graph || !state.audioContext) return null;
      if (
        graph.stemAnalysisMeters &&
        graph.stemAnalysisMeters.byId &&
        Object.keys(graph.stemAnalysisMeters.byId).length
      ) {
        const stemScores = readStemAnalysisMeterScores(graph.stemAnalysisMeters, graph.previousLiveScores || {});
        readMainAnalyserFrame(time, { frequency: false });
        graph.previousLiveScores = stemScores;
        ui.liveScores = stemScores;
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
        graph.livePowerPrefixData,
      );
      const guardedScores = applyLiveInstrumentRoster(scores);
      graph.previousLiveScores = guardedScores;
      ui.liveScores = guardedScores;
      return guardedScores;
    }

    function smoothVisual(previous, target, retention) {
      const retained = Math.pow(retention, ui.visualFrameSeconds * 30);
      return previous * retained + target * (1 - retained);
    }

    function readStemAnalysisMeterScores(stemMeters, previousScores) {
      const scores = {};
      Object.entries(stemMeters.byId).forEach(([id, meter]) => {
        meter.analyser.getFloatTimeDomainData(meter.timeData);
        const raw = getStemMeterSignalLevel(meter.timeData);
        const shaped = shapeStemMeterLevel(raw);
        const previous = previousScores[id] || 0;
        scores[id] = smoothVisual(previous, shaped, shaped >= previous ? 0.12 : 0.54);
      });
      return scores;
    }

    function getMeterSignalLevel(timeData, scoreFromDb = null) {
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
      return scoreFromDb ? scoreFromDb(rmsDb, peakDb) : clamp((rmsDb + 58) / 34 + Math.max(0, peakDb + 36) / 90, 0, 1);
    }

    function getStemMeterSignalLevel(timeData) {
      return getMeterSignalLevel(timeData, getStemMeterScoreFromDb);
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
      return Object.fromEntries(
        Object.entries(scores).map(([id, score]) => [id, activeIds.has(id) ? score : score * 0.04]),
      );
    }

    function classifyLiveInstruments(
      frequencyData,
      timeData,
      sampleRate,
      previousScores,
      powerBuffer = null,
      powerPrefixBuffer = null,
    ) {
      const features = extractLiveAudioFeatures(frequencyData, timeData, sampleRate, powerBuffer, powerPrefixBuffer);
      if (features.signalLevel <= 0.025) {
        return Object.fromEntries(Object.keys(LIVE_SIGNATURES).map((id) => [id, 0]));
      }

      const rawScores = {};
      Object.entries(LIVE_SIGNATURES).forEach(([id, signature]) => {
        const signatureEnergy = signature.bands.reduce(
          (sum, [min, max, weight]) => sum + getLiveBandEnergy(features, min, max) * weight,
          0,
        );
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
        normalized[id] = gated >= previous ? previous * 0.2 + gated * 0.8 : previous * 0.62 + gated * 0.38;
      });
      return normalized;
    }

    function extractLiveAudioFeatures(
      frequencyData,
      timeData,
      sampleRate,
      powerBuffer = null,
      powerPrefixBuffer = null,
    ) {
      const nyquist = sampleRate / 2;
      const binHz = nyquist / frequencyData.length;
      const power =
        powerBuffer && powerBuffer.length === frequencyData.length
          ? powerBuffer
          : new Float32Array(frequencyData.length);
      const powerPrefix =
        powerPrefixBuffer && powerPrefixBuffer.length === frequencyData.length + 1
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
          if (sample >= 0 !== timeData[index - 1] >= 0) crossings += 1;
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
        air: null,
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

      if (type === "stringHigh")
        return clamp((presence * 2.2 + air * 0.85 + mid * 0.55) * (0.58 + tonal * 0.6 + transient * 0.22), 0, 1.6);
      if (type === "stringMid")
        return clamp((mid * 1.9 + presence * 0.92 + lowMid * 0.45) * (0.62 + tonal * 0.62), 0, 1.6);
      if (type === "stringLow") return clamp((lowMid * 1.7 + mid * 0.82 + bass * 0.52) * (0.62 + tonal * 0.58), 0, 1.6);
      if (type === "woodwindHigh")
        return clamp(
          (presence * 1.4 + air * 0.72 + mid * 0.48) * (0.78 + sustain * 0.42) * (1 - transient * 0.28),
          0,
          1.4,
        );
      if (type === "woodwindMid")
        return clamp(
          (mid * 1.35 + presence * 0.86 + lowMid * 0.28) * (0.78 + sustain * 0.42) * (1 - transient * 0.24),
          0,
          1.4,
        );
      if (type === "woodwindLow")
        return clamp((lowMid * 1.45 + mid * 0.72 + bass * 0.32) * (0.75 + sustain * 0.42), 0, 1.4);
      if (type === "brassBright")
        return clamp((presence * 1.45 + mid * 0.95 + air * 0.22) * (0.62 + transient * 0.3 + tonal * 0.32), 0, 1.5);
      if (type === "brassWarm")
        return clamp((lowMid * 1.18 + mid * 1.05 + presence * 0.38) * (0.7 + sustain * 0.28), 0, 1.4);
      if (type === "impactLow") return clamp((bass * 2.1 + lowMid * 0.55) * (0.52 + transient * 1.15), 0, 1.7);
      if (type === "impactHigh")
        return clamp((presence * 0.62 + air * 1.65) * (0.46 + transient * 1.25) * (1 - tonal * 0.24), 0, 1.7);
      if (type === "pluck")
        return clamp(
          (presence * 1.05 + air * 0.95 + mid * 0.44) * (0.42 + transient * 1.05) * tonal * (1 - lowMid * 0.35),
          0,
          1.5,
        );
      if (type === "piano")
        return clamp(
          (bass * 0.75 + lowMid * 1.15 + mid * 1.0 + presence * 0.65 + air * 0.18) *
            (0.5 + transient * 0.75) *
            (0.62 + tonal * 0.32),
          0,
          1.8,
        );
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
      const lowCoverage =
        getCachedLiveBand(features, "bass", 60, 250) + getCachedLiveBand(features, "lowMid", 250, 700);
      if (piano > stringMax * 0.72 && lowCoverage > 0.14 && features.transient > 0.18) {
        scores.harp *= 0.58;
        scores.violins1 *= 0.72;
        scores.violins2 *= 0.76;
        scores.violas *= 0.82;
      }
    }

    function updateRealtimeDisplay(time, liveScores = null, options = {}) {
      if (!state.analysis) return;
      ui.metersZeroed = false;
      const updateField = options.updateField !== false;
      setText(refs.frameTime, formatTime(time));
      getDisplayObjects(state.analysis).forEach((object) => {
        const liveLevel = liveScores ? liveScores[object.id] || 0 : null;
        const rawLevel = getObjectDisplayLevel(object, time, liveLevel);
        const previous = ui.meterLevels[object.id] || 0;
        const level = smoothVisual(previous, rawLevel, rawLevel >= previous ? 0.18 : 0.58);
        ui.meterLevels[object.id] = level;
        const meterRef = ui.meterRows[object.id];
        if (meterRef) {
          const { row, value, cache } = meterRef;
          const visualLevel = clamp(level, 0, 1);
          if (Math.abs(visualLevel - cache.level) > METER_STYLE_EPSILON || (visualLevel === 0 && cache.level !== 0)) {
            cache.level = visualLevel;
            setStyleProperty(row, "--level", visualLevel.toFixed(4));
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
          const previousField = ui.fieldLevels[object.id] || 0;
          const fieldLevel =
            rawLevel >= previousField ? previousField * 0.16 + rawLevel * 0.84 : previousField * 0.62 + rawLevel * 0.38;
          ui.fieldLevels[object.id] = fieldLevel;
          updateFieldNodes(ui.fieldNodeGroups[object.id] || [], object, fieldLevel, liveLevel, time);
        }
      });
    }

    function readSoundFieldScores(time = 0, liveScores = null) {
      if (!state.analysis || !state.playback.graph) return null;
      if (state.playback.mode === "original") {
        return Object.fromEntries(getDisplayObjects(state.analysis).map((object) => [object.id, 0]));
      }
      const frame = readMainAnalyserFrame(time, {
        frequency: false,
        maxAge: 0.08,
      });
      const globalLevel = frame ? frame.outputLevel : ui.liveOutputLevel;
      const scoreSource = liveScores || ui.liveScores || {};
      const objects = getDisplayObjects(state.analysis);
      const scores = {};
      objects.forEach((object, index) => {
        const hasLiveStemScore = object.kind === "stem" && Object.prototype.hasOwnProperty.call(scoreSource, object.id);
        const liveStemLevel = hasLiveStemScore ? shapeStemDisplayLevel(scoreSource[object.id] || 0) : null;
        const timeline =
          object.kind === "stem"
            ? liveStemLevel === null
              ? getStemFieldWeight(object)
              : liveStemLevel
            : getInstrumentLevelFromCurve(object.displayCurve || object.curve, time);
        const activity = object.active ? 1 : 0.45;
        const drift = 0.9 + getFieldDrift(object.id, index, time) * 0.16;
        const depthLift = clamp(Math.abs(object.position.x) * 0.08 + Math.abs(object.position.z) * 0.035, 0, 0.22);
        const stemGate = hasLiveStemScore ? clamp((timeline - 0.022) / 0.2, 0, 1) : 1;
        scores[object.id] = clamp(
          globalLevel * (0.52 + timeline * 0.58 + depthLift) * activity * drift * stemGate,
          0,
          1,
        );
      });
      return scores;
    }

    function updateSoundFieldDisplay(time, fieldScores = null) {
      if (!state.analysis) return;
      ui.metersZeroed = false;
      setText(refs.frameTime, formatTime(time));
      getDisplayObjects(state.analysis).forEach((object) => {
        const rawLevel = fieldScores ? fieldScores[object.id] || 0 : 0;
        const previous = ui.fieldLevels[object.id] || 0;
        const level = rawLevel >= previous ? previous * 0.14 + rawLevel * 0.86 : previous * 0.64 + rawLevel * 0.36;
        ui.fieldLevels[object.id] = level;
        updateFieldNodes(ui.fieldNodeGroups[object.id] || [], object, level, level, time);
      });
    }

    function maybeUpdateSpectrumDisplay(time = 0, options = {}) {
      if (document.hidden && !options.force) return;
      const quality = getRuntimeQualityProfile();
      const interval = Number.isFinite(quality.spectrumInterval) ? quality.spectrumInterval : quality.meterInterval;
      if (
        options.force ||
        ui.lastSpectrumFrameTime < 0 ||
        time < ui.lastSpectrumFrameTime ||
        time - ui.lastSpectrumFrameTime >= interval
      ) {
        updateSpectrumDisplay(time, options);
        ui.lastSpectrumFrameTime = time;
      }
    }

    function updateSpectrumDisplay(time = 0, options = {}) {
      if (!refs.spectrumCanvas) return;
      const hasLiveAnalyser =
        state.playback.playing &&
        !options.zero &&
        state.playback.graph &&
        state.playback.graph.analyser &&
        state.playback.graph.frequencyData &&
        state.audioContext;
      if (hasLiveAnalyser) {
        readLiveSpectrumLevels(time);
      } else {
        decaySpectrumLevels(ui.spectrumLevels, 0.72);
      }
      updateSpectrumPeaks(ui.spectrumLevels, ui.spectrumPeaks, hasLiveAnalyser);
      drawSpectrumGraph(ui.spectrumLevels, {
        time,
        peaks: ui.spectrumPeaks,
        zero: !hasLiveAnalyser || options.zero,
        force: options.force,
      });
    }

    function updateSpectrumPeaks(levels, previousPeaks = [], active = false) {
      for (let index = 0; index < levels.length; index += 1) {
        const level = levels[index] || 0;
        const previous = previousPeaks[index] || 0;
        previousPeaks[index] = !active
          ? previous * Math.pow(0.66, ui.visualFrameSeconds * 30)
          : level >= previous
            ? level
            : Math.max(level, previous - 0.78 * ui.visualFrameSeconds);
      }
      return previousPeaks;
    }

    function decaySpectrumLevels(levels, amount) {
      for (let index = 0; index < levels.length; index += 1) {
        levels[index] *= amount;
      }
      return levels;
    }

    function readLiveSpectrumLevels(time = getPlaybackTime()) {
      const graph = state.playback.graph;
      if (!graph || !graph.analyser || !graph.frequencyData || !state.audioContext) {
        return ui.spectrumLevels;
      }
      const frame = readMainAnalyserFrame(time, {
        time: false,
        maxAge: 0,
      });
      if (!frame) return ui.spectrumLevels;
      buildSpectrumLevels(frame.frequencyData, frame.sampleRate, ui.spectrumLevels);
      return ui.spectrumLevels;
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
        const highAirLift =
          band > highBandStart
            ? 1 + ((band - highBandStart) / Math.max(1, SPECTRUM_BAR_COUNT - highBandStart)) * 0.14
            : 1;
        const raw = clamp((average * 0.48 + peak * 0.52) * lowCompensation * highAirLift, 0, 1);
        const shaped = Math.pow(raw, 0.68);
        const previous = previousLevels[band] || 0;
        previousLevels[band] = smoothVisual(previous, shaped, shaped >= previous ? 0.14 : 0.68);
      }

      return previousLevels;
    }

    function getSpectrumRanges(binCount, sampleRate) {
      const key = `${binCount}:${sampleRate}:${SPECTRUM_BAR_COUNT}`;
      if (ui.spectrumRanges && ui.spectrumRangeKey === key) return ui.spectrumRanges;

      const binHz = sampleRate / 2 / binCount;
      const minHz = 20;
      const maxHz = Math.min(20000, sampleRate / 2);
      const ratio = maxHz / minHz;
      ui.spectrumRanges = Array.from({ length: SPECTRUM_BAR_COUNT }, (_, band) => {
        const startHz = minHz * Math.pow(ratio, band / SPECTRUM_BAR_COUNT);
        const endHz = minHz * Math.pow(ratio, (band + 1) / SPECTRUM_BAR_COUNT);
        const start = clamp(Math.floor(startHz / binHz), 0, binCount - 1);
        const end = clamp(Math.max(start + 1, Math.ceil(endHz / binHz)), start + 1, binCount);
        return [start, end, startHz, endHz];
      });
      ui.spectrumRangeKey = key;
      return ui.spectrumRanges;
    }

    function getSpectrumContext(canvas) {
      if (!ui.spectrumContext) {
        ui.spectrumContext = canvas.getContext("2d");
      }
      return ui.spectrumContext;
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

    function drawSpectrumGraph(levels = ui.spectrumLevels, options = {}) {
      const canvas = refs.spectrumCanvas;
      if (!canvas) return;
      const ctx = getSpectrumContext(canvas);
      const { width, height, dpr, resized } = getCanvasRenderMetrics(canvas, ui.spectrumCache);
      if (resized) {
        ui.spectrumCache.backgroundKey = "";
        ui.spectrumCache.gradientKey = "";
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
        dpr,
      });
    }

    function drawSpectrumBackground(ctx, width, height, dpr) {
      const theme = document.documentElement.dataset.theme || "light";
      const key = `${width}:${height}:${dpr}:${theme}`;
      if (!ui.spectrumCache.backgroundCanvas || ui.spectrumCache.backgroundKey !== key) {
        const background = document.createElement("canvas");
        background.width = width;
        background.height = height;
        const bg = background.getContext("2d");
        drawSpectrumBackgroundLayer(bg, width, height, dpr);
        ui.spectrumCache.backgroundKey = key;
        ui.spectrumCache.backgroundCanvas = background;
      }
      ctx.drawImage(ui.spectrumCache.backgroundCanvas, 0, 0);
    }

    function drawSpectrumBackgroundLayer(ctx, width, height, dpr) {
      ctx.fillStyle = cssColor("--canvas-bg", "rgba(238,244,240,0.78)");
      ctx.fillRect(0, 0, width, height);

      const zones = [
        [0, 0.22, "--green"],
        [0.22, 0.46, "--blue"],
        [0.46, 0.74, "--coral"],
        [0.74, 1, "--gold"],
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
      if (ui.spectrumCache.gradientKey !== key) {
        const gradient = ctx.createLinearGradient(0, height, 0, 0);
        gradient.addColorStop(0, cssColor("--green", "#687f5b"));
        gradient.addColorStop(0.42, cssColor("--blue", "#517f96"));
        gradient.addColorStop(0.76, cssColor("--coral", "#c86f5a"));
        gradient.addColorStop(1, cssColor("--gold", "#d7b56d"));
        ui.spectrumCache.gradientKey = key;
        ui.spectrumCache.gradient = gradient;
      }
      return ui.spectrumCache.gradient;
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
            top: null,
          };
        }
        const cached = node._fieldNode;
        const visualLevel = clamp(level, 0, 1);
        if (Math.abs(visualLevel - cached.level) > 0.01) {
          cached.level = visualLevel;
          setStyleProperty(node, "--level", visualLevel.toFixed(4));
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
      if (stem.id === "guitar") return 0.84;
      if (stem.id === "piano") return 0.8;
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
      if (Number.isFinite(ui.fieldDriftSeeds[id])) {
        return ui.fieldDriftSeeds[id];
      }
      let seed = 0;
      for (let index = 0; index < id.length; index += 1) {
        seed += id.charCodeAt(index);
      }
      ui.fieldDriftSeeds[id] = seed;
      return seed;
    }

    function setRealtimeMetersToZero(time = 0) {
      if (!state.analysis) return;
      ui.liveScores = {};
      setText(refs.frameTime, formatTime(time));
      if (ui.metersZeroed) return;
      getDisplayObjects(state.analysis).forEach((object) => {
        ui.meterLevels[object.id] = 0;
        const meterRef = ui.meterRows[object.id];
        const nodes = ui.fieldNodeGroups[object.id] || [];
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
        ui.fieldLevels[object.id] = 0;
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
      ui.metersZeroed = true;
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
      if (state.playback.playing && liveLevel !== null) {
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

    function maybeUpdateSeek(time, options = {}) {
      if (document.hidden && !options.force) return;
      const quality = getRuntimeQualityProfile();
      const interval = Number.isFinite(quality.seekInterval) ? quality.seekInterval : 1 / 12;
      if (
        options.force ||
        ui.lastSeekFrameTime < 0 ||
        time < ui.lastSeekFrameTime ||
        time - ui.lastSeekFrameTime >= interval
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
        ui.lastSeekFrameTime = time;
      }
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
      ui.spectrumCache.backgroundKey = "";
      ui.spectrumCache.gradientKey = "";
      drawSpectrumGraph(ui.spectrumLevels, {
        time: getPlaybackTime(),
        zero: !state.playback.playing,
        force: true,
      });
    }

    function setBusy(isBusy, text) {
      document.body.classList.toggle("is-busy", isBusy);
      refs.statusText.textContent = text;
    }

    function startAnalysisProgress() {
      window.clearInterval(ui.analysisTimer);
      window.clearTimeout(ui.analysisCompletionTimer);
      ui.analysisStartedAt = performance.now();
      if (refs.analysisProgress) {
        refs.analysisProgress.hidden = false;
        refs.analysisProgress.classList.remove("is-error");
      }
      updateAnalysisElapsed();
      ui.analysisTimer = window.setInterval(updateAnalysisElapsed, 1000);
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
      if (!ui.analysisStartedAt) return;
      const seconds = Math.max(0, Math.floor((performance.now() - ui.analysisStartedAt) / 1000));
      const label = seconds < 60 ? `${seconds}초` : `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
      setText(refs.analysisElapsed, label);
    }

    function finishAnalysisProgress(success, text) {
      window.clearInterval(ui.analysisTimer);
      ui.analysisTimer = 0;
      updateAnalysisElapsed();
      if (success) {
        if (state.analysis?.clientTiming) {
          state.analysis.clientTiming.readySeconds = (performance.now() - ui.analysisStartedAt) / 1000;
        }
        setAnalysisPhase("ready", text);
      } else {
        setText(refs.analysisPhase, text);
        refs.analysisProgress?.classList.add("is-error");
        refs.analysisProgressTrack?.setAttribute("aria-valuetext", text);
      }
      const runId = hooks.analysisRevision();
      ui.analysisCompletionTimer = window.setTimeout(
        () => {
          if (runId === hooks.analysisRevision() && refs.analysisProgress) {
            refs.analysisProgress.hidden = true;
          }
        },
        success ? 1800 : 4200,
      );
    }

    function resetAnalysisProgress() {
      window.clearInterval(ui.analysisTimer);
      window.clearTimeout(ui.analysisCompletionTimer);
      ui.analysisTimer = 0;
      ui.analysisCompletionTimer = 0;
      ui.analysisStartedAt = 0;
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

    function scheduleCanvasRedraw() {
      if (ui.resizeFrame) return;
      ui.resizeFrame = requestAnimationFrame(() => {
        ui.resizeFrame = 0;
        invalidateCanvasRenderMetrics(ui.spectrumCache);
        updateStagePositions();
        drawSpectrumGraph(ui.spectrumLevels, {
          time: getPlaybackTime(),
          zero: !state.playback.playing,
          force: true,
        });
      });
    }

    function setupCanvasResizeObserver() {
      if (!window.ResizeObserver || ui.canvasResizeObserver) return;
      ui.canvasResizeObserver = new ResizeObserver(scheduleCanvasRedraw);
      if (refs.spectrumCanvas) ui.canvasResizeObserver.observe(refs.spectrumCanvas);
      if (refs.stageMap) ui.canvasResizeObserver.observe(refs.stageMap);
    }
    return {
      state: ui,
      refs,
      preparePlayback,
      onStart,
      onStop,
      resetTrack,
      config: Object.freeze({
        SPECTRUM_BAR_COUNT,
        VISUAL_FRAME_INTERVAL,
        HIDDEN_VISUAL_FRAME_INTERVAL,
        METER_STYLE_EPSILON,
        STEM_METER_DB_OFFSET,
        MAX_CANVAS_DPR,
        ANALYSIS_PHASES,
        RUNTIME_QUALITY_PROFILE,
        STEM_POSITION_GROUPS,
        STEM_POSITION_BOUNDS,
        STEM_POSITION_ANCHORS,
        UI_FRAME_INTERVAL,
        SPECTRUM_FRAME_INTERVAL,
      }),
      syncFieldModeState,
      resetLiveAnalysisCache,
      getRuntimeQualityProfile,
      renderAnalysis,
      renderStage,
      createStageNodes,
      getObjectStagePoint,
      getPositionPan,
      updateStagePositions,
      getObjectRenderPosition,
      getStemRenderPosition,
      inferStemPosition,
      applyStemPositionAnchor,
      getInstrumentStagePosition,
      getAnalysisInstrumentLookup,
      getInstrumentPositionActivity,
      getStemFallbackPosition,
      cacheFieldNodes,
      renderSpectrumGraph,
      resetSpectrumState,
      renderInstrumentList,
      cacheMeterRows,
      getFallbackObjectDescription,
      setDisplayObjects,
      buildDisplayObjects,
      getDisplayObjects,
      tick,
      refreshRealtimeMetersForMode,
      shouldUpdateStemDisplay,
      shouldUpdateFieldDisplay,
      readMainAnalyserFrame,
      readLiveInstrumentScores,
      readStemAnalysisMeterScores,
      getMeterSignalLevel,
      getStemMeterSignalLevel,
      getStemMeterScoreFromDb,
      applyLiveInstrumentRoster,
      classifyLiveInstruments,
      extractLiveAudioFeatures,
      getLiveBandEnergy,
      getLiveGate,
      getCachedLiveBand,
      protectLiveStringStaccato,
      protectLivePiano,
      updateRealtimeDisplay,
      readSoundFieldScores,
      updateSoundFieldDisplay,
      maybeUpdateSpectrumDisplay,
      updateSpectrumDisplay,
      updateSpectrumPeaks,
      decaySpectrumLevels,
      readLiveSpectrumLevels,
      buildSpectrumLevels,
      getSpectrumRanges,
      getSpectrumContext,
      getCanvasRenderMetrics,
      invalidateCanvasRenderMetrics,
      drawSpectrumGraph,
      drawSpectrumBackground,
      drawSpectrumBackgroundLayer,
      drawSpectrumEnergyLine,
      getSpectrumGradient,
      updateFieldNodes,
      getStemFieldWeight,
      getFieldDrift,
      getFieldDriftSeed,
      setRealtimeMetersToZero,
      getObjectDisplayLevel,
      shapeStemDisplayLevel,
      shapeStemMeterLevel,
      softenStemBarLevel,
      getInstrumentDisplayLevel,
      getInstrumentLevelFromCurve,
      maybeUpdateSeek,
      updateSeek,
      applyStoredTheme,
      toggleTheme,
      applyTheme,
      setBusy,
      startAnalysisProgress,
      setAnalysisPhase,
      updateAnalysisElapsed,
      finishAnalysisProgress,
      resetAnalysisProgress,
      showToast,
      scheduleCanvasRedraw,
      setupCanvasResizeObserver,
    };
  }
  global.createSpatialStudioView = createStudioView;
})(window);
