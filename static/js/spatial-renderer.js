(function (global) {
  "use strict";
  const { clamp } = global.SpatialAudioUtils;
  const { STEM_ORDER } = global.SpatialAudioConfig;
  const LIVE_ANALYSER_FFT_SIZE = 2048;
  const STEM_METER_FFT_SIZE = 512;
  const BINAURAL_PRIMARY_CACHE = new WeakMap();
  // Virtual reflected-field radius; not a guaranteed perceived source distance.
  const SPATIAL_SURROUND_SPHERE = Object.freeze({ radius: 16, speedOfSound: 343 });
  const SPATIAL_LATE_FIELD = Object.freeze({
    send: 0.26,
    duration: 0.72,
    tapSpan: 0.5,
    tapsPerDirection: 48,
    riseSeconds: 0.016,
    decaySeconds: 0.58,
    highDecaySeconds: 0.24,
    crossoverHz: 4800,
    airLowpassHz: 14000,
  });
  const SPATIAL_SPACE_MULTIPLIER = 3.2;
  const SPATIAL_WIDTH_MULTIPLIER = 7.2;
  const SPATIAL_SIDE_ENERGY_SCALE = 3.6;
  const SPATIAL_OUTPUT_PEAK_GUARD_PRE_GAIN = 0.94;
  const SPATIAL_OUTPUT_PEAK_GUARD_THRESHOLD_DB = -0.6;
  const SPATIAL_OUTPUT_PEAK_GUARD_KNEE_DB = 0.5;
  const SPATIAL_OUTPUT_PEAK_GUARD_RATIO = 16;
  const SPATIAL_OUTPUT_PEAK_GUARD_ATTACK = 0.0015;
  const SPATIAL_OUTPUT_PEAK_GUARD_RELEASE = 0.11;
  const SPATIAL_NATURAL_DELAY_SCALE = 1;
  const SPATIAL_FRONT_HEMISPHERE_AZIMUTH_LIMIT = 100;
  const SPATIAL_MAX_RENDER_AZIMUTH = 168;
  const SPATIAL_RESEARCH_PROFILE = Object.freeze({
    anchorLeadSeconds: 0.006,
    diffuseToAnchorMax: 0.72,
    // Keep the independent late field while easing the audible room boundary.
    earlyRoomGain: 0.22,
    hallEarlyGain: 0.76,
    venueTailGain: 0.14,
    wetHighpassHz: 180,
    wetLowpassHz: 16000,
    wetLowpassQ: 0.5,
    lateralHighpassHz: 220,
    midDerivedSideHighpassHz: 700,
    midDerivedSideLowpassHz: 12000,
    diffuseFieldHighpassHz: 320,
  });
  const SPATIAL_ROOM_RESPONSE_EQ = Object.freeze([
    Object.freeze({ type: "lowshelf", frequency: 165, gain: -1.2, q: 0.707 }),
    Object.freeze({ type: "peaking", frequency: 340, gain: -1.8, q: 0.72 }),
    Object.freeze({ type: "peaking", frequency: 4200, gain: 0, q: 0.68 }),
  ]);
  const SPATIAL_DISTANCE_BRIR_PROFILES = Object.freeze({
    near: Object.freeze({
      id: "near",
      distance: 1.2,
      radiusMax: 0.98,
      preDelay: 0,
      gainScale: 0.82,
      highpass: 250,
      lowpass: 11500,
      earlyDelayScale: 0.92,
    }),
    mid: Object.freeze({
      id: "mid",
      distance: 2.1,
      radiusMax: 1.14,
      preDelay: 0.006,
      gainScale: 0.96,
      highpass: 220,
      lowpass: 10500,
      earlyDelayScale: 1,
    }),
    far: Object.freeze({
      id: "far",
      distance: 3,
      radiusMax: Infinity,
      preDelay: 0.012,
      gainScale: 1.06,
      highpass: 235,
      lowpass: 9600,
      earlyDelayScale: 1.12,
    }),
  });
  const SPATIAL_FIELD_DIRECTIONS = Object.freeze([
    {
      id: "front",
      azimuth: 0,
      elevation: 12,
      distance: 10,
      gain: 0.13,
      delay: 0.0292,
    },
    {
      id: "frontLeft",
      azimuth: -45,
      elevation: 18,
      distance: 14.14,
      gain: 0.17,
      delay: 0.0412,
    },
    {
      id: "frontRight",
      azimuth: 45,
      elevation: 18,
      distance: 14.14,
      gain: 0.17,
      delay: 0.0412,
    },
    {
      id: "left",
      azimuth: -90,
      elevation: 12,
      distance: 10,
      gain: 0.21,
      delay: 0.0292,
    },
    {
      id: "right",
      azimuth: 90,
      elevation: 12,
      distance: 10,
      gain: 0.21,
      delay: 0.0292,
    },
    {
      id: "rearLeft",
      azimuth: -135,
      elevation: 18,
      distance: 14.14,
      gain: 0.14,
      delay: 0.0412,
    },
    {
      id: "rearRight",
      azimuth: 135,
      elevation: 18,
      distance: 14.14,
      gain: 0.14,
      delay: 0.0412,
    },
    {
      id: "rear",
      azimuth: 180,
      elevation: 10,
      distance: 10,
      gain: 0.1,
      delay: 0.0292,
    },
    {
      id: "heightFrontLeft",
      azimuth: -42,
      elevation: 58,
      distance: 14.14,
      gain: 0.13,
      delay: 0.0412,
    },
    {
      id: "heightFrontRight",
      azimuth: 42,
      elevation: 58,
      distance: 14.14,
      gain: 0.13,
      delay: 0.0412,
    },
    {
      id: "heightRearLeft",
      azimuth: -138,
      elevation: 58,
      distance: 14.14,
      gain: 0.115,
      delay: 0.0412,
    },
    {
      id: "heightRearRight",
      azimuth: 138,
      elevation: 58,
      distance: 14.14,
      gain: 0.115,
      delay: 0.0412,
    },
    {
      id: "ceiling",
      azimuth: 0,
      elevation: 84,
      distance: 10,
      gain: 0.08,
      delay: 0.0292,
    },
  ]);
  const FULL_SPATIAL_ORCHESTRAL_HALL_DIRECTIONS = Object.freeze(
    createMirroredDirections([
      ["frontWall", 42, 12, 10.77, 0.145, 0.0314],
      ["sideWall", 90, 15, 10, 0.2, 0.0292],
      ["rearWall", 138, 17, 14.14, 0.155, 0.0412],
      ["ceilingFront", 45, 62, 14.14, 0.13, 0.0412],
      ["upperRearCorner", 135, 45, 17.32, 0.115, 0.0505],
    ]),
  );
  const FULL_SPATIAL_LATE_ENVELOPMENT_DIRECTIONS = Object.freeze(
    createMirroredDirections([
      ["lateSide", 100, 18, 0.16, 1.02],
      ["lateRear", 145, 24, 0.14, 1.2],
      ["lateHeight", 72, 64, 0.12, 1.35],
      ["lateUpperRear", 145, 56, 0.1, 1.5],
      ["frontSurround", 42, 12, 0.13, 0.9],
      ["lowerSide", 85, -28, 0.13, 1.08],
      ["rearAxis", 174, 8, 0.12, 1.28],
      ["upperFront", 40, 58, 0.12, 1.16],
    ].map(([id, azimuth, elevation, gain, pathScale]) => [
      id, azimuth, elevation, SPATIAL_SURROUND_SPHERE.radius, gain,
      (3 * SPATIAL_SURROUND_SPHERE.radius * (0.375 + (pathScale - 0.9) * (5 / 6))) /
        SPATIAL_SURROUND_SPHERE.speedOfSound,
    ])),
  );
  const FULL_SPATIAL_EXTERNALIZED_PERIMETER_DIRECTIONS = Object.freeze(
    createMirroredDirections([
      ["nearFront", 42, 8, 3, 0.25, 0.006],
      ["nearSide", 100, 15, 3.35, 0.21, 0.0098],
      ["nearRear", 150, 16, 3.7, 0.18, 0.0145],
      ["nearHeight", 72, 60, 3.55, 0.135, 0.012],
      ["nearBack", 178, 8, 4, 0.13, 0.018],
    ]),
  );
  const FULL_SPATIAL_STAGE_DIRECTIONS = Object.freeze(
    Object.fromEntries(
      Object.entries({
        vocals: [
          ["vocalCenter", 7, 8, 7.2, 0.22, 0.018],
          ["vocalStage", 20, 11, 8.1, 0.13, 0.023],
          ["vocalCanopy", 34, 28, 9.2, 0.075, 0.029],
        ],
        guitar: [
          ["guitarInner", 30, 8, 8.5, 0.19, 0.022],
          ["guitarOuter", 55, 12, 9.6, 0.15, 0.028],
          ["guitarAir", 72, 24, 10.5, 0.08, 0.033],
        ],
        piano: [
          ["pianoInner", 26, 7, 8.7, 0.18, 0.023],
          ["pianoOuter", 50, 13, 9.8, 0.145, 0.029],
          ["pianoLid", 68, 27, 10.7, 0.075, 0.034],
        ],
        other: [
          ["ensembleInner", 34, 9, 8.4, 0.19, 0.021],
          ["ensembleOuter", 58, 12, 9.5, 0.17, 0.027],
          ["ensembleHigh", 74, 25, 10.4, 0.09, 0.032],
        ],
        drums: [
          ["drumStage", 43, 5, 10.2, 0.18, 0.026],
          ["drumWide", 64, 9, 11.1, 0.14, 0.031],
          ["drumUpper", 79, 20, 11.8, 0.075, 0.035],
        ],
        bass: [
          ["bassCenter", 11, -5, 9.8, 0.18, 0.025],
          ["bassStage", 29, 0, 10.8, 0.11, 0.031],
          ["bassRoom", 47, 7, 11.6, 0.06, 0.035],
        ],
      }).map(([id, pairs]) => [id, Object.freeze(createMirroredDirections(pairs).map(Object.freeze))]),
    ),
  );
  const STEM_OBJECT_ROUTES = {
    vocals: createStemRoute("stage-front", 0.19, 110, 12800, 1100, [
      [0, 8, 7.2, 0.012, 0.84],
      [-32, 16, 9.2, 0.02, 0.11],
      [54, 20, 10.4, 0.028, 0.085],
    ]),
    guitar: createStemRoute("stage-mid", 0.27, 145, 13200, 760, [
      [32, 8, 8.5, 0.015, 0.72],
      [-46, 14, 10.1, 0.023, 0.14],
      [70, 22, 11.2, 0.031, 0.075],
    ]),
    piano: createStemRoute("stage-mid", 0.25, 100, 12400, 520, [
      [-28, 7, 8.7, 0.016, 0.72],
      [44, 15, 10.3, 0.024, 0.13],
      [-66, 25, 11.4, 0.032, 0.07],
    ]),
    drums: createStemRoute("stage-back", 0.31, 80, 11500, 1200, [
      [18, 2, 10.2, 0.018, 0.68],
      [-48, 8, 11.2, 0.026, 0.15],
      [68, 14, 12.4, 0.032, 0.09],
      [-82, 16, 13.2, 0.038, 0.06],
    ]),
    bass: createStemRoute("stage-back", 0.17, 190, 2800, 320, [
      [0, -7, 9.8, 0.02, 0.76],
      [-24, 0, 11.2, 0.029, 0.1],
      [42, 3, 12, 0.035, 0.08],
    ]),
    other: createStemRoute("stage-mid", 0.3, 125, 13000, 650, [
      [-28, 9, 8.4, 0.015, 0.72],
      [48, 14, 10.1, 0.023, 0.15],
      [0, 38, 10.8, 0.028, 0.08],
      [-72, 18, 11.6, 0.033, 0.065],
    ]),
  };
  const SPATIAL_STEM_ROOM_SCENE_SCALE = Object.freeze({
    vocals: 0.82,
    guitar: 0.94,
    piano: 0.9,
    other: 1,
    drums: 1,
    bass: 1,
  });
  const SPATIAL_STEM_LATERAL_EARLY_SCALE = Object.freeze({
    vocals: 0.78,
    guitar: 1.14,
    piano: 1.08,
    other: 1.16,
    drums: 1.1,
    bass: 0.9,
  });
  const SPATIAL_SCENE_SEPARATION = Object.freeze({
    presenceFrequency: 2650,
    presenceGain: -0.8,
    presenceQ: 0.76,
    envelopmentVocalLift: 0.23,
    field: Object.freeze({ vocals: 0.4, instruments: 1, residual: 0.8 }),
    lateral: Object.freeze({ vocals: 0, instruments: 1, residual: 0.62 }),
    hall: Object.freeze({ vocals: 0.16, instruments: 1, residual: 0.78 }),
    venue: Object.freeze({ vocals: 0.12, instruments: 0.94, residual: 0.7 }),
  });
  const FULL_SPATIAL_MIXTURE_SCALE_MIN = 0.72;
  const FULL_SPATIAL_MIXTURE_SCALE_MAX = 1.18;
  const FULL_SPATIAL_RESIDUAL_SAMPLE_LIMIT = 32768;
  const AUDIO_QUALITY_PROFILES = Object.freeze({
    full: {
      id: "full",
      label: "Full DSP",
      perimeterPairs: 5,
      hallPairs: 5,
      stemReflectionScale: 1,
      roomScale: 1,
    },
    balanced: {
      id: "balanced",
      label: "Balanced DSP",
      perimeterPairs: 4,
      hallPairs: 4,
      stemReflectionScale: 0.84,
      roomScale: 0.94,
    },
    safe: {
      id: "safe",
      label: "Safe DSP",
      perimeterPairs: 3,
      hallPairs: 3,
      stemReflectionScale: 0.68,
      roomScale: 0.86,
    },
  });
  function createMirroredDirections(pairs) {
    return pairs.flatMap(([id, angle, elevation, distance, gain, delay]) =>
      [-1, 1].map((side) => ({
        id: id + (side < 0 ? "Left" : "Right"),
        azimuth: angle * side,
        elevation,
        distance,
        gain,
        delay,
      })),
    );
  }

  function createStemRoute(depthRole, send, highpass, lowpass, diffuseHighpass, taps) {
    return {
      depthRole,
      send,
      highpass,
      lowpass,
      diffuseHighpass,
      taps: taps.map(([azimuth, elevation, distance, delay, gain], index) => ({
        azimuth,
        elevation,
        distance,
        delay,
        gain,
        ...(index === 0 ? { anchor: true } : {}),
      })),
    };
  }

  // Each renderer reads one scene. PCM and impulse caches remain shared by reference.
  function createRenderer(state) {
    function getBrirLibraryEntry(profileId = state.brirProfileId) {
      const profiles = state.brirLibrary?.profiles || [];
      return (
        profiles.find((profile) => profile.id === profileId) ||
        profiles.find((profile) => profile.id === state.brirLibrary?.defaultId) ||
        profiles[0] ||
        null
      );
    }

    function getAudioQualityProfile() {
      return AUDIO_QUALITY_PROFILES[state.audioQualityTier] || AUDIO_QUALITY_PROFILES.balanced;
    }

    function selectSymmetricDirectionPairs(directions, pairLimit) {
      const safeLimit = Math.max(1, Math.floor(pairLimit || 1));
      return directions.slice(0, safeLimit * 2);
    }

    function setAudioParamValue(param, value, time = 0) {
      if (!param) return;
      if (typeof param.setValueAtTime === "function") {
        param.setValueAtTime(value, time);
      } else {
        param.value = value;
      }
    }

    function createGainNode(context, value) {
      const node = context.createGain();
      node.gain.value = value;
      return node;
    }

    function createFilterNode(context, type, frequency, q = 1, gain = 0) {
      const node = context.createBiquadFilter();
      node.type = type;
      node.frequency.value = frequency;
      node.Q.value = q;
      node.gain.value = gain;
      return node;
    }

    function createConvolverNode(context, buffer) {
      const node = context.createConvolver();
      node.normalize = false;
      node.buffer = buffer;
      return node;
    }

    function createBufferSource(context, buffer) {
      const node = context.createBufferSource();
      node.buffer = buffer;
      return node;
    }

    function createPassthroughOutputChain(context, analysis, mode = "spatial", options = {}) {
      const input = context.createGain();
      const toneCurve = state.spatialOutputCalibration?.toneCurve || [];
      // An empty curve is an exact unit impulse; a gain node avoids a needless convolution.
      const toneCorrection = toneCurve.length
        ? createConvolverNode(context, global.SpatialAudioBinauralScene.buildToneCorrectionImpulse(context, toneCurve))
        : context.createGain();
      const peakTrim = context.createGain();
      const peakGuard = context.createDynamicsCompressor();
      const master = context.createGain();
      const outputGainScale = 1;
      const peakGuardPreGain = getSpatialOutputPeakGuardPreGain(state.spatialSettings, analysis);
      const loudnessMatchGain = getSpatialLoudnessMatchGain(state.spatialSettings, analysis);
      const truePeakHeadroomGain = getSpatialTruePeakHeadroomGain(state.playbackCalibration, analysis);
      const requestedCalibrationGain = Number(state.spatialOutputCalibration?.gain);
      const processedOutputGain = clamp(
        Number.isFinite(requestedCalibrationGain) ? requestedCalibrationGain : 1,
        0.5,
        4.5,
      );
      const predictiveSafetyGain = Math.min(peakGuardPreGain, loudnessMatchGain, truePeakHeadroomGain);
      const calibratedOutputGain = clamp(predictiveSafetyGain * processedOutputGain, 0.35, 4.5);
      peakTrim.gain.value = calibratedOutputGain;
      peakGuard.threshold.value = SPATIAL_OUTPUT_PEAK_GUARD_THRESHOLD_DB;
      peakGuard.knee.value = SPATIAL_OUTPUT_PEAK_GUARD_KNEE_DB;
      peakGuard.ratio.value = SPATIAL_OUTPUT_PEAK_GUARD_RATIO;
      peakGuard.attack.value = SPATIAL_OUTPUT_PEAK_GUARD_ATTACK;
      peakGuard.release.value = SPATIAL_OUTPUT_PEAK_GUARD_RELEASE;
      master.gain.value = outputGainScale;
      input.connect(toneCorrection).connect(peakTrim).connect(peakGuard).connect(master);
      master.connect(context.destination);

      const liveMeter = options.visualMeters === false
        ? { analyser: null, frequencyData: null, timeData: null, nodes: [] }
        : createLiveInstrumentMeter(context, master);
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
        toneCorrection,
        peakTrim,
        peakGuard,
        master,
        liveMeter,
        nodes: [input, toneCorrection, peakTrim, peakGuard, master, ...liveMeter.nodes],
      };
    }

    function createOriginalPlaybackGraph(context, buffer, analysis, options = {}) {
      const source = createBufferSource(context, buffer);
      const master = context.createGain();
      const measuredGain = Number(state.spatialOutputCalibration?.originalMatchGain);
      const outputGainScale =
        options.matchSpatial !== false && Number.isFinite(measuredGain) && measuredGain > 0
          ? clamp(measuredGain, 0.05, 4.5)
          : 1;
      master.gain.value = outputGainScale;
      source.connect(master).connect(context.destination);
      const liveMeter = createLiveInstrumentMeter(context, master);

      return {
        mode: "original",
        source,
        sources: [source],
        master,
        outputGainScale,
        analyser: liveMeter.analyser,
        frequencyData: liveMeter.frequencyData,
        timeData: liveMeter.timeData,
        previousLiveScores: {},
        nodes: [master, ...liveMeter.nodes],
      };
    }

    function createSpatialPlaybackGraph(context, buffer, analysis, options = {}) {
      const source = createBufferSource(context, buffer);
      const output = createPassthroughOutputChain(context, analysis, "spatial", options);
      const spatialLayer = createFullSpatialLayer(context, {
        mixSource: source,
        mixBuffer: buffer,
        output: output.input,
        analysis,
        stageWidth: options.stageWidth,
        ignoreStems: options.ignoreStems === true,
        visualMeters: options.visualMeters !== false,
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
        peakGuard: output.peakGuard,
        analyser: output.liveMeter.analyser,
        frequencyData: output.liveMeter.frequencyData,
        timeData: output.liveMeter.timeData,
        stemAnalysisMeters: spatialLayer.stemAnalysisMeters,
        previousLiveScores: {},
        spatialLayer,
        nodes: [...spatialLayer.nodes, ...output.nodes],
      };
    }

    function createFullSpatialLayer(context, options) {
      const { mixSource, mixBuffer, output, analysis } = options;
      const stemItems = options.ignoreStems ? [] : getSpatialStemItems(analysis);
      const measuredBrir = hasMeasuredBrirLibrary();
      const mixtureProfile = getMixtureConsistencyProfile(mixBuffer, stemItems);
      const audioQuality = getAudioQualityProfile();
      const roomProfile = getBrirLibraryEntry();
      const distanceProfile = getSpatialDistanceBrirProfile(state.spatialSettings.radius);
      const calibratedWidthScale = clamp(Number(state.spatialOutputCalibration?.widthScale) || 1, 0.62, 1);
      const qaRoomScale = clamp(Number(state.spatialOutputCalibration?.roomScale) || 1, 0.82, 1);
      const qaLateralScale = clamp(Number(state.spatialOutputCalibration?.lateralScale) || 1, 0.78, 1);
      const stageInput = context.createGain();
      const requestedStageWidth = Number(options.stageWidth ?? 2);
      const stageWidth =
        1 +
        (clamp(Number.isFinite(requestedStageWidth) ? requestedStageWidth : 2, 1, 2) - 1) *
          calibratedWidthScale *
          qaLateralScale;
      const wideStage = createFocusedWideStage(context, stageInput, output, stageWidth);
      const directBus = createGainNode(context, 0.86);
      const sharedPrimary = createBinauralPrimaryLayer(context, directBus, output, mixBuffer, 1, "shared-primary");
      const roomMaster = context.createGain();
      const roomLowGuard = createFilterNode(context, "highpass", SPATIAL_RESEARCH_PROFILE.wetHighpassHz, 0.5);
      const roomAirGuard = createFilterNode(
        context,
        "lowpass",
        SPATIAL_RESEARCH_PROFILE.wetLowpassHz,
        SPATIAL_RESEARCH_PROFILE.wetLowpassQ,
      );
      const roomResponseEq = createSpatialRoomResponseEq(context);
      const reflectionBus = createGainNode(context, 0.78 * state.spatialSettings.reflections);
      const lateralBus = createGainNode(
        context,
        0.24 * state.spatialSettings.radius * calibratedWidthScale * qaLateralScale,
      );
      const externalizationBus = createGainNode(context, 0.9 * (0.72 + state.spatialSettings.radius * 0.18));
      const orchestralHallBus = createGainNode(
        context,
        SPATIAL_RESEARCH_PROFILE.hallEarlyGain * (0.65 + state.spatialSettings.reflections * 0.35),
      );
      const lateEnvelopmentBus = createGainNode(context, state.spatialSettings.reflections * qaRoomScale);
      const venueTailBus = createGainNode(
        context,
        measuredBrir
          ? SPATIAL_RESEARCH_PROFILE.venueTailGain *
              state.spatialSettings.reflections *
              distanceProfile.gainScale *
              (roomProfile?.roomClass === "small"
                ? 0.76
                : roomProfile?.roomClass === "concert" || roomProfile?.roomClass === "tall"
                  ? 1.06
                  : 0.92)
          : 0,
      );
      const sceneSum = context.createGain();
      const vocalSceneSum = context.createGain();
      const instrumentSceneSum = context.createGain();
      const residualSceneSum = context.createGain();
      const instrumentPresenceEq = createFilterNode(
        context,
        "peaking",
        SPATIAL_SCENE_SEPARATION.presenceFrequency,
        SPATIAL_SCENE_SEPARATION.presenceQ,
        SPATIAL_SCENE_SEPARATION.presenceGain,
      );
      const residualSum = context.createGain();
      const sources = [];
      const nodes = [
        stageInput,
        ...wideStage.nodes,
        directBus,
        ...sharedPrimary.nodes,
        roomMaster,
        roomLowGuard,
        roomAirGuard,
        ...roomResponseEq.filters,
        reflectionBus,
        lateralBus,
        externalizationBus,
        orchestralHallBus,
        lateEnvelopmentBus,
        venueTailBus,
        sceneSum,
        vocalSceneSum,
        instrumentSceneSum,
        residualSceneSum,
        instrumentPresenceEq,
        residualSum,
      ];
      const stemObjects = [];
      const stemExternalizations = [];
      const residualCancellationGains = [];
      const stemAnalysisMeters = { byId: {}, nodes: [] };

      roomMaster.gain.value =
        getSpatialWetGain(state.spatialSettings) *
        SPATIAL_RESEARCH_PROFILE.earlyRoomGain * audioQuality.roomScale * qaRoomScale;
      sceneSum.gain.value = 0.86;

      // Reconstruct once, then render once. All leakage/residual cancellation happens
      // before the same fixed stereo matrix; no independently filtered copies sum.
      reflectionBus.connect(roomMaster);
      lateralBus.connect(roomMaster);
      externalizationBus.connect(roomMaster);
      orchestralHallBus.connect(roomMaster);
      // The diffuse soundfield has its own level, independent of the early-room EQ
      // and the old anti-phase widening stage.
      lateEnvelopmentBus.connect(output);
      venueTailBus.connect(roomMaster);
      roomMaster.connect(roomLowGuard).connect(roomResponseEq.input);
      roomResponseEq.output.connect(roomAirGuard).connect(stageInput);
      vocalSceneSum.connect(sceneSum);
      instrumentSceneSum.connect(sceneSum);
      instrumentSceneSum.connect(instrumentPresenceEq);
      residualSceneSum.connect(sceneSum);

      let residualPrimary;
      if (stemItems.length) {
        mixSource.connect(residualSum);
        stemItems.forEach((stem) => {
          const stemSource = context.createBufferSource();
          const sceneSend = context.createGain();
          const cancellation = createGainNode(context, -mixtureProfile.stemScale);
          const spatialConfidence = getStemObjectQualityGain(stem);
          const roomSceneScale = getStemRoomSceneScale(stem);
          stemSource.buffer = stem.buffer;
          stemSource.spatialAlignmentOffsetSeconds = Number(stem.alignmentOffsetSeconds) || 0;
          sceneSend.gain.value = mixtureProfile.stemScale * roomSceneScale;
          sources.push(stemSource);
          nodes.push(sceneSend, cancellation);
          residualCancellationGains.push(cancellation);

          if (options.visualMeters !== false) {
            const meter = createStemMeterTap(context, stemSource);
            nodes.push(...meter.nodes);
            stemAnalysisMeters.byId[stem.id] = meter;
          }

          const directObject = createFullSpatialStemDirectLayer(
            context,
            stemSource,
            stem,
            directBus,
            mixtureProfile.stemScale,
            sharedPrimary,
          );
          const reflections = createFullSpatialStemReflectionLayer(context, stemSource, stem, reflectionBus);
          // Keep direct/reverberant level ratios fixed. Transient ducking here made
          // sources breathe forward/back as separation leakage and onsets changed.
          const stemExternalization = createExternalizedPerimeterLayer(context, stemSource, externalizationBus, {
            channelCount: stem.buffer?.numberOfChannels || 2,
            stemId: stem.id,
            spatialConfidence,
          });
          stemSource.connect(sceneSend).connect(stem.id === "vocals" ? vocalSceneSum : instrumentSceneSum);
          stemSource.connect(cancellation).connect(residualSum);
          nodes.push(...directObject.nodes, ...reflections.nodes, ...stemExternalization.nodes);
          stemExternalizations.push(stemExternalization);
          stemObjects.push({
            ...directObject,
            reflections,
            externalization: stemExternalization,
            sceneSend,
            roomSceneScale,
            spatialConfidence,
          });
        });

        residualPrimary = createSharedPrimarySend(
          context,
          residualSum,
          directBus,
          1,
          "mixture-residual",
          sharedPrimary,
        );
        residualSum.connect(residualSceneSum);
        nodes.push(...residualPrimary.nodes);
      } else {
        sceneSum.gain.value = 0.7;
        residualPrimary = createSharedPrimarySend(context, mixSource, directBus, 1, "full-mix-fallback", sharedPrimary);
        mixSource.connect(sceneSum);
        nodes.push(...residualPrimary.nodes);
      }

      const separatedScenes = stemItems.length
        ? {
            field: createSeparatedSpatialScene(
              context,
              {
                vocals: vocalSceneSum,
                instruments: instrumentPresenceEq,
                residual: residualSceneSum,
              },
              SPATIAL_SCENE_SEPARATION.field,
            ),
            lateral: createSeparatedSpatialScene(
              context,
              {
                vocals: vocalSceneSum,
                instruments: instrumentSceneSum,
                residual: residualSceneSum,
              },
              SPATIAL_SCENE_SEPARATION.lateral,
            ),
            hall: createSeparatedSpatialScene(
              context,
              {
                vocals: vocalSceneSum,
                instruments: instrumentPresenceEq,
                residual: residualSceneSum,
              },
              SPATIAL_SCENE_SEPARATION.hall,
            ),
            venue: createSeparatedSpatialScene(
              context,
              {
                vocals: vocalSceneSum,
                instruments: instrumentPresenceEq,
                residual: residualSceneSum,
              },
              SPATIAL_SCENE_SEPARATION.venue,
            ),
          }
        : null;
      if (separatedScenes) {
        Object.values(separatedScenes).forEach((scene) => nodes.push(...scene.nodes));
      }
      const fieldSource = separatedScenes?.field.output || sceneSum;
      const lateralSource = separatedScenes?.lateral.output || sceneSum;
      const hallSource = separatedScenes?.hall.output || sceneSum;
      const venueSource = separatedScenes?.venue.output || sceneSum;
      const field = createDiffuseFieldLayer(context, fieldSource, reflectionBus, { measuredBrir, distanceProfile });
      const lateral = createLateralSideExpansionLayer(context, lateralSource, lateralBus, {
        analysis,
        channelCount: 2,
        focusedStage: stemItems.length > 0,
      });
      const externalization = stemItems.length
        ? {
            layers: stemExternalizations,
            taps: stemExternalizations.flatMap((layer) => layer.taps),
            radiusRange: [7.2, 11.8],
            stageFront: true,
            symmetric: true,
            nodes: [],
          }
        : createExternalizedPerimeterLayer(context, sceneSum, externalizationBus, { channelCount: 2 });
      const orchestralHall = createOrchestralHallEarlyLayer(context, hallSource, orchestralHallBus, {
        measuredBrir,
        channelCount: 2,
        distanceProfile,
      });
      const lateEnvelopment = createLateEnvelopmentLayer(context, venueSource, lateEnvelopmentBus, {
        measuredBrir,
        distanceProfile,
      });
      // Widen the vocal's independent late field without moving its first wavefront
      // or increasing the coherent early/venue reflections that push it backwards.
      const vocalEnvelopmentSend = stemItems.length
        ? createGainNode(context, 0.86 * SPATIAL_SCENE_SEPARATION.envelopmentVocalLift)
        : null;
      if (vocalEnvelopmentSend) {
        vocalSceneSum.connect(vocalEnvelopmentSend).connect(lateEnvelopment.send);
        nodes.push(vocalEnvelopmentSend);
      }
      const venueTail = measuredBrir
        ? createMeasuredVenueTailLayer(context, venueSource, venueTailBus, state.measuredBrirBuffer, {
            profile: "orchestral",
            roomProfile,
            distanceProfile,
          })
        : createEmptySpatialLayer();
      nodes.push(
        ...field.nodes,
        ...lateral.nodes,
        ...externalization.nodes,
        ...orchestralHall.nodes,
        ...lateEnvelopment.nodes,
        ...venueTail.nodes,
      );

      return {
        sources,
        nodes,
        directBus,
        sharedPrimary,
        wideStage,
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
        lateEnvelopmentBus,
        venueTailBus,
        sceneSum,
        vocalSceneSum,
        instrumentSceneSum,
        residualSceneSum,
        instrumentPresenceEq,
        separatedScenes,
        residualSum,
        residualPrimary,
        residualCancellationGains,
        mixtureProfile,
        stemObjects,
        transientControls: [],
        stemAnalysisMeters,
        field,
        lateral,
        externalization,
        orchestralHall,
        lateEnvelopment,
        vocalEnvelopmentSend,
        venueTail,
        usesOriginalAnchor: false,
        originalAnchorSend: null,
        fullBandAnchorBus: null,
        fullSpatial: true,
        audioQuality,
        qaRoomScale,
        qaLateralScale,
      };
    }

    function createFocusedWideStage(context, input, output, width = 2) {
      const splitter = context.createChannelSplitter(2);
      const leftSide = createGainNode(context, 0.5);
      const rightSide = createGainNode(context, -0.5);
      const side = context.createGain();
      const shelf = createFilterNode(context, "highshelf", 250, 1, 20 * Math.log10(clamp(width, 1, 2)));
      const subtractOriginal = createGainNode(context, -1);
      const difference = context.createGain();
      const invert = createGainNode(context, -1);
      const merger = context.createChannelMerger(2);
      // This stage receives only the room return; both direct buses bypass it.
      // Keep its mid intact and widen the ambience side above the bass region.
      input.connect(output);
      input.connect(splitter);
      splitter.connect(leftSide, 0).connect(side);
      splitter.connect(rightSide, 1).connect(side);
      side.connect(shelf).connect(difference);
      side.connect(subtractOriginal).connect(difference);
      difference.connect(merger, 0, 0);
      difference.connect(invert).connect(merger, 0, 1);
      merger.connect(output);
      return {
        width,
        shelf,
        input,
        nodes: [splitter, leftSide, rightSide, side, shelf, subtractOriginal, difference, invert, merger],
      };
    }

    function getMixtureConsistencyProfile(referenceBuffer, stemItems = []) {
      if (!referenceBuffer || !stemItems.length) {
        return {
          stemScale: 1,
          residualRatio: 1,
          reliable: false,
          sampleCount: 0,
        };
      }
      const memo = state.mixtureProfileMemo;
      if (memo?.reference === referenceBuffer && memo.stems.length === stemItems.length &&
          stemItems.every((stem, index) => memo.stems[index].buffer === stem.buffer &&
            memo.stems[index].alignment === (Number(stem.alignmentSamples) || 0))) {
        return memo.result;
      }
      const channelCount = Math.min(2, Math.max(1, referenceBuffer.numberOfChannels || 1,
        ...stemItems.map((stem) => stem.buffer?.numberOfChannels || 1)));
      const overlapStart = Math.max(0, ...stemItems.map((stem) => -(Number(stem.alignmentSamples) || 0)));
      const overlapEnd = Math.min(referenceBuffer.length, ...stemItems.map(
        (stem) => (stem.buffer?.length ?? 0) - (Number(stem.alignmentSamples) || 0),
      ));
      const length = Math.max(0, overlapEnd - overlapStart);
      const framesPerChannel = Math.min(Math.max(0, length), Math.floor(FULL_SPATIAL_RESIDUAL_SAMPLE_LIMIT / channelCount));
      const windowCount = Math.min(8, Math.max(1, Math.ceil(framesPerChannel / 2048)));
      const windowLength = Math.floor(framesPerChannel / windowCount);
      const windows = Array.from({ length: windowCount }, (_, index) => {
        const start = overlapStart + (windowCount === 1 ? 0 : Math.floor(index * (length - windowLength) / (windowCount - 1)));
        return { start, end: start + windowLength };
      });
      const referenceChannels = Array.from({ length: channelCount }, (_, channel) =>
        referenceBuffer.getChannelData(Math.min(channel, referenceBuffer.numberOfChannels - 1)));
      const hasWindowSignal = windows.some(({ start, end }) => referenceChannels.some((data) => {
        for (let index = start; index < end; index += 1) if (Math.abs(data[index]) > 1e-5) return true;
        return false;
      }));
      if (!hasWindowSignal && windowLength) {
        for (let index = overlapStart; index < overlapEnd; index += 1) {
          let active = false;
          for (const data of referenceChannels) {
            if (Math.abs(data[index]) > 1e-5) { active = true; break; }
          }
          if (active) {
            const start = Math.max(overlapStart, Math.min(index - Math.floor(windowLength / 2), overlapEnd - windowLength));
            windows[0] = { start, end: start + windowLength };
            break;
          }
        }
      }
      let dot = 0;
      let stemPower = 0;
      let referencePower = 0;
      let sampleCount = 0;

      for (let channel = 0; channel < channelCount; channel += 1) {
        const reference = referenceChannels[channel];
        const stemChannels = stemItems.map((stem) => {
          const buffer = stem.buffer;
          return {
            data: buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1)),
            lag: Number(stem.alignmentSamples) || 0,
          };
        });
        // Contiguous windows avoid periodic sampling aliases while spanning the track.
        for (const { start, end } of windows) {
          for (let index = start; index < end; index += 1) {
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
      }

      const rawScale = stemPower > 1e-12 ? dot / stemPower : 1;
      const stemScale = clamp(rawScale, FULL_SPATIAL_MIXTURE_SCALE_MIN, FULL_SPATIAL_MIXTURE_SCALE_MAX);
      // ||reference - scale * stems||? from the dot products above.
      const residualPower = Math.max(0, referencePower - 2 * stemScale * dot + stemScale * stemScale * stemPower);
      const residualRatio = Math.sqrt(residualPower / Math.max(referencePower, 1e-12));
      const result = {
        stemScale,
        residualRatio,
        reliable: sampleCount > 0 && referencePower > 1e-12 && residualRatio < 0.65,
        sampleCount,
      };
      if (memo) {
        memo.reference = referenceBuffer;
        memo.stems = stemItems.map((stem) => ({ buffer: stem.buffer, alignment: Number(stem.alignmentSamples) || 0 }));
        memo.result = result;
      }
      return result;
    }

    function createFullSpatialStemDirectLayer(context, input, stem, output, mixtureScale = 1, sharedPrimary) {
      const channelCount = Math.max(1, stem.buffer?.numberOfChannels || 1);
      const primary = createSharedPrimarySend(context, input, output, mixtureScale, stem.id, sharedPrimary);
      return {
        id: stem.id,
        qualityGain: 1,
        phasePreserving: false,
        binaural: true,
        position: primary.position,
        channelCount,
        directGain: mixtureScale,
        primaryPaths: primary.primaryPaths,
        lowBand: null,
        nodes: primary.nodes,
      };
    }

    function createSharedPrimarySend(context, input, output, gainValue, id, sharedPrimary) {
      const gain = createGainNode(context, gainValue);
      input.connect(gain).connect(output);
      return {
        id,
        gain,
        position: sharedPrimary.position,
        binaural: true,
        phasePreserving: false,
        primaryPaths: sharedPrimary.primaryPaths,
        nodes: [gain],
      };
    }

    function createBinauralPrimaryLayer(context, input, output, buffer, gainValue = 1, id = "primary") {
      // A single linear operator must process all stems AND their residual:
      // H(sum(stems) + residual) = H(original). Per-stem H/EQ breaks this identity.
      const position = { azimuth: 0, elevation: 0, distance: 1.5 };
      const directions = [-55, 55].map((azimuth) => ({
        azimuth,
        elevation: 0,
        distance: 1,
      }));
      const key = JSON.stringify([
        context.sampleRate,
        state.hrtfProfileId,
        state.universalHrtfStatus,
        "shared-symmetric-primary",
        directions,
      ]);
      let cache = BINAURAL_PRIMARY_CACHE.get(buffer);
      if (!cache) {
        cache = new Map();
        BINAURAL_PRIMARY_CACHE.set(buffer, cache);
      }
      let impulses = cache.get(key);
      if (!impulses) {
        const right = createBinauralRendererImpulse(context, directions[1], {
          role: "direct",
        });
        const left = context.createBuffer(2, right.length, context.sampleRate);
        left.copyToChannel(right.getChannelData(1), 0);
        left.copyToChannel(right.getChannelData(0), 1);
        // One measured direction and its mirror give a strictly centered mono sum.
        impulses = global.SpatialAudioBinauralScene.buildProgramMatchedImpulses(context, buffer, [left, right]);
        cacheAudioBuffer(cache, key, impulses, 8);
      }
      const gain = createGainNode(context, gainValue);
      const splitter = context.createChannelSplitter(2);
      input.connect(gain).connect(splitter);
      const renderers = impulses.map((impulse, channel) => {
        const convolver = createConvolverNode(context, impulse);
        splitter.connect(convolver, buffer.numberOfChannels === 1 ? 0 : channel);
        convolver.connect(output);
        return convolver;
      });
      return {
        id,
        gain,
        position,
        binaural: true,
        phasePreserving: false,
        primaryPaths: directions.map((direction, index) => ({
          position: direction,
          delaySeconds: 0,
          rendererMode: "program-matched-binaural",
          renderer: renderers[index],
        })),
        nodes: [gain, splitter, ...renderers],
      };
    }

    function createDirectionalTapBank(context, input, output, entries, cacheId, maxDelay = 0.06) {
      const compositeRenderer = createCompositeDirectionalRenderer(context, entries, cacheId);
      const nodes = [];
      if (compositeRenderer) {
        input.connect(compositeRenderer.node).connect(output);
        nodes.push(compositeRenderer.node);
      }
      const taps = entries.map((entry) => {
        let delay, gain, distanceAir;
        const renderer =
          compositeRenderer || createReferenceHrtfRenderer(context, entry.position, entry.rendererOptions);
        if (compositeRenderer) {
          delay = { delayTime: { value: entry.delaySeconds } };
          gain = { gain: { value: entry.gain } };
          if (entry.lowpassFrequency)
            distanceAir = {
              type: "lowpass",
              frequency: { value: entry.lowpassFrequency },
              Q: { value: entry.lowpassQ },
            };
        } else {
          delay = context.createDelay(maxDelay);
          gain = context.createGain();
          delay.delayTime.value = entry.delaySeconds;
          gain.gain.value = entry.gain;
          let tail = input.connect(delay);
          if (entry.lowpassFrequency) {
            distanceAir = context.createBiquadFilter();
            distanceAir.type = "lowpass";
            distanceAir.frequency.value = entry.lowpassFrequency;
            distanceAir.Q.value = entry.lowpassQ;
            tail = tail.connect(distanceAir);
            nodes.push(distanceAir);
          }
          tail.connect(gain).connect(renderer.node).connect(output);
          nodes.push(delay, gain, renderer.node);
        }
        return {
          direction: entry.direction || entry.position,
          delay,
          gain,
          ...(distanceAir ? { distanceAir } : {}),
          renderer: renderer.node,
          rendererMode: renderer.mode,
        };
      });
      return { taps, nodes, compositeRenderer };
    }

    function createFullSpatialStemReflectionLayer(context, input, stem, output) {
      const route = STEM_OBJECT_ROUTES[stem.id] || STEM_OBJECT_ROUTES.other;
      const send = context.createGain();
      const highpass = createFilterNode(
        context,
        "highpass",
        Math.max(route.diffuseHighpass || route.highpass, 320),
        0.5,
      );
      const lowpass = createFilterNode(context, "lowpass", route.lowpass, 0.4);
      const nodes = [send, highpass, lowpass];
      const taps = [];
      const quality = getAudioQualityProfile();
      const fullTapPlan = getSymmetricStemReflectionTapPlan(route.taps);
      const retainedTapRatio = quality.id === "full" ? 1 : quality.id === "balanced" ? 0.75 : 0.5;
      const retainedTapCount = Math.max(2, Math.ceil((fullTapPlan.length * retainedTapRatio) / 2) * 2);
      const tapPlan = fullTapPlan.slice(0, retainedTapCount);
      send.gain.value =
        route.send *
        getStemObjectQualityGain(stem) *
        0.72 *
        quality.stemReflectionScale *
        (stem.id === "vocals" ? 0.18 : 0.5);
      input.connect(send).connect(highpass).connect(lowpass);

      const compositeEntries = tapPlan.map((tap, index) => ({
        position: tap,
        delaySeconds: tap.delay,
        gain: tap.gain,
        rendererOptions: {
          role: "objectRoom",
          seed: STEM_ORDER.indexOf(stem.id) * 19 + index + 503,
          forceSynthetic: false,
        },
      }));
      const bank = createDirectionalTapBank(
        context,
        lowpass,
        output,
        compositeEntries,
        `stem-reflections-${stem.id}`,
        0.08,
      );
      taps.push(
        ...bank.taps.map(({ direction, delay, gain, ...tap }, index) => ({
          ...tapPlan[index],
          delayNode: delay,
          gainNode: gain,
          ...tap,
        })),
      );
      nodes.push(...bank.nodes);
      return {
        send,
        highpass,
        lowpass,
        taps,
        compositeRenderer: bank.compositeRenderer,
        nodes,
      };
    }

    function getSymmetricStemReflectionTapPlan(taps = []) {
      const groups = getCoherentStemTapPlan(taps)
        .filter((tap) => !tap.anchor)
        .map((tap) => {
          const azimuth = Math.abs(normalizeDegrees(tap.azimuth || 0));
          if (azimuth < 4 || azimuth > 176) return [{ ...tap, azimuth: normalizeDegrees(tap.azimuth || 0) }];
          const pairGain = tap.gain * Math.SQRT1_2;
          return [
            {
              ...tap,
              id: `${tap.id || "reflection"}-left`,
              azimuth: -azimuth,
              gain: pairGain,
            },
            {
              ...tap,
              id: `${tap.id || "reflection"}-right`,
              azimuth,
              gain: pairGain,
            },
          ];
        });
      // 품질 단계가 탭 수를 줄여도 좌우 방향쌍 중 한쪽만 잘리지 않게 쌍을 먼저 배치한다.
      return groups
        .filter((group) => group.length === 2)
        .flat()
        .concat(groups.filter((group) => group.length !== 2).flat());
    }

    function createMonoInput(context, input, channelCount) {
      const splitter = context.createChannelSplitter(2);
      const left = createGainNode(context, channelCount > 1 ? 0.5 : 1);
      const right = createGainNode(context, channelCount > 1 ? 0.5 : 0);
      const mid = context.createGain();
      input.connect(splitter);
      splitter.connect(left, 0).connect(mid);
      if (channelCount > 1) splitter.connect(right, 1).connect(mid);
      return { mid, nodes: [splitter, left, right, mid] };
    }

    function createExternalizedPerimeterLayer(context, input, output, options = {}) {
      const channelCount = Math.max(1, options.channelCount || input?.buffer?.numberOfChannels || 2);
      const mono = createMonoInput(context, input, channelCount);
      const send = context.createGain();
      const bodyGuard = createFilterNode(context, "highpass", options.stemId === "bass" ? 260 : 120, 0.5);
      const airGuard = createFilterNode(context, "lowpass", 14000, 0.4);
      const nodes = [...mono.nodes, send, bodyGuard, airGuard];
      const taps = [];
      const quality = getAudioQualityProfile();
      const stemPairLimit = quality.id === "full" ? 3 : quality.id === "balanced" ? 2 : 1;
      const directions = getExternalizationDirections(
        options.stemId,
        options.stemId ? stemPairLimit : quality.perimeterPairs,
      );
      const sendByStem = {
        vocals: 0.02,
        guitar: 0.19,
        piano: 0.175,
        other: 0.2,
        drums: 0.18,
        bass: 0.095,
      };
      const lateralEarlyScale = SPATIAL_STEM_LATERAL_EARLY_SCALE[options.stemId] || 1;
      const spatialConfidence = clamp(Number(options.spatialConfidence) || 1, 0.42, 1);
      const confidenceSendScale = options.stemId ? clamp(0.65 + spatialConfidence * 0.35, 0.78, 1) : 1;

      send.gain.value = (sendByStem[options.stemId] || 0.14) * confidenceSendScale;

      mono.mid.connect(send).connect(bodyGuard).connect(airGuard);

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
            rolloffFactor: 0.35,
          },
          isLateralEarlyReflection,
          appliedGainScale,
        };
      });
      const bank = createDirectionalTapBank(
        context,
        airGuard,
        output,
        compositeEntries,
        `externalization-${options.stemId || "mix"}`,
        0.05,
      );
      taps.push(
        ...bank.taps.map((tap, index) => ({
          ...tap,
          isLateralEarlyReflection: compositeEntries[index].isLateralEarlyReflection,
          appliedGainScale: compositeEntries[index].appliedGainScale,
        })),
      );
      nodes.push(...bank.nodes);

      return {
        send,
        bodyGuard,
        airGuard,
        taps,
        lateralEarlyScale,
        spatialConfidence,
        confidenceSendScale,
        compositeRenderer: bank.compositeRenderer,
        radiusRange: directions.length
          ? [
              Math.min(...directions.map((direction) => direction.distance)),
              Math.max(...directions.map((direction) => direction.distance)),
            ]
          : [0, 0],
        stageFront: Boolean(options.stemId),
        symmetric: true,
        nodes,
      };
    }

    function getExternalizationDirections(stemId, pairLimit = 5) {
      if (stemId && FULL_SPATIAL_STAGE_DIRECTIONS[stemId]) {
        return FULL_SPATIAL_STAGE_DIRECTIONS[stemId].slice(0, Math.max(1, pairLimit) * 2);
      }
      return FULL_SPATIAL_EXTERNALIZED_PERIMETER_DIRECTIONS.slice(0, Math.max(1, pairLimit) * 2);
    }

    function createOrchestralHallEarlyLayer(context, input, output, options = {}) {
      const channelCount = Math.max(1, options.channelCount || input?.buffer?.numberOfChannels || 2);
      const mono = createMonoInput(context, input, channelCount);
      const send = context.createGain();
      const bodyGuard = createFilterNode(context, "highpass", 160, 0.5);
      const airGuard = createFilterNode(context, "lowpass", options.measuredBrir ? 12500 : 11000, 0.4);
      const nodes = [...mono.nodes, send, bodyGuard, airGuard];
      const taps = [];
      const quality = getAudioQualityProfile();
      const distanceProfile = options.distanceProfile || SPATIAL_DISTANCE_BRIR_PROFILES.mid;
      const directions = selectSymmetricDirectionPairs(FULL_SPATIAL_ORCHESTRAL_HALL_DIRECTIONS, quality.hallPairs);

      send.gain.value = (options.measuredBrir ? 0.13 : 0.15) * quality.roomScale;

      mono.mid.connect(send).connect(bodyGuard).connect(airGuard);

      const compositeEntries = directions.map((direction, index) => ({
        position: getRoomHrtfPosition(direction),
        delaySeconds: direction.delay * distanceProfile.earlyDelayScale,
        gain: direction.gain,
        rendererOptions: {
          role: "reflection",
          seed: index + 701,
          forceSynthetic: false,
        },
      }));
      const bank = createDirectionalTapBank(context, airGuard, output, compositeEntries, "orchestral-hall");
      taps.push(
        ...bank.taps.map((tap, index) => ({
          ...tap,
          direction: directions[index],
        })),
      );
      nodes.push(...bank.nodes);

      return {
        send,
        bodyGuard,
        airGuard,
        taps,
        symmetric: true,
        distanceProfile,
        compositeRenderer: bank.compositeRenderer,
        nodes,
      };
    }

    function createLateEnvelopmentLayer(context, input, output, options = {}) {
      const splitter = context.createChannelSplitter(2);
      const send = context.createGain();
      const bodyGuard = createFilterNode(context, "highpass", 220, 0.5);
      const airGuard = createFilterNode(context, "lowpass", SPATIAL_LATE_FIELD.airLowpassHz, 0.5);
      send.gain.value = SPATIAL_LATE_FIELD.send * getReverbScale(state.analysis) * getSpatialWetGain(state.spatialSettings);
      input.connect(send).connect(bodyGuard).connect(airGuard).connect(splitter);
      const directions = FULL_SPATIAL_LATE_ENVELOPMENT_DIRECTIONS;
      // The directional HRIR filters are identical for both input channels.
      let directionalFilters = null;
      const renderers = [0, 1].map((channel) => {
        const key = JSON.stringify([
          "surround-field-v7-transition",
          context.sampleRate,
          state.hrtfProfileId,
          state.universalHrtfStatus,
          channel,
        ]);
        let impulse = state.decorrelatorImpulseCache.get(key);
        if (!impulse) {
          const duration = SPATIAL_LATE_FIELD.duration;
          impulse = context.createBuffer(2, Math.ceil(context.sampleRate * duration), context.sampleRate);
          if (!directionalFilters) {
            directionalFilters = directions.map((direction, directionIndex) => {
              const hrir = createBinauralRendererImpulse(
                context,
                { ...direction, distance: 1 },
                { role: "reflection", seed: 991 + directionIndex },
              );
              return [0, 1].map((ear) => {
                const full = hrir.getChannelData(ear);
                return {
                  full,
                  low: filterDirectionalImpulse(full, context.sampleRate, SPATIAL_LATE_FIELD.crossoverHz, 0.707),
                };
              });
            });
          }
          const impulseChannels = [impulse.getChannelData(0), impulse.getChannelData(1)];
          directions.forEach((direction, directionIndex) => {
            const filters = directionalFilters[directionIndex];
            const count = SPATIAL_LATE_FIELD.tapsPerDirection;
            for (let tap = 0; tap < count; tap += 1) {
              const seed = 1601 + channel * 977 + directionIndex * 101;
              const progress = tap / count;
              const elapsed = progress * SPATIAL_LATE_FIELD.tapSpan + (deterministicSigned(seed, tap) + 1) * 0.004;
              const time = direction.delay + elapsed;
              const frame = Math.round(time * context.sampleRate);
              // A fixed attack preserves the first wavefront without signal-driven ducking.
              const rise = Math.sin(Math.min(1, elapsed / SPATIAL_LATE_FIELD.riseSeconds) * Math.PI / 2);
              const highDecay = Math.exp(-elapsed / SPATIAL_LATE_FIELD.highDecaySeconds);
              const amplitude =
                (deterministicSigned(seed + 17, tap) < 0 ? -1 : 1) *
                rise *
                Math.exp((-6.9078 * elapsed) / SPATIAL_LATE_FIELD.decaySeconds) *
                direction.gain;
              for (let ear = 0; ear < 2; ear += 1) {
                const data = impulseChannels[ear];
                const { full, low } = filters[ear];
                const length = Math.min(full.length, data.length - frame);
                for (let index = 0; index < length; index += 1) {
                  data[frame + index] += (low[index] + (full[index] - low[index]) * highDecay) * amplitude;
                }
              }
            }
          });
          // An isotropic late field has balanced ear energy, but independent waveforms.
          // Unlike an L=-R widener it remains diffuse when summed to mono.
          for (let ear = 0; ear < 2; ear += 1) {
            const data = impulse.getChannelData(ear);
            let energy = 0;
            for (const sample of data) energy += sample * sample;
            const scale = Math.sqrt(0.5 / Math.max(energy, 1e-12));
            for (let index = 0; index < data.length; index += 1) data[index] *= scale;
          }
          cacheAudioBuffer(state.decorrelatorImpulseCache, key, impulse, 8);
        }
        const convolver = createConvolverNode(context, impulse);
        splitter.connect(convolver, channel);
        convolver.connect(output);
        return convolver;
      });
      return {
        send,
        bodyGuard,
        airGuard,
        renderers,
        taps: directions.map((direction) => ({
          direction,
          delay: { delayTime: { value: direction.delay } },
          gain: { gain: { value: direction.gain } },
          rendererMode: "independent-directional-late-fir",
        })),
        startsAfterEarlyWindow: false,
        preservesDirectWindowSeconds: 0.05,
        independentDirections: true,
        symmetric: false,
        nodes: [splitter, send, bodyGuard, airGuard, ...renderers],
      };
    }

    function createSpatialRoomResponseEq(context) {
      const spatialScale = clamp(
        0.72 + state.spatialSettings.wet * 0.2 + state.spatialSettings.reflections * 0.12,
        0.78,
        1,
      );
      const filters = SPATIAL_ROOM_RESPONSE_EQ.map((definition) => {
        const filter = createFilterNode(
          context,
          definition.type,
          definition.frequency,
          definition.q,
          definition.gain * spatialScale,
        );
        return filter;
      });
      for (let index = 0; index < filters.length - 1; index += 1) {
        filters[index].connect(filters[index + 1]);
      }
      return {
        input: filters[0],
        output: filters[filters.length - 1],
        filters,
        maximumCorrectionDb: Math.max(...filters.map((filter) => Math.abs(filter.gain.value))),
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
      const hybridConfidence = Number(stem?.quality?.hybridConfidence);
      const adaptiveScale =
        ["guitar", "piano"].includes(stem?.id) && Number.isFinite(hybridConfidence)
          ? clamp(0.78 + hybridConfidence * 0.22, 0.84, 1)
          : 1;
      return clamp((0.45 + separation * 0.55) * spatialWeight * adaptiveScale, 0.42, 1.05);
    }

    function getStemRoomSceneScale(stem) {
      const baseScale = SPATIAL_STEM_ROOM_SCENE_SCALE[stem?.id] || 1;
      if (baseScale >= 1) return 1;
      const confidence = clamp(getStemObjectQualityGain(stem), 0.42, 1);
      // 분리 신뢰도가 낮으면 누설 성분을 과도하게 빼지 않고 전체 장면으로 자연스럽게 되돌린다.
      return clamp(baseScale + (1 - confidence) * 0.16, baseScale, 1);
    }

    function createSeparatedSpatialScene(context, sources, levels) {
      const output = createGainNode(context, 0.86);
      const vocalSend = createGainNode(context, levels.vocals);
      const instrumentSend = createGainNode(context, levels.instruments);
      const residualSend = createGainNode(context, levels.residual);

      // 기존 sceneSum과 같은 기준 레벨을 유지해 공간 분리 전후의 음량 차이를 방지한다.

      sources.vocals.connect(vocalSend).connect(output);
      sources.instruments.connect(instrumentSend).connect(output);
      sources.residual.connect(residualSend).connect(output);

      return {
        output,
        vocalSend,
        instrumentSend,
        residualSend,
        levels: { ...levels },
        nodes: [output, vocalSend, instrumentSend, residualSend],
      };
    }

    function getCoherentStemTapPlan(taps = []) {
      if (!Array.isArray(taps) || !taps.length) return [];
      const anchorIndex = Math.max(
        0,
        taps.findIndex((tap) => tap.anchor),
      );
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
        gain: index === anchorIndex ? anchorGain : Math.max(0, Number(tap.gain) || 0) * diffuseScale,
        delay:
          index === anchorIndex
            ? anchorDelay
            : Math.max(Number(tap.delay) || 0, anchorDelay + SPATIAL_RESEARCH_PROFILE.anchorLeadSeconds),
      }));
    }

    function createLateralSideExpansionLayer(context, source, output, options = {}) {
      const channelCount = source?.buffer?.numberOfChannels || options.channelCount || 2;
      if (!source || channelCount < 2) {
        return createEmptySpatialLayer();
      }

      const splitter = context.createChannelSplitter(2);
      const leftSide = createGainNode(context, 0.5);
      const rightSide = createGainNode(context, -0.5);
      const sideSum = context.createGain();
      const sideGuard = createFilterNode(context, "highpass", SPATIAL_RESEARCH_PROFILE.lateralHighpassHz, 0.5);
      const sideSend = context.createGain();
      const leftMid = createGainNode(context, 0.5);
      const rightMid = createGainNode(context, 0.5);
      const midSum = context.createGain();
      const midSideGuard = createFilterNode(
        context,
        "highpass",
        SPATIAL_RESEARCH_PROFILE.midDerivedSideHighpassHz,
        0.5,
      );
      const midSideAirGuard = createFilterNode(
        context,
        "lowpass",
        SPATIAL_RESEARCH_PROFILE.midDerivedSideLowpassHz,
        0.4,
      );
      const midSideSend = context.createGain();
      const decorrelatorInput = context.createGain();
      const bandSum = createGainNode(context, options.focusedStage ? 1.25 : 2);
      const decorrelator = context.createConvolver();
      const measuredWidth = Number(options.analysis?.stereoImage?.width);
      const stereoWidth = clamp(Number.isFinite(measuredWidth) ? measuredWidth : 0.36, 0, 1);
      const sideLift = getLateralSideLift(stereoWidth, state.spatialSettings);

      sideSend.gain.value = 1.22 * sideLift;
      midSideSend.gain.value = getMidDerivedSideGain(stereoWidth, state.spatialSettings);
      decorrelator.normalize = false;
      decorrelator.buffer = createVelvetSideDecorrelatorImpulse(context);

      source.connect(splitter);
      splitter.connect(leftSide, 0);
      splitter.connect(rightSide, 1);
      leftSide.connect(sideSum);
      rightSide.connect(sideSum);
      sideSum.connect(sideGuard).connect(sideSend).connect(decorrelatorInput);
      splitter.connect(leftMid, 0);
      splitter.connect(rightMid, 1);
      leftMid.connect(midSum);
      rightMid.connect(midSum);
      midSum.connect(midSideGuard).connect(midSideAirGuard).connect(midSideSend).connect(decorrelatorInput);
      const bandDefinitions = [
        { id: "lowMid", low: 220, high: 900, fallback: 0.72 },
        { id: "mid", low: 900, high: 2800, fallback: 0.9 },
        { id: "presence", low: 2800, high: 7500, fallback: 0.92 },
        {
          id: "air",
          low: 7500,
          high: Math.min(15000, context.sampleRate * 0.46),
          fallback: 0.82,
        },
      ];
      const bandControls = bandDefinitions.map((definition) => {
        const highpass = createFilterNode(context, "highpass", definition.low, 0.55);
        const lowpass = createFilterNode(context, "lowpass", definition.high, 0.55);
        const gain = createGainNode(
          context,
          clamp(Number(state.spatialQualityProfile?.bandGains?.[definition.id]) || definition.fallback, 0.38, 1.08),
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
          decorrelator,
        ],
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
      const mono = createMonoInput(context, source, channelCount);
      const preDelay = context.createDelay(0.04);
      const bodyGuard = context.createBiquadFilter();
      const airGuard = context.createBiquadFilter();
      const convolver = createConvolverNode(context, impulseBuffer);
      const orchestral = options.profile === "orchestral";
      const distanceProfile = options.distanceProfile || SPATIAL_DISTANCE_BRIR_PROFILES.mid;

      preDelay.delayTime.value = distanceProfile.preDelay;
      bodyGuard.type = "highpass";
      bodyGuard.frequency.value = orchestral ? distanceProfile.highpass : 420;
      bodyGuard.Q.value = 0.5;
      airGuard.type = "lowpass";
      airGuard.frequency.value = orchestral ? distanceProfile.lowpass : 8200;
      airGuard.Q.value = 0.4;

      mono.mid.connect(preDelay).connect(bodyGuard).connect(airGuard).connect(convolver).connect(output);

      return {
        send: mono.mid,
        preDelay,
        bodyGuard,
        airGuard,
        convolver,
        distanceProfile,
        roomProfile: options.roomProfile || null,
        profile: orchestral ? "orchestral" : "bounded",
        taps: [],
        sources: [],
        nodes: [...mono.nodes, preDelay, bodyGuard, airGuard, convolver],
      };
    }

    function getLateralSideLift(stereoWidth, settings = state.spatialSettings) {
      return clamp(
        0.72 +
          (1 - clamp(stereoWidth, 0, 1)) * 0.2 +
          Math.max(0, settings.radius - 1) * 0.08 +
          Math.max(0, SPATIAL_SIDE_ENERGY_SCALE - 1) * 0.1,
        0.7,
        1.05,
      );
    }

    function getMidDerivedSideGain(stereoWidth, settings = state.spatialSettings) {
      return clamp(0.28 + (1 - clamp(stereoWidth, 0, 1)) * 0.18 + Math.max(0, settings.radius - 1) * 0.08, 0.3, 0.5);
    }

    function createStemMeterTap(context, input) {
      const analyser = context.createAnalyser();
      analyser.fftSize = STEM_METER_FFT_SIZE;
      analyser.minDecibels = -92;
      analyser.maxDecibels = -10;
      analyser.smoothingTimeConstant = 0.16;
      const silentTap = createGainNode(context, 0);
      input.connect(analyser);
      analyser.connect(silentTap).connect(context.destination);
      return {
        analyser,
        timeData: new Float32Array(analyser.fftSize),
        nodes: [analyser, silentTap],
      };
    }

    function createDiffuseFieldLayer(context, source, output, options = {}) {
      const send = createGainNode(context, options.measuredBrir ? 0.062 : 0.078);
      const bodyGuard = createFilterNode(context, "highpass", SPATIAL_RESEARCH_PROFILE.diffuseFieldHighpassHz, 0.5);
      const tone = createFilterNode(context, "lowpass", options.measuredBrir ? 10500 : 9000, 0.45);
      const nodes = [send, bodyGuard, tone];
      const taps = [];
      const directions = SPATIAL_FIELD_DIRECTIONS;
      const distanceProfile = options.distanceProfile || SPATIAL_DISTANCE_BRIR_PROFILES.mid;

      source.connect(send).connect(bodyGuard).connect(tone);

      const hrtfEntries = [];
      directions.forEach((direction, index) => {
        const gainScale = getSurroundTapGainScale(direction, options);
        const delayScale = getFarFieldDelayScale(options) * distanceProfile.earlyDelayScale;
        hrtfEntries.push({
          direction,
          position: getRoomHrtfPosition(direction),
          delaySeconds: Math.max(0.025, direction.delay * delayScale),
          gain: direction.gain * gainScale * 0.72,
          rendererOptions: {
            role: "reflection",
            seed: index + 17,
            forceSynthetic: false,
          },
        });
      });

      const bank = createDirectionalTapBank(context, tone, output, hrtfEntries, "diffuse-field");
      taps.push(...bank.taps.map((tap) => ({ ...tap, baseGain: tap.direction.gain })));
      nodes.push(...bank.nodes);

      return {
        send,
        bodyGuard,
        tone,
        taps,
        distanceProfile,
        compositeRenderer: bank.compositeRenderer,
        nodes,
      };
    }

    function getRoomHrtfPosition(position) {
      return {
        azimuth: clamp(Number(position.azimuth) || 0, -180, 180),
        elevation: clamp(Number(position.elevation) || 0, -68, 84),
        distance: clamp(Number(position.distance) || 1.25, 0.92, 24),
      };
    }

    function createBinauralRendererImpulse(context, position, options = {}) {
      return (
        createUniversalSofaImpulse(context, position, options) || createSyntheticHrtfImpulse(context, position, options)
      );
    }

    function canUseCompositeDirectionalRenderer() {
      return state.universalHrtfStatus === "ready" && state.universalHrtfProfile;
    }

    function createCompositeDirectionalRenderer(context, entries = [], cacheId = "field") {
      if (!canUseCompositeDirectionalRenderer() || !entries.length) return null;
      const cacheKey = JSON.stringify({
        cacheId,
        sampleRate: context.sampleRate,
        hrtf: state.hrtfProfileId,
        entries: entries.map((entry) => ({
          position: [entry.position.azimuth, entry.position.elevation, entry.position.distance],
          delay: entry.delaySeconds,
          gain: entry.gain,
          lowpass: entry.lowpassFrequency || 0,
          q: entry.lowpassQ || 0,
          role: entry.rendererOptions?.role || "",
          seed: entry.rendererOptions?.seed || 0,
        })),
      });
      let impulse = state.compositeDirectionalImpulseCache.get(cacheKey);
      if (!impulse) {
        const prepared = entries.map((entry) => {
          const directionalImpulse = createBinauralRendererImpulse(
            context,
            entry.position,
            entry.rendererOptions || {},
          );
          return {
            ...entry,
            impulse: directionalImpulse,
            delayFrames: Math.max(0, Math.round((Number(entry.delaySeconds) || 0) * context.sampleRate)),
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
      const convolver = createConvolverNode(context, impulse);
      return {
        node: convolver,
        impulse,
        mode: "composite-universal-sofa-fir",
      };
    }

    function filterDirectionalImpulse(source, sampleRate, frequency, q = 0.35) {
      const safeFrequency = clamp(Number(frequency) || 14000, 20, sampleRate * 0.48);
      const safeQ = clamp(Number(q) || 0.35, 0.1, 12);
      const omega = (2 * Math.PI * safeFrequency) / sampleRate;
      const cosine = Math.cos(omega);
      const alpha = Math.sin(omega) / (2 * safeQ);
      const a0 = 1 + alpha;
      const b0 = ((1 - cosine) * 0.5) / a0;
      const b1 = (1 - cosine) / a0;
      const b2 = b0;
      const a1 = (-2 * cosine) / a0;
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
      if (state.universalHrtfStatus === "ready" && state.universalHrtfProfile) {
        const convolver = createConvolverNode(context, createBinauralRendererImpulse(context, position, options));
        return { node: convolver, mode: "universal-sofa-fir" };
      }

      if (typeof context.createPanner === "function" && options.forceSynthetic !== true) {
        const panner = context.createPanner();
        configureReferenceHrtfPanner(context, panner, position, options);
        return { node: panner, mode: "native-hrtf" };
      }

      const convolver = createConvolverNode(context, createBinauralRendererImpulse(context, position, options));
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
      const azimuth = (clamp(position.azimuth || 0, -178, 178) * Math.PI) / 180;
      const elevation = (clamp(position.elevation || 0, -88, 88) * Math.PI) / 180;
      const distance = Math.max(0.1, Number(position.distance) || 1);
      const horizontal = Math.cos(elevation) * distance;
      return {
        x: Math.sin(azimuth) * horizontal,
        y: Math.sin(elevation) * distance,
        z: -Math.cos(azimuth) * horizontal,
      };
    }

    function hasMeasuredBrirLibrary() {
      return Boolean(
        state.measuredBrirBuffer &&
          state.measuredBrirBuffer.numberOfChannels >= 2 &&
          state.measuredBrirBuffer.duration >= 0.45,
      );
    }

    function getSurroundTapGainScale(direction, options = {}) {
      const azimuth = Math.abs(normalizeDegrees(direction.azimuth || 0));
      const elevation = Math.abs(Number(direction.elevation) || 0);
      const side = clamp(1 - Math.abs(azimuth - 105) / 72, 0, 1);
      const rear = clamp((azimuth - SPATIAL_FRONT_HEMISPHERE_AZIMUTH_LIMIT) / 70, 0, 1);
      const height = clamp((elevation - 38) / 42, 0, 1);
      const measuredBase = options.measuredBrir ? 0.98 : 1.04;
      const spaceLift = 1 + (SPATIAL_SPACE_MULTIPLIER - 1);
      const sideWidthLift = SPATIAL_WIDTH_MULTIPLIER - 1;
      const surroundLift =
        1 +
        side * (0.2 + (spaceLift - 1) * 0.08 + sideWidthLift * 0.12) * SPATIAL_SIDE_ENERGY_SCALE +
        rear * (0.08 + (spaceLift - 1) * 0.025 + sideWidthLift * 0.018) * SPATIAL_SIDE_ENERGY_SCALE +
        height * (0.12 + (spaceLift - 1) * 0.05) * (0.94 + SPATIAL_SIDE_ENERGY_SCALE * 0.04);
      return measuredBase * surroundLift;
    }

    function getFarFieldDelayScale(options = {}) {
      const spaceLift = 1 + (SPATIAL_SPACE_MULTIPLIER - 1);
      const naturalScale = SPATIAL_NATURAL_DELAY_SCALE;
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
      const renderRole =
        role === "objectRoom" || role === "centerStage" || role === "horizon"
          ? "reflection"
          : role === "object"
            ? "direct"
            : role;
      const lengthSeconds =
        renderRole === "body" ? 0.018 : renderRole === "orbit" ? 0.034 : renderRole === "reflection" ? 0.024 : 0.0145;
      const length = Math.max(96, Math.round(sampleRate * lengthSeconds));
      const buffer = context.createBuffer(2, length, sampleRate);
      const left = buffer.getChannelData(0);
      const right = buffer.getChannelData(1);
      const cue = getBinauralCue(position);
      const baseDelay =
        renderRole === "body"
          ? 0.0011 + cue.rear * 0.00062 + cue.low * 0.00036
          : renderRole === "orbit"
            ? 0.0024 + cue.rear * 0.0011
            : renderRole === "reflection"
              ? 0.0018 + cue.rear * 0.0007
              : 0.00018 + cue.rear * 0.00024;
      const leftStart = Math.round((baseDelay + cue.leftDelay) * sampleRate);
      const rightStart = Math.round((baseDelay + cue.rightDelay) * sampleRate);
      const rawDistanceGain = 1 / Math.sqrt(Math.max(0.72, position.distance || 1));
      const distanceGain = renderRole === "direct" ? rawDistanceGain : Math.max(rawDistanceGain, 0.48);
      const roleGain =
        renderRole === "body" ? 0.44 : renderRole === "orbit" ? 0.32 : renderRole === "reflection" ? 0.38 : 0.82;
      const seed = options.seed || 1;

      addFirTap(left, leftStart, cue.leftGain * distanceGain * roleGain);
      addFirTap(right, rightStart, cue.rightGain * distanceGain * roleGain);

      const profileCues = state.universalHrtfProfile?.cueModel || {};
      const elevationDegrees = clamp(Number(position.elevation) || 0, -70, 75);
      const baseNotchHz =
        cue.rear > 0.35 ? Number(profileCues.rearPinnaNotchHz) || 6700 : Number(profileCues.frontPinnaNotchHz) || 8900;
      const notchHz = clamp(
        baseNotchHz + elevationDegrees * (Number(profileCues.elevationNotchSlopeHzPerDegree) || 38),
        4200,
        12200,
      );
      const pinnaBase = Math.max(2, Math.round(sampleRate / (2 * notchHz)));
      const rearShade = cue.rear > 0.36 ? -1 : 1;
      const tapCount = renderRole === "orbit" ? 7 : renderRole === "body" ? 4 : 5;
      for (let tap = 1; tap <= tapCount; tap += 1) {
        const offset = pinnaBase + tap * Math.round((0.00058 + tap * 0.00018 + cue.rear * 0.00012) * sampleRate);
        const sign = tap % 2 ? 1 : -1;
        const spread = 1 + Math.abs(cue.side) * 0.2 + cue.height * 0.2 + cue.rear * 0.26;
        const amp = roleGain * distanceGain * (0.12 / (tap + 0.45)) * sign * rearShade;
        addFirTap(left, leftStart + offset, amp * (cue.leftGain * 0.68 + spread * 0.12));
        addFirTap(
          right,
          rightStart + offset + Math.round(cue.side * sampleRate * 0.00022),
          amp * (cue.rightGain * 0.68 - spread * 0.09),
        );
      }

      const shoulderDelay = Math.round((0.0048 + cue.rear * 0.0038 + cue.height * 0.0014) * sampleRate);
      const shoulderAmp =
        roleGain *
        distanceGain *
        (renderRole === "body"
          ? 0.075 + cue.rear * 0.025 + cue.low * 0.024
          : 0.035 + cue.rear * 0.028 + cue.height * 0.016);
      addFirTap(left, rightStart + shoulderDelay, shoulderAmp * cue.crossLeft);
      addFirTap(right, leftStart + shoulderDelay + 1, shoulderAmp * cue.crossRight);

      if (renderRole === "body") {
        const wrapDelay = Math.round((0.0085 + cue.rear * 0.004 + Math.abs(cue.side) * 0.0018) * sampleRate);
        const wrapAmp = roleGain * distanceGain * 0.055;
        addFirTap(left, leftStart + wrapDelay, wrapAmp * (0.72 + cue.rear * 0.36));
        addFirTap(right, rightStart + wrapDelay + 1, wrapAmp * (0.72 + cue.rear * 0.36));
      }

      const airTap = Math.round(
        (0.0068 + Math.abs(cue.side) * 0.0018 + cue.height * 0.0012 + cue.rear * 0.0022) * sampleRate,
      );
      addFirTap(left, leftStart + airTap, deterministicSigned(seed, 0) * 0.018 * roleGain * (1 + cue.height * 0.5));
      addFirTap(
        right,
        rightStart + airTap + 2,
        deterministicSigned(seed, 1) * 0.018 * roleGain * (1 + cue.height * 0.5),
      );
      normalizeImpulsePair(
        left,
        right,
        renderRole === "body" ? 0.46 : renderRole === "orbit" ? 0.42 : renderRole === "reflection" ? 0.56 : 0.82,
      );
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
        8,
      );
      // 각도는 내적이 클수록 가깝다. 전체 정렬 없이 프로파일이 지정한 최근접 방향만 유지한다.
      for (let index = 0; index < dataset.directionCount; index += 1) {
        const offset = index * 3;
        const dot = clamp(
          target.x * dataset.unitVectors[offset] +
            target.y * dataset.unitVectors[offset + 1] +
            target.z * dataset.unitVectors[offset + 2],
          -1,
          1,
        );
        if (selected.length === neighborCount && dot <= selected[neighborCount - 1].dot) continue;
        const insertAt = selected.findIndex((item) => dot > item.dot);
        selected.splice(insertAt < 0 ? selected.length : insertAt, 0, {
          index,
          dot,
        });
        if (selected.length > neighborCount) selected.pop();
      }
      selected.forEach((item) => {
        item.angle = Math.acos(item.dot);
      });
      const weights = selected.map((item) => 1 / Math.pow(item.angle + 0.015, 2));
      const weightTotal = weights.reduce((sum, value) => sum + value, 0);
      const outputTapCount = Math.max(1, Math.ceil((dataset.tapCount * context.sampleRate) / dataset.sampleRate));
      const sourceSamplesPerOutput = dataset.sampleRate / context.sampleRate;
      const output = context.createBuffer(2, outputTapCount, context.sampleRate);
      const role = options.role || "direct";
      const renderRole = ["objectRoom", "centerStage", "horizon"].includes(role)
        ? "reflection"
        : role === "object"
          ? "direct"
          : role;
      const roleGain =
        renderRole === "body" ? 0.5 : renderRole === "orbit" ? 0.38 : renderRole === "reflection" ? 0.46 : 0.88;
      const distanceGain = 1 / Math.sqrt(Math.max(0.72, Number(position.distance) || 1));
      for (let receiver = 0; receiver < 2; receiver += 1) {
        const channel = output.getChannelData(receiver);
        if (selected[0].angle < 1e-7) {
          const sourceOffset = (selected[0].index * 2 + receiver) * dataset.tapCount;
          for (let tap = 0; tap < outputTapCount; tap += 1) {
            channel[tap] =
              sampleHrtfImpulse(dataset.impulses, sourceOffset, dataset.tapCount, tap * sourceSamplesPerOutput) *
              roleGain *
              distanceGain;
          }
          continue;
        }
        const targetOnset = selected.reduce(
          (sum, item, rank) => sum + (dataset.onsets[item.index * 2 + receiver] * weights[rank]) / weightTotal,
          0,
        );
        selected.forEach((item, rank) => {
          const weight = weights[rank] / weightTotal;
          const sourceOffset = (item.index * 2 + receiver) * dataset.tapCount;
          const sourceOnset = dataset.onsets[item.index * 2 + receiver];
          const scale = weight * roleGain * distanceGain;
          for (let tap = 0; tap < outputTapCount; tap += 1) {
            const sourceTap = tap * sourceSamplesPerOutput + sourceOnset - targetOnset;
            if (sourceTap < 0 || sourceTap > dataset.tapCount - 1) continue;
            channel[tap] += sampleHrtfImpulse(dataset.impulses, sourceOffset, dataset.tapCount, sourceTap) * scale;
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
      const azimuth = (Number(azimuthDegrees) * Math.PI) / 180;
      const elevation = (Number(elevationDegrees) * Math.PI) / 180;
      const horizontal = Math.cos(elevation);
      return {
        x: Math.sin(azimuth) * horizontal,
        y: Math.sin(elevation),
        z: Math.cos(azimuth) * horizontal,
      };
    }

    function getHrtfImpulseCacheKey(context, position, options = {}) {
      const role = options.role || "direct";
      const seed = options.seed || 1;
      const azimuth = Math.round((position.azimuth || 0) * 2) / 2;
      const elevation = Math.round((position.elevation || 0) * 2) / 2;
      const distance = Math.round((position.distance || 1) * 20) / 20;
      const profileId = state.universalHrtfProfile?.id || "fallback";
      return `${profileId}:${context.sampleRate}:${role}:${seed}:${azimuth}:${elevation}:${distance}`;
    }

    function getBinauralCue(position) {
      const azimuthDegrees = clamp(position.azimuth || 0, -SPATIAL_MAX_RENDER_AZIMUTH, SPATIAL_MAX_RENDER_AZIMUTH);
      const azimuth = (azimuthDegrees * Math.PI) / 180;
      const elevation = (clamp(position.elevation || 0, -70, 75) * Math.PI) / 180;
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
      const leftGain = side > 0 ? 1 - shadow - rearDull : 1 + shadow * 0.26 + heightLift;
      const rightGain = side < 0 ? 1 - shadow - rearDull : 1 + shadow * 0.26 + heightLift;
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
        crossRight: clamp(0.27 + front * 0.12 + rear * 0.46 + height * 0.16, 0.2, 0.86),
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
      const normalized = (((Number(value) || 0) + 180) % 360) - 180;
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
      const spatialLoad = clamp(
        settings.wet * 0.34 + settings.reflections * 0.22 + (SPATIAL_SIDE_ENERGY_SCALE / 10) * 0.24,
        0,
        1,
      );
      return clamp(
        SPATIAL_OUTPUT_PEAK_GUARD_PRE_GAIN -
          spatialLoad * 0.025 -
          nearClip * spatialLoad * 0.07 -
          nearClip * loudBody * 0.025,
        0.86,
        SPATIAL_OUTPUT_PEAK_GUARD_PRE_GAIN,
      );
    }

    function getSpatialLoudnessMatchGain(settings = state.spatialSettings, analysis = state.analysis) {
      const quality = getAudioQualityProfile();
      const directEnergy = 0.86 * 0.86;
      const roomEstimate =
        0.42 + settings.wet * 0.12 + settings.reflections * 0.1 + Math.max(0, settings.radius - 1) * 0.18;
      const estimatedSpatialEnergy = directEnergy + roomEstimate * roomEstimate * quality.roomScale;
      const energyMatch = 1 / Math.sqrt(Math.max(estimatedSpatialEnergy, 1e-6));
      const sourceLufs = Number(analysis?.mix?.approxLufs);
      const loudProgramTrim = Number.isFinite(sourceLufs) ? clamp(1 - Math.max(0, sourceLufs + 12) * 0.012, 0.9, 1) : 1;
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
      const silentTap = createGainNode(context, 0);
      input.connect(analyser);
      analyser.connect(silentTap).connect(context.destination);
      return {
        analyser,
        frequencyData: new Float32Array(analyser.frequencyBinCount),
        timeData: new Float32Array(analyser.fftSize),
        nodes: [analyser, silentTap],
      };
    }
    return {
      getBrirLibraryEntry,
      getAudioQualityProfile,
      selectSymmetricDirectionPairs,
      setAudioParamValue,
      createGainNode,
      createFilterNode,
      createConvolverNode,
      createBufferSource,
      createPassthroughOutputChain,
      createOriginalPlaybackGraph,
      createSpatialPlaybackGraph,
      createFullSpatialLayer,
      createFocusedWideStage,
      getMixtureConsistencyProfile,
      createFullSpatialStemDirectLayer,
      createSharedPrimarySend,
      createBinauralPrimaryLayer,
      createDirectionalTapBank,
      createFullSpatialStemReflectionLayer,
      getSymmetricStemReflectionTapPlan,
      createMonoInput,
      createExternalizedPerimeterLayer,
      getExternalizationDirections,
      createOrchestralHallEarlyLayer,
      createLateEnvelopmentLayer,
      createSpatialRoomResponseEq,
      getSpatialDistanceBrirProfile,
      getSpatialStemItems,
      getStemObjectQualityGain,
      getStemRoomSceneScale,
      createSeparatedSpatialScene,
      getCoherentStemTapPlan,
      createLateralSideExpansionLayer,
      createVelvetSideDecorrelatorImpulse,
      createMeasuredVenueTailLayer,
      getLateralSideLift,
      getMidDerivedSideGain,
      createStemMeterTap,
      createDiffuseFieldLayer,
      getRoomHrtfPosition,
      createBinauralRendererImpulse,
      canUseCompositeDirectionalRenderer,
      createCompositeDirectionalRenderer,
      filterDirectionalImpulse,
      createReferenceHrtfRenderer,
      configureReferenceHrtfPanner,
      sphericalToListenerCoordinates,
      hasMeasuredBrirLibrary,
      getSurroundTapGainScale,
      getFarFieldDelayScale,
      createEmptySpatialLayer,
      createSyntheticHrtfImpulse,
      createUniversalSofaImpulse,
      sampleHrtfImpulse,
      sphericalUnitVector,
      getHrtfImpulseCacheKey,
      getBinauralCue,
      cacheAudioBuffer,
      addFirTap,
      deterministicSigned,
      normalizeDegrees,
      normalizeImpulsePair,
      getSpatialWetGain,
      getSpatialOutputPeakGuardPreGain,
      getSpatialLoudnessMatchGain,
      getSpatialTruePeakHeadroomGain,
      createLiveInstrumentMeter,
    };
  }

  // Track-level tuning stays fixed during playback: no vocal pumping or image motion.
  function getReverbScale(analysis) {
    const sections = Array.isArray(analysis?.sections) ? analysis.sections : [];
    const density = sections.length
      ? sections.reduce((sum, section) => sum + clamp(Number(section.density) || 0, 0, 1), 0) / sections.length
      : clamp((analysis?.activeIds?.length || 5) / 10, 0, 1);
    const crest = Number(analysis?.mix?.crestDb);
    const dynamics = clamp(((Number.isFinite(crest) ? crest : 12) - 7) / 15, 0, 1);
    const vocals = analysis?.activeIds?.includes("vocals") ? 1 : 0;
    // Stereo width is a cautious proxy for existing spaciousness, not a reverb estimate.
    const stereo = analysis?.stereoImage;
    const width = Number(stereo?.width);
    const confidence = Number(stereo?.confidence);
    const widthGuard = stereo?.status === "stereo" && Number.isFinite(width) && Number.isFinite(confidence)
      ? clamp((width - 0.2) / 0.5, 0, 1) * clamp(confidence, 0, 1) * 0.08
      : 0;
    const base = clamp(0.85 + dynamics * 0.15 - density * 0.18 - vocals * 0.05, 0.67, 1);
    return Math.max(0.59, base - widthGuard);
  }

  function createRenderPlan(source, buffer, analysis = source.analysis, options = {}) {
    const freeze = Object.freeze;
    const outputCalibration = options.calibration === undefined ? source.spatialOutputCalibration : options.calibration;
    const stems = Object.fromEntries(
      Object.entries(source.stemBuffers || {}).map(([id, stem]) => [
        id,
        freeze({
          ...stem,
          quality: stem.quality ? freeze({ ...stem.quality }) : stem.quality,
        }),
      ]),
    );
    const snapshot = freeze({
      analysis: freeze({
        ...analysis,
        mix: freeze({ ...analysis?.mix }),
        stereoImage: freeze({ ...analysis?.stereoImage }),
      }),
      stemBuffers: freeze(stems),
      spatialSettings: freeze({ ...source.spatialSettings }),
      mixtureProfileMemo: source.mixtureProfileMemo || {},
      spatialOutputCalibration: outputCalibration
        ? freeze({
            ...outputCalibration,
            toneCurve: freeze((outputCalibration.toneCurve || []).map((point) => freeze({ ...point }))),
          })
        : null,
      playbackCalibration: source.playbackCalibration ? freeze({ ...source.playbackCalibration }) : null,
      spatialQualityProfile: source.spatialQualityProfile
        ? freeze({
            ...source.spatialQualityProfile,
            bandGains: freeze({ ...source.spatialQualityProfile.bandGains }),
          })
        : null,
      audioQualityTier: source.audioQualityTier,
      hrtfProfileId: source.hrtfProfileId,
      universalHrtfStatus: source.universalHrtfStatus,
      universalHrtfProfile: source.universalHrtfProfile,
      universalHrtfDataset: source.universalHrtfDataset,
      brirProfileId: source.brirProfileId,
      brirLibrary: source.brirLibrary,
      measuredBrirBuffer: source.measuredBrirBuffer,
      hrtfImpulseCache: source.hrtfImpulseCache,
      compositeDirectionalImpulseCache: source.compositeDirectionalImpulseCache,
      decorrelatorImpulseCache: source.decorrelatorImpulseCache,
    });
    const renderOptions = freeze({
      stageWidth: options.stageWidth,
      ignoreStems: options.ignoreStems === true,
      visualMeters: options.visualMeters !== false,
    });
    const renderer = createRenderer(snapshot);
    return freeze({
      snapshot,
      buffer,
      options: renderOptions,
      withCalibration: (calibration) =>
        createRenderPlan(snapshot, buffer, snapshot.analysis, {
          ...renderOptions,
          calibration,
        }),
      render: (context) => renderer.createSpatialPlaybackGraph(context, buffer, snapshot.analysis, renderOptions),
    });
  }

  global.SpatialAudioRenderer = Object.freeze({
    getReverbScale,
    createRenderer,
    createRenderPlan,
    config: Object.freeze({
      SPATIAL_SURROUND_SPHERE,
      LIVE_ANALYSER_FFT_SIZE,
      STEM_METER_FFT_SIZE,
      SPATIAL_SPACE_MULTIPLIER,
      SPATIAL_WIDTH_MULTIPLIER,
      SPATIAL_SIDE_ENERGY_SCALE,
      SPATIAL_OUTPUT_PEAK_GUARD_PRE_GAIN,
      SPATIAL_OUTPUT_PEAK_GUARD_THRESHOLD_DB,
      SPATIAL_OUTPUT_PEAK_GUARD_KNEE_DB,
      SPATIAL_OUTPUT_PEAK_GUARD_RATIO,
      SPATIAL_OUTPUT_PEAK_GUARD_ATTACK,
      SPATIAL_OUTPUT_PEAK_GUARD_RELEASE,
      SPATIAL_NATURAL_DELAY_SCALE,
      SPATIAL_FRONT_HEMISPHERE_AZIMUTH_LIMIT,
      SPATIAL_MAX_RENDER_AZIMUTH,
      SPATIAL_RESEARCH_PROFILE,
      SPATIAL_ROOM_RESPONSE_EQ,
      SPATIAL_DISTANCE_BRIR_PROFILES,
      SPATIAL_FIELD_DIRECTIONS,
      FULL_SPATIAL_ORCHESTRAL_HALL_DIRECTIONS,
      FULL_SPATIAL_LATE_ENVELOPMENT_DIRECTIONS,
      FULL_SPATIAL_EXTERNALIZED_PERIMETER_DIRECTIONS,
      FULL_SPATIAL_STAGE_DIRECTIONS,
      STEM_OBJECT_ROUTES,
      SPATIAL_STEM_ROOM_SCENE_SCALE,
      SPATIAL_STEM_LATERAL_EARLY_SCALE,
      SPATIAL_SCENE_SEPARATION,
      FULL_SPATIAL_MIXTURE_SCALE_MIN,
      FULL_SPATIAL_MIXTURE_SCALE_MAX,
      FULL_SPATIAL_RESIDUAL_SAMPLE_LIMIT,
      AUDIO_QUALITY_PROFILES,
    }),
  });
})(window);
