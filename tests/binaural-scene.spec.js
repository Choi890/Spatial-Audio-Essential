const { test, expect } = require("@playwright/test");
const fs = require("node:fs");

test("directional HRTF impulses are reused when only room radius changes", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(() => {
    const context = new OfflineAudioContext(2, 48000, 48000);
    state.hrtfImpulseCache.clear();
    const originalRadius = state.spatialSettings.radius;
    const position = {azimuth: 30, elevation: 0, distance: 1};
    try {
      state.spatialSettings.radius = 1;
      const first = audioRenderer.createSyntheticHrtfImpulse(context, position, {role: "direct"});
      state.spatialSettings.radius = 1.5;
      const second = audioRenderer.createSyntheticHrtfImpulse(context, position, {role: "direct"});
      const different = audioRenderer.createSyntheticHrtfImpulse(context, {...position, azimuth: 40}, {role: "direct"});
      return {reused: first === second, distinctDirection: first !== different};
    } finally { state.spatialSettings.radius = originalRadius; }
  });
  expect(result.reused).toBe(true);
  expect(result.distinctDirection).toBe(true);
});

test("measured HRTF cache reuse across radius changes preserves impulse samples", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    await ensureUniversalHrtfProfile();
    const context = new OfflineAudioContext(2, 48000, 48000);
    const radius = state.spatialSettings.radius;
    const position = {azimuth: 30, elevation: 10, distance: 1};
    try {
      state.hrtfImpulseCache.clear();
      state.spatialSettings.radius = 1;
      const first = audioRenderer.createUniversalSofaImpulse(context, position, {role: "direct"});
      state.spatialSettings.radius = 1.5;
      const cached = audioRenderer.createUniversalSofaImpulse(context, position, {role: "direct"});
      state.hrtfImpulseCache.clear();
      const fresh = audioRenderer.createUniversalSofaImpulse(context, position, {role: "direct"});
      if (!first || !fresh) return {available: false};
      let maxDifference = 0;
      for (let channel = 0; channel < 2; channel++) {
        const a = first.getChannelData(channel), b = fresh.getChannelData(channel);
        for (let i = 0; i < a.length; i++) maxDifference = Math.max(maxDifference, Math.abs(a[i] - b[i]));
      }
      return {available: true, reused: first === cached, maxDifference};
    } finally { state.spatialSettings.radius = radius; }
  });
  expect(result.available).toBe(true);
  expect(result.reused).toBe(true);
  expect(result.maxDifference).toBe(0);
});

test("spatial graph renders identical audio with warm and cold HRTF caches", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    await ensureUniversalHrtfProfile();
    const rate = 48000, frames = rate;
    const source = new OfflineAudioContext(2, frames, rate).createBuffer(2, frames / 2, rate);
    for (let channel = 0; channel < 2; channel++) {
      const data = source.getChannelData(channel);
      for (let i = 0; i < data.length; i++) data[i] = 0.04 * Math.sin(i * 0.07 + channel * 0.3);
    }
    state.analysis = {mix: {peakDb: -20, rmsDb: -30}, stereoImage: {width: 0.4}};
    state.stemBuffers = null; state.spatialOutputCalibration = null; state.measuredBrirBuffer = null;
    const radius = state.spatialSettings.radius;
    const build = async (value, render) => {
      state.spatialSettings.radius = value;
      const context = new OfflineAudioContext(2, frames, rate);
      const graph = createSpatialPlaybackGraph(context, source, state.analysis);
      if (!render) { disconnectGraph(graph); return null; }
      startGraphSources(graph, 0);
      const output = await context.startRendering();
      disconnectGraph(graph);
      return output;
    };
    try {
      state.hrtfImpulseCache.clear();
      await build(1, false);
      const warm = await build(1.5, true);
      state.hrtfImpulseCache.clear();
      const cold = await build(1.5, true);
      let maximumError = 0;
      for (let channel = 0; channel < 2; channel++) {
        const a = warm.getChannelData(channel), b = cold.getChannelData(channel);
        for (let i = 0; i < frames; i++) maximumError = Math.max(maximumError, Math.abs(a[i] - b[i]));
      }
      return {maximumError};
    } finally { state.spatialSettings.radius = radius; }
  });
  expect(result.maximumError).toBeLessThan(1e-7);
});

test("full spatial field preserves stereo direction and balanced mirrored energy", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    await ensureUniversalHrtfProfile();
    const rate = 48000, length = rate;
    const render = async (channel) => {
      const context = new OfflineAudioContext(2, length, rate);
      const input = context.createBuffer(2, rate / 4, rate);
      input.getChannelData(channel)[128] = 0.1;
      state.analysis = {mix: {peakDb: -20, rmsDb: -40}, stereoImage: {width: 1}};
      state.stemBuffers = null; state.spatialOutputCalibration = null; state.measuredBrirBuffer = null;
      const graph = createSpatialPlaybackGraph(context, input, state.analysis);
      startGraphSources(graph, 0);
      const audio = await context.startRendering();
      const energy = [0, 0]; let mid = 0, side = 0;
      const left = audio.getChannelData(0), right = audio.getChannelData(1);
      for (let i = 0; i < length; i++) {
        energy[0] += left[i] ** 2; energy[1] += right[i] ** 2;
        mid += (left[i] + right[i]) ** 2; side += (left[i] - right[i]) ** 2;
      }
      disconnectGraph(graph);
      return {energy, monoFraction: mid / (mid + side)};
    };
    const left = await render(0), right = await render(1);
    return {left, right, mirroredDb: [0, 1].map(ch => 10 * Math.log10(left.energy[ch] / right.energy[1 - ch]))};
  });
  expect(result.left.energy[0], JSON.stringify(result)).toBeGreaterThan(result.left.energy[1]);
  expect(result.right.energy[1], JSON.stringify(result)).toBeGreaterThan(result.right.energy[0]);
  for (const db of result.mirroredDb) expect(Math.abs(db), JSON.stringify(result)).toBeLessThan(1.5);
  for (const sample of [result.left, result.right]) {
    expect(sample.monoFraction, JSON.stringify(result)).toBeGreaterThan(0.2);
    expect(sample.monoFraction, JSON.stringify(result)).toBeLessThan(0.9);
  }
});

test("direct spatial output mirrors left and right inputs", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    await ensureUniversalHrtfProfile();
    const rate = 48000, length = rate / 2;
    const render = async (channel) => {
      const context = new OfflineAudioContext(2, length, rate);
      const input = context.createBuffer(2, length, rate);
      input.getChannelData(channel)[128] = 0.1;
      state.analysis = {mix: {peakDb: -20, rmsDb: -40}, stereoImage: {width: 1}};
      state.stemBuffers = null; state.spatialOutputCalibration = null; state.measuredBrirBuffer = null;
      const graph = createSpatialPlaybackGraph(context, input, state.analysis);
      graph.spatialLayer.wetMaster.gain.value = 0;
      graph.spatialLayer.lateEnvelopment.send.gain.value = 0;
      startGraphSources(graph, 0);
      const audio = await context.startRendering();
      disconnectGraph(graph);
      return audio;
    };
    const leftInput = await render(0), rightInput = await render(1);
    let difference = 0, power = 0, ipsilateral = 0, contralateral = 0;
    for (let channel = 0; channel < 2; channel++) {
      const a = leftInput.getChannelData(channel), b = rightInput.getChannelData(1 - channel);
      for (let i = 0; i < length; i++) { difference += (a[i] - b[i]) ** 2; power += a[i] ** 2; }
    }
    for (let i = 0; i < length; i++) {
      ipsilateral += leftInput.getChannelData(0)[i] ** 2;
      contralateral += leftInput.getChannelData(1)[i] ** 2;
    }
    return {relativeError: Math.sqrt(difference / power), ipsilateral, contralateral};
  });
  expect(result.relativeError, JSON.stringify(result)).toBeLessThan(0.001);
  expect(result.ipsilateral, JSON.stringify(result)).toBeGreaterThan(result.contralateral);
});

test("surround reflections remain audible and binaurally distinct at common sample rates", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  const results = await page.evaluate(async () => {
    await ensureUniversalHrtfProfile();
    const results = [];
    for (const rate of [44100, 96000]) {
      const context = new OfflineAudioContext(2, rate, rate);
      const input = context.createBuffer(2, rate / 4, rate);
      for (let channel = 0; channel < 2; channel++) input.getChannelData(channel)[128] = 0.1;
      state.analysis = {mix: {peakDb: -20, rmsDb: -40}, stereoImage: {width: 0}};
      state.stemBuffers = {other: {id: "other", buffer: input, separation: 1}};
      state.spatialOutputCalibration = null;
      state.measuredBrirBuffer = null;
      const graph = createSpatialPlaybackGraph(context, input, state.analysis);
      startGraphSources(graph, 0);
      const rendered = await context.startRendering();
      const left = rendered.getChannelData(0), right = rendered.getChannelData(1);
      let early = 0, late = 0, mid = 0, side = 0, leftEnergy = 0, rightEnergy = 0;
      for (let i = 0; i < rate; i++) {
        const power = left[i] ** 2 + right[i] ** 2;
        leftEnergy += left[i] ** 2; rightEnergy += right[i] ** 2;
        if (i < rate * 0.08) early += power;
        else { late += power; mid += (left[i] + right[i]) ** 2; side += (left[i] - right[i]) ** 2; }
      }
      results.push({rate, lateDb: 10 * Math.log10(late / early), monoFraction: mid / (mid + side),
        balanceDb: 10 * Math.log10(leftEnergy / rightEnergy)});
      disconnectGraph(graph);
    }
    return results;
  });
  for (const result of results) {
    expect(result.lateDb, JSON.stringify(result)).toBeGreaterThan(-8);
    expect(result.lateDb, JSON.stringify(result)).toBeLessThan(0);
    expect(result.monoFraction, JSON.stringify(result)).toBeGreaterThan(0.2);
    expect(result.monoFraction, JSON.stringify(result)).toBeLessThan(0.8);
    expect(Math.abs(result.balanceDb), JSON.stringify(result)).toBeLessThan(1);
  }
});

test("renders directional direct sound and an audible independent surround tail", async ({ page }, testInfo) => {
  await page.goto("/");
  const measurements = await page.evaluate(async () => {
    await ensureUniversalHrtfProfile();
    const sampleRate = 48000;
    const context = new OfflineAudioContext(2, sampleRate, sampleRate);
    const buffer = context.createBuffer(2, sampleRate / 4, sampleRate);
    buffer.getChannelData(0)[256] = 0.1;
    buffer.getChannelData(1)[256] = 0.1;
    state.analysis = { mix: { peakDb: -20, rmsDb: -40 }, stereoImage: { width: 0 } };
    state.stemBuffers = { other: { id: "other", buffer, separation: 1, spatialWeight: 1 } };
    state.spatialOutputCalibration = null;
    const graph = createSpatialPlaybackGraph(context, buffer, state.analysis);
    startGraphSources(graph, 0);
    const rendered = await context.startRendering();
    const quality = window.SpatialAudioQuality.analyzeBinauralResponse(rendered);
    let early = 0, late = 0, lateMid = 0, lateSide = 0, directDifference = 0;
    const left = rendered.getChannelData(0), right = rendered.getChannelData(1);
    for (let index = 0; index < rendered.length; index += 1) {
      const power = left[index] ** 2 + right[index] ** 2;
      if (index < sampleRate * 0.08) {
        early += power;
        directDifference += (left[index] - buffer.getChannelData(0)[index % buffer.length]) ** 2;
      } else {
        late += power;
        lateMid += ((left[index] + right[index]) / 2) ** 2;
        lateSide += ((left[index] - right[index]) / 2) ** 2;
      }
    }
    const scene = graph.spatialLayer;
    const result = { quality, early, late, trim: graph.calibratedOutputGain,
      mixture: scene.mixtureProfile,
      ir: scene.stemObjects[0].primaryPaths.map((path) => [0, 1].map((ear) =>
        path.renderer.buffer.getChannelData(ear).reduce((sum, sample) => sum + sample * sample, 0))),
      lateToEarlyDb: 10 * Math.log10(late / early),
      lateMonoFraction: lateMid / (lateMid + lateSide), directDifference,
      directModes: scene.stemObjects.flatMap((stem) => stem.primaryPaths.map((path) => path.rendererMode)),
      directions: scene.lateEnvelopment.taps.map((tap) => tap.direction),
      independent: scene.lateEnvelopment.independentDirections };
    disconnectGraph(graph);
    return result;
  });
  const reportPath = testInfo.outputPath("envelopment.json");
  fs.writeFileSync(reportPath, JSON.stringify(measurements, null, 2));
  await testInfo.attach("envelopment.json", { path: reportPath, contentType: "application/json" });
  expect(measurements.directModes).toEqual(["program-matched-binaural", "program-matched-binaural"]);
  expect(measurements.directDifference).toBeGreaterThan(0.001);
  expect(measurements.independent).toBe(true);
  expect(measurements.lateToEarlyDb).toBeGreaterThan(-4.3);
  expect(measurements.lateToEarlyDb).toBeLessThan(-3);
  expect(measurements.quality.iaccLate).toBeLessThan(0.65);
  // A perfect opposite-polarity widener has zero mono energy; this field must not.
  expect(measurements.lateMonoFraction).toBeGreaterThan(0.2);
  expect(measurements.lateMonoFraction).toBeLessThan(0.8);
  expect(measurements.directions.some((direction) => direction.azimuth < -90)).toBe(true);
  expect(measurements.directions.some((direction) => direction.azimuth > 90)).toBe(true);
  expect(measurements.directions.some((direction) => direction.elevation > 50)).toBe(true);
});

test("independent surround field bridges early and late reflections", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    await ensureUniversalHrtfProfile();
    const rate = 48000, context = new OfflineAudioContext(2, rate, rate);
    const input = context.createBuffer(2, rate / 4, rate);
    state.analysis = {mix: {peakDb: -20, rmsDb: -40}, stereoImage: {width: 0}};
    state.stemBuffers = {other: {id: "other", buffer: input, separation: 1}};
    const graph = createSpatialPlaybackGraph(context, input, state.analysis);
    return graph.spatialLayer.lateEnvelopment.renderers.map((node) => {
      const energy = [0, 0, 0, 0];
      for (let channel = 0; channel < 2; channel++) {
        const impulse = node.buffer.getChannelData(channel);
        for (let i = 0; i < impulse.length; i++) {
          const time = i / rate;
          energy[time < .05 ? 0 : time < .08 ? 1 : time < .12 ? 2 : 3] += impulse[i] ** 2;
        }
      }
      return energy;
    });
  });
  for (const energy of result) {
    expect(energy[0]).toBe(0);
    expect(energy[1]).toBeGreaterThan(0.05);
    expect(energy[2]).toBeGreaterThan(0.05);
    expect(energy[3]).toBeGreaterThan(0.1);
  }
});

test("dense vocal mixes keep a stronger surround field without altering the first arrival", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    await ensureUniversalHrtfProfile();
    const rate = 48000;
    const analysis = {activeIds: ["vocals", "drums", "bass", "other"],
      sections: [{density: 1}], mix: {peakDb: -20, rmsDb: -40, crestDb: 8}, stereoImage: {width: 0}};
    const previousScale = 0.85 + (1 / 15) * 0.15 - 0.25 - 0.1;
    const currentScale = window.SpatialAudioRenderer.getReverbScale(analysis);
    const render = async (scale) => {
      const context = new OfflineAudioContext(2, rate, rate);
      const source = context.createBuffer(2, rate / 4, rate);
      for (let channel = 0; channel < 2; channel++) source.getChannelData(channel)[256] = 0.1;
      state.analysis = analysis;
      state.spatialOutputCalibration = null;
      state.stemBuffers = {vocals: {id: "vocals", buffer: source, separation: 1}};
      const graph = createSpatialPlaybackGraph(context, source, analysis);
      graph.spatialLayer.lateEnvelopment.send.gain.value *= scale / currentScale;
      startGraphSources(graph, 0);
      const output = await context.startRendering();
      disconnectGraph(graph);
      return output;
    };
    const before = await render(previousScale), after = await render(currentScale);
    let beforeLate = 0, afterLate = 0, earlyDifference = 0, peak = 0;
    for (let channel = 0; channel < 2; channel++) {
      const a = before.getChannelData(channel), b = after.getChannelData(channel);
      for (let i = 0; i < rate; i++) {
        if (i < 0.05 * rate) earlyDifference = Math.max(earlyDifference, Math.abs(a[i] - b[i]));
        else { beforeLate += a[i] ** 2; afterLate += b[i] ** 2; }
        peak = Math.max(peak, Math.abs(b[i]));
      }
    }
    return {previousScale, currentScale, beforeLate, afterLate, earlyDifference, peak};
  });
  expect(result.currentScale).toBeGreaterThan(result.previousScale);
  expect(result.afterLate / result.beforeLate).toBeGreaterThan(1.15);
  expect(result.earlyDifference).toBeLessThan(1e-6);
  expect(result.peak).toBeLessThan(1);
});

test("offline renders omit display meters while preserving audio samples", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    await ensureUniversalHrtfProfile();
    const rate = 48000, length = rate * 2;
    const make = new OfflineAudioContext(2, 1, rate);
    const input = make.createBuffer(2, length, rate);
    for (let c = 0; c < 2; c++) {
      const data = input.getChannelData(c);
      for (let i = 0; i < length; i++) data[i] = 0.1 * Math.sin(i * 0.037 + c * 0.5);
    }
    state.analysis = {mix: {peakDb: -20, rmsDb: -24}, stereoImage: {width: 0.4}};
    state.spatialOutputCalibration = null;
    state.stemBuffers = {other: {id: "other", buffer: input, separation: 1}};
    const run = async (visualMeters) => {
      const context = new OfflineAudioContext(2, length, rate);
      const graph = createSpatialPlaybackGraph(context, input, state.analysis, {visualMeters});
      const counts = {nodes: graph.nodes.length, stems: Object.keys(graph.stemAnalysisMeters.byId).length,
        analyser: Boolean(graph.analyser)};
      startGraphSources(graph, 0);
      const audio = await context.startRendering();
      disconnectGraph(graph);
      return {audio, counts};
    };
    const live = await run(true), offline = await run(false);
    let maxDifference = 0;
    for (let c = 0; c < 2; c++) {
      const a = live.audio.getChannelData(c), b = offline.audio.getChannelData(c);
      for (let i = 0; i < length; i++) maxDifference = Math.max(maxDifference, Math.abs(a[i] - b[i]));
    }
    return {maxDifference, live: live.counts, offline: offline.counts};
  });
  expect(result.maxDifference).toBeLessThan(1e-6);
  expect(result.live.analyser).toBe(true);
  expect(result.live.stems).toBe(1);
  expect(result.offline.analyser).toBe(false);
  expect(result.offline.stems).toBe(0);
  expect(result.offline.nodes).toBe(result.live.nodes - 4);
});

test("playback and offline graphs reuse mix checks and reset per track", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    await ensureUniversalHrtfProfile();
    const rate = 48000, length = rate;
    const factory = new OfflineAudioContext(2, 1, rate);
    const source = factory.createBuffer(2, length, rate);
    for (let c = 0; c < 2; c++) {
      const data = source.getChannelData(c);
      for (let i = 0; i < length; i++) data[i] = .08 * Math.sin(i * .04 + c);
    }
    state.analysis = {mix: {peakDb: -20, rmsDb: -24}, stereoImage: {width: .3}};
    state.audioBuffer = source;
    state.stemBuffers = {other: {id: "other", buffer: source, separation: 1}};
    const firstGraph = createSpatialPlaybackGraph(new OfflineAudioContext(2, length, rate), source, state.analysis);
    const first = firstGraph.spatialLayer.mixtureProfile;
    const secondGraph = createSpatialPlaybackGraph(new OfflineAudioContext(2, length, rate), source, state.analysis, {visualMeters: false});
    const reused = first === secondGraph.spatialLayer.mixtureProfile && state.mixtureProfileMemo.result === first;
    disconnectGraph(firstGraph); disconnectGraph(secondGraph);
    const memo = state.mixtureProfileMemo;
    resetTrackAnalysis();
    return {reused, reset: state.mixtureProfileMemo !== memo && !state.mixtureProfileMemo.result};
  });
  expect(result).toEqual({reused: true, reset: true});
});

test("flat tone bypass preserves audio and tone impulses reuse only matching curves", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    await ensureUniversalHrtfProfile();
    const rate = 48000, length = rate;
    const sourceContext = new OfflineAudioContext(2, 1, rate);
    const input = sourceContext.createBuffer(2, length, rate);
    for (let c = 0; c < 2; c++) {
      const channel = input.getChannelData(c);
      for (let i = 0; i < length; i++) channel[i] = .08 * Math.sin(i * .06 + c * .4);
    }
    const scene = window.SpatialAudioBinauralScene;
    const curve = [{frequency: 100, logGain: 0.1}, {frequency: 2000, logGain: -0.2}];
    const first = scene.buildToneCorrectionImpulse(sourceContext, curve);
    const same = scene.buildToneCorrectionImpulse(new OfflineAudioContext(2, 1, rate), curve);
    const different = scene.buildToneCorrectionImpulse(sourceContext, [{frequency: 100, logGain: 0.2}]);
    const anotherRate = scene.buildToneCorrectionImpulse(new OfflineAudioContext(2, 1, 44100), curve);
    state.analysis = {mix: {peakDb: -20, rmsDb: -24}, stereoImage: {width: .4}};
    state.stemBuffers = null;
    const render = async (toneCurve) => {
      state.spatialOutputCalibration = {gain: 1, toneCurve};
      const context = new OfflineAudioContext(2, length, rate);
      const graph = createSpatialPlaybackGraph(context, input, state.analysis, {visualMeters: false});
      startGraphSources(graph, 0);
      const audio = await context.startRendering();
      disconnectGraph(graph);
      return audio;
    };
    const bypass = await render([]), flat = await render([{frequency: 100, logGain: 0}]);
    let maxDifference = 0;
    for (let c = 0; c < 2; c++) {
      const a = bypass.getChannelData(c), b = flat.getChannelData(c);
      for (let i = 0; i < length; i++) maxDifference = Math.max(maxDifference, Math.abs(a[i] - b[i]));
    }
    return {same: first === same, different: first !== different, anotherRate: first !== anotherRate, maxDifference};
  });
  expect(result.same).toBe(true);
  expect(result.different).toBe(true);
  expect(result.anotherRate).toBe(true);
  expect(result.maxDifference).toBeLessThan(1e-6);
});

test("preserves both stereo channels through ear-specific direct paths", async ({ page }) => {
  await page.goto("/");
  const measurements = await page.evaluate(async () => {
    await ensureUniversalHrtfProfile();
    const results = [];
    for (const sourceChannel of [0, 1]) {
      const sampleRate = 48000;
      const context = new OfflineAudioContext(2, sampleRate / 4, sampleRate);
      const buffer = context.createBuffer(2, sampleRate / 4, sampleRate);
      buffer.getChannelData(sourceChannel)[256] = 0.1;
      const source = context.createBufferSource();
      source.buffer = buffer;
      const primary = audioRenderer.createBinauralPrimaryLayer(context, source, context.destination, buffer, 1, "other");
      source.start();
      const rendered = await context.startRendering();
      const energy = [0, 1].map((ear) => rendered.getChannelData(ear).reduce((sum, value) => sum + value ** 2, 0));
      results.push({ sourceChannel, energy, position: primary.position });
      primary.nodes.forEach((node) => node.disconnect());
    }
    return results;
  });
  for (const result of measurements) {
    const near = result.energy[result.sourceChannel], far = result.energy[1 - result.sourceChannel];
    expect(far).toBeGreaterThan(0.00001);
    expect(near / far).toBeGreaterThan(1.2);
  }
  expect(measurements[0].position.azimuth).toBe(0);
  expect(measurements[1].position.azimuth).toBe(0);
});
