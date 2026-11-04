const { test, expect } = require("@playwright/test");
const fs = require("node:fs");

test("asynchronous stem alignment preserves results and yields for cancellation", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const length = 48000, lag = 7, context = new OfflineAudioContext(2, length, 48000);
    const reference = context.createBuffer(2, length, 48000), stem = context.createBuffer(2, length, 48000);
    let seed = 1;
    for (let channel = 0; channel < 2; channel++) for (let i = 0; i < length - lag; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const sample = (seed / 2 ** 32 - 0.5) * 0.5;
      reference.getChannelData(channel)[i] = sample;
      stem.getChannelData(channel)[i + lag] = sample;
    }
    const stems = {stem: {buffer: stem}};
    const expected = estimateStemSetAlignment(reference, stems);
    let yielded = false; setTimeout(() => { yielded = true; }, 0);
    const actual = await estimateStemSetAlignmentAsync(reference, stems);
    const controller = new AbortController(); setTimeout(() => controller.abort(), 0);
    let aborted = false;
    try { await estimateStemSetAlignmentAsync(reference, stems, controller.signal); }
    catch (error) { aborted = error.name === "AbortError"; }
    return {expected, actual, yielded, aborted};
  });
  expect(result.actual).toEqual(result.expected);
  expect(result.actual.lagSamples).toBe(7);
  expect(result.yielded).toBe(true);
  expect(result.aborted).toBe(true);
});

test("mono reference rejects stereo stems dominated by unrelated side energy", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(() => {
    const length = 8192, lag = 7, context = new OfflineAudioContext(2, length, 48000);
    const reference = context.createBuffer(1, length, 48000), stem = context.createBuffer(2, length, 48000);
    let seed = 1;
    for (let i = 0; i < length - lag; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const center = (seed / 2 ** 32 - 0.5) * 0.05;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const side = (seed / 2 ** 32 - 0.5) * 0.8;
      reference.getChannelData(0)[i] = center;
      stem.getChannelData(0)[i + lag] = center + side;
      stem.getChannelData(1)[i + lag] = center - side;
    }
    return estimateStemSetAlignment(reference, {stem: {buffer: stem}});
  });
  expect(result.reliable).toBe(false);
  expect(result.correlation).toBeLessThan(0.12);
});

test("silent alignment exits without scanning stem channels", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(() => {
    const length = 480000, data = new Float32Array(length);
    let reads = 0;
    const reference = { length, numberOfChannels: 1, getChannelData: () => data };
    const stem = { length, numberOfChannels: 1, getChannelData: () => { reads++; return data; } };
    return { profile: estimateStemSetAlignment(reference, { stem: { buffer: stem } }), reads };
  });
  expect(result.profile.reliable).toBe(false);
  expect(result.profile.lagSamples).toBe(0);
  expect(result.reads).toBe(0);
});

test("stem alignment finds a short signal between distributed windows", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(() => {
    const length = 480000, lag = 7;
    const context = new OfflineAudioContext(1, length, 48000);
    const reference = context.createBuffer(1, length, 48000);
    const stem = context.createBuffer(1, length, 48000);
    const r = reference.getChannelData(0), s = stem.getChannelData(0);
    let seed = 1;
    for (let i = 20000; i < 20512; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      r[i] = (seed / 2 ** 32 - 0.5) * 0.5;
      s[i + lag] = r[i];
    }
    return estimateStemSetAlignment(reference, { stem: { buffer: stem } });
  });
  expect(result.reliable).toBe(true);
  expect(result.lagSamples).toBe(7);
  expect(result.correlation).toBeGreaterThan(0.999);
});

test("stem alignment measures high frequencies without periodic sampling aliases", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(() => {
    const length = 144257, lag = 1;
    const context = new OfflineAudioContext(1, length, 48000);
    const reference = context.createBuffer(1, length, 48000);
    const stem = context.createBuffer(1, length, 48000);
    const r = reference.getChannelData(0), s = stem.getChannelData(0);
    for (let i = 0; i < length - lag; i++) {
      r[i] = Math.sin(2 * Math.PI * (i - 128) / 6) * 0.5;
      s[i + lag] = r[i];
    }
    return estimateStemSetAlignment(reference, { stem: { buffer: stem } });
  });
  expect(result.reliable).toBe(true);
  expect(result.lagSamples).toBe(1);
  expect(result.correlation).toBeGreaterThan(0.999);
});

test("stem alignment detects a delayed anti-phase stereo signal", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(() => {
    const length = 8192, lag = 7;
    const context = new OfflineAudioContext(2, length, 48000);
    const reference = context.createBuffer(2, length, 48000);
    const stem = context.createBuffer(2, length, 48000);
    let seed = 1;
    for (let i = 0; i < length - lag; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const sample = (seed / 2 ** 32 - 0.5) * 0.5;
      reference.getChannelData(0)[i] = sample;
      reference.getChannelData(1)[i] = -sample;
      stem.getChannelData(0)[i + lag] = sample;
      stem.getChannelData(1)[i + lag] = -sample;
    }
    const silent = context.createBuffer(2, length, 48000);
    return { aligned: estimateStemSetAlignment(reference, { stem: { buffer: stem } }),
      silent: estimateStemSetAlignment(silent, { stem: { buffer: silent } }) };
  });
  expect(result.aligned.lagSamples).toBe(7);
  expect(result.aligned.correlation).toBeGreaterThan(0.999);
  expect(result.aligned.reliable).toBe(true);
  expect(result.silent.reliable).toBe(false);
});

test("aligned stems cancel their reference at the beginning and after seeking", async ({ page }) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const rate = 48000, length = rate, lagFrames = 480;
    const results = [];
    for (const lag of [-lagFrames, lagFrames]) {
      for (const offset of [0, 0.02]) {
        const context = new OfflineAudioContext(1, 4800, rate);
        const reference = context.createBuffer(1, length, rate);
        const stem = context.createBuffer(1, length, rate);
        const ref = reference.getChannelData(0), data = stem.getChannelData(0);
        for (let i = 0; i < length; i++) {
          if (i + lag < 0 || i + lag >= length) continue;
          ref[i] = 0.3 * Math.sin(i * 0.117) + 0.1 * Math.sin(i * 0.031);
          data[i + lag] = ref[i];
        }
        const original = context.createBufferSource(), aligned = context.createBufferSource();
        original.buffer = reference; aligned.buffer = stem;
        aligned.spatialAlignmentOffsetSeconds = lag / rate;
        const invert = context.createGain(); invert.gain.value = -1;
        original.connect(context.destination); aligned.connect(invert).connect(context.destination);
        startGraphSources({ sources: [original, aligned] }, offset);
        const output = (await context.startRendering()).getChannelData(0);
        let peak = 0;
        for (const sample of output) peak = Math.max(peak, Math.abs(sample));
        results.push({ lag, offset, peak });
      }
    }
    return results;
  });
  for (const result of results) expect(result.peak, JSON.stringify(result)).toBeLessThan(1e-6);
});

test("keeps the same direct waveform when separation leakage changes", async ({ page }, testInfo) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    await ensureUniversalHrtfProfile();
    const sampleRate = 48000, length = sampleRate * 3;
    const storage = new OfflineAudioContext(2, length, sampleRate);
    const reference = storage.createBuffer(2, length, sampleRate);
    for (let channel = 0; channel < 2; channel += 1) for (let index = 0; index < length; index += 1) {
      const time = index / sampleRate;
      reference.getChannelData(channel)[index] = 0.045 * Math.sin(2 * Math.PI * 192 * time) +
        0.025 * Math.sin(2 * Math.PI * 576 * time) +
        (channel ? -1 : 1) * 0.012 * Math.sin(2 * Math.PI * 1536 * time);
    }
    state.analysis = { mix: { peakDb: -18, rmsDb: -28 }, stereoImage: { width: 0.25 } };
    state.spatialOutputCalibration = null;
    const render = async (movingLeakage) => {
      const context = new OfflineAudioContext(2, length, sampleRate);
      const vocals = context.createBuffer(2, length, sampleRate), other = context.createBuffer(2, length, sampleRate);
      for (let channel = 0; channel < 2; channel += 1) for (let index = 0; index < length; index += 1) {
        const ratio = movingLeakage ? 0.5 + 0.38 * Math.sin(2 * Math.PI * index / sampleRate) : 0.5;
        const value = reference.getChannelData(channel)[index];
        vocals.getChannelData(channel)[index] = value * ratio;
        other.getChannelData(channel)[index] = value * (1 - ratio) * 0.93;
      }
      state.stemBuffers = { vocals: { id: "vocals", buffer: vocals, separation: 1 },
        other: { id: "other", buffer: other, separation: 1 } };
      const graph = createSpatialPlaybackGraph(context, reference, state.analysis);
      graph.spatialLayer.wetMaster.gain.value = 0;
      graph.spatialLayer.lateEnvelopment.send.gain.value = 0;
      startGraphSources(graph, 0);
      const rendered = await context.startRendering();
      disconnectGraph(graph);
      return rendered;
    };
    const a = await render(false), b = await render(true);
    let error = 0, power = 0;
    for (let channel = 0; channel < 2; channel += 1) for (let index = 1024; index < length; index += 1) {
      const x = a.getChannelData(channel)[index], y = b.getChannelData(channel)[index];
      error += (x - y) ** 2;
      power += x * x;
    }
    return { relativeError: Math.sqrt(error / power) };
  });
  const reportPath = testInfo.outputPath("phase-stability.json");
  fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
  await testInfo.attach("phase-stability.json", { path: reportPath, contentType: "application/json" });
  expect(result.relativeError).toBeLessThan(0.00001);
});

test("keeps centered vocals coherent and unaffected by transient-map automation", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    await ensureUniversalHrtfProfile();
    const sampleRate = 48000, length = sampleRate * 2;
    const context = new OfflineAudioContext(2, length, sampleRate);
    const reference = context.createBuffer(2, length, sampleRate);
    for (let channel = 0; channel < 2; channel += 1) for (let index = 0; index < length; index += 1) {
      const time = index / sampleRate;
      reference.getChannelData(channel)[index] = 0.05 * Math.sin(2 * Math.PI * 192 * time) +
        0.025 * Math.sin(2 * Math.PI * 768 * time) * (0.5 + 0.5 * Math.sin(2 * Math.PI * time));
    }
    state.analysis = { mix: { peakDb: -18, rmsDb: -28 }, stereoImage: { width: 0 } };
    state.spatialOutputCalibration = null;
    state.stemBuffers = { vocals: { id: "vocals", buffer: reference, separation: 1 } };
    const render = async (events, isolated) => {
      state.transientMaps = { vocals: { events } };
      const offline = new OfflineAudioContext(2, length, sampleRate);
      const graph = createSpatialPlaybackGraph(offline, reference, state.analysis);
      if (isolated) {
        graph.spatialLayer.wetMaster.gain.value = 0;
        graph.spatialLayer.lateEnvelopment.send.gain.value = 0;
      }
      startGraphSources(graph, 0);
      const rendered = await offline.startRendering();
      const controls = graph.spatialLayer.transientControls.length;
      const convolverCount = graph.spatialLayer.sharedPrimary.primaryPaths.length;
      disconnectGraph(graph);
      return { rendered, controls, convolverCount };
    };
    const baseline = await render([], false);
    const mapped = await render(Array.from({ length: 16 }, (_, index) => ({ time: index / 8, strength: 1 })), false);
    const direct = await render([], true);
    let automationError = 0, centerError = 0;
    for (let index = 0; index < length; index += 1) {
      centerError = Math.max(centerError, Math.abs(direct.rendered.getChannelData(0)[index] - direct.rendered.getChannelData(1)[index]));
      for (let channel = 0; channel < 2; channel += 1) automationError = Math.max(automationError,
        Math.abs(baseline.rendered.getChannelData(channel)[index] - mapped.rendered.getChannelData(channel)[index]));
    }
    return { automationError, centerError, controls: mapped.controls, primaryRenderers: mapped.convolverCount };
  });
  expect(result.automationError).toBeLessThan(0.0000001);
  expect(result.centerError).toBeLessThan(0.0000001);
  expect(result.controls).toBe(0);
  expect(result.primaryRenderers).toBe(2);
});
