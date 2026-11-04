const fs = require("node:fs");
const { test, expect } = require("@playwright/test");
const spatialRendererGolden = JSON.parse(fs.readFileSync("tests/golden/spatial_renderer_ranges_v2.json", "utf8"));

test("loads the studio shell without console errors", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "파일을 선택하세요" })).toBeVisible();
  await expect(page.locator("#drop-zone #track-name")).toBeVisible();
  await expect(page.locator(".transport-panel #track-name")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Full Spatial" })).toHaveClass(/is-active/);
  await expect(page.getByRole("button", { name: "Hybrid" })).toHaveCount(0);
  await expect(page.locator("#spatial-engine-mode")).toHaveCount(0);
  await expect(page.locator("#spatial-engine-status")).toHaveCount(0);
  await expect(page.locator(".spatial-engine-flags")).toHaveCount(0);
  await expect(page.locator("#perf-toggle")).toHaveCount(0);
  await expect(page.getByText("Demucs model")).toHaveCount(0);
  await expect(page.getByText("Room IR")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Front Stage" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Concert Hall" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open Field" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Intimate" })).toHaveCount(0);
  await expect(page.locator("#concert-hall-toggle")).toHaveCount(0);
  await expect(page.locator("#waveform-canvas")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "오디오 분석 필드" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Stem 반응 바" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "스펙트럼 밴드" })).toBeVisible();
  await expect(page.locator("#spectrum-scene")).toBeVisible();
  await expect(page.locator("#spectrum-canvas")).toBeVisible();

  expect(errors()).toEqual([]);
});

test("keeps the transport seek bar fully visible beside export", async ({ page }) => {
  await page.goto("/");
  const layout = await page.evaluate(() => {
    const row = document.querySelector(".transport-row").getBoundingClientRect();
    const exportButton = document.querySelector("#export-button").getBoundingClientRect();
    const seek = document.querySelector(".seek-block").getBoundingClientRect();
    const slider = document.querySelector("#seek-slider").getBoundingClientRect();
    return {
      row: { left: row.left, right: row.right, top: row.top, bottom: row.bottom },
      exportRight: exportButton.right,
      seek: { left: seek.left, right: seek.right, top: seek.top, bottom: seek.bottom, width: seek.width },
      slider: { top: slider.top, bottom: slider.bottom, width: slider.width }
    };
  });
  expect(layout.seek.left).toBeGreaterThanOrEqual(layout.exportRight + 8);
  expect(layout.seek.width).toBeGreaterThan(180);
  expect(layout.slider.width).toBeGreaterThan(180);
  expect(layout.slider.top).toBeGreaterThanOrEqual(layout.row.top);
  expect(layout.slider.bottom).toBeLessThanOrEqual(layout.row.bottom);
  expect(layout.seek.right).toBeLessThanOrEqual(layout.row.right + 1);
});

test("removes playback-device controls and ignores previous device preferences", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("spatial-audio-essential-playback-device", "sennheiser-ie600"));
  const requestedScripts = [];
  page.on("request", (request) => { if (request.resourceType() === "script") requestedScripts.push(request.url()); });
  await page.goto("/");
  await expect(page.locator("#playback-device-control, #playback-device-select, .spatial-engine-module")).toHaveCount(0);
  expect(await page.evaluate(() => ({ registry: typeof window.SpatialAudioDeviceProfiles,
    correction: typeof createDeviceCorrectionChain, profileState: "playbackDeviceProfileId" in state })))
    .toEqual({ registry: "undefined", correction: "undefined", profileState: false });
  expect(requestedScripts.some((url) => url.includes("device-profiles.js"))).toBe(false);
});

test("level-matches Full Spatial to the Original window", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chrome", "The deterministic loudness render is covered once on the Chrome reference engine.");
  await page.goto("/");
  const results = await page.evaluate(async () => {
    await ensureUniversalHrtfProfile();
    const sampleRate = 48000;
    const duration = 0.6;
    const sourceContext = new OfflineAudioContext(2, Math.round(sampleRate * duration), sampleRate);
    const buffer = sourceContext.createBuffer(2, Math.round(sampleRate * duration), sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let index = 0; index < data.length; index += 1) {
        const time = index / sampleRate;
        data[index] =
          Math.sin(2 * Math.PI * (channel ? 293 : 220) * time) * 0.2 +
          Math.sin(2 * Math.PI * 1900 * time + channel * 0.3) * 0.045;
      }
    }
    const analysis = {
      mix: { peakDb: -11, rmsDb: -16.8, approxLufs: -17.5, estimatedTruePeakDb: -10.8 },
      stereoImage: { width: 0.4, correlation: 0.25 },
      waveform: [0.7, 0.8, 0.75]
    };
    const previous = {
      analysis: state.analysis,
      calibration: state.playbackCalibration,
      outputCalibration: state.spatialOutputCalibration,
      stems: state.stemBuffers,
      brir: state.measuredBrirBuffer,
      settings: state.spatialSettings
    };
    state.analysis = analysis;
    state.playbackCalibration = analyzeAudioBufferCalibration(buffer, analysis);
    state.stemBuffers = null;
    state.measuredBrirBuffer = null;
    state.spatialSettings = { wet: 0.72, radius: 1.12, reflections: 0.58 };
    const reference = getAudioBufferWindowStats(buffer, 0, duration);
    const rows = [];
    for (const id of ["spatial"]) {
      state.spatialOutputCalibration = null;
      const calibration = await calibrateSpatialProcessedOutput(buffer, analysis);
      state.spatialOutputCalibration = calibration;
      const context = new OfflineAudioContext(2, buffer.length, sampleRate);
      const graph = createSpatialPlaybackGraph(context, buffer, analysis);
      startGraphSources(graph, 0, () => {});
      const rendered = await context.startRendering();
      const output = getAudioBufferWindowStats(rendered, 0, duration);
      rows.push({
        id,
        errorDb: 20 * Math.log10(output.rms / reference.rms),
        gain: calibration.gain,
        peak: output.peak
      });
      disconnectGraph(graph);
    }
    state.analysis = previous.analysis;
    state.playbackCalibration = previous.calibration;
    state.spatialOutputCalibration = previous.outputCalibration;
    state.stemBuffers = previous.stems;
    state.measuredBrirBuffer = previous.brir;
    state.spatialSettings = previous.settings;
    return rows;
  });
  expect(results.map((row) => row.id)).toEqual(["spatial"]);
  for (const row of results) {
    expect(Math.abs(row.errorDb), `${row.id} level error ${JSON.stringify(row)}`).toBeLessThan(0.1);
    expect(row.gain).toBeGreaterThanOrEqual(0.5);
    expect(row.gain).toBeLessThanOrEqual(4.5);
    expect(row.peak).toBeLessThan(1);
  }
});

test("calibrates representative song windows and limits only spatial buses on QA failure", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(() => {
    const analysis = {
      waveform: [0.1, 0.9, 0.2, 0.55, 0.3, 0.7],
      sections: [
        { start: 0, end: 20, energy: 0.2, density: 0.15, brightness: 0.3 },
        { start: 20, end: 50, energy: 0.95, density: 0.45, brightness: 0.4 },
        { start: 50, end: 90, energy: 0.6, density: 0.92, brightness: 0.8 },
        { start: 90, end: 120, energy: 0.5, density: 0.35, brightness: 0.98 }
      ]
    };
    const offsets = getSpatialCalibrationOffsets(analysis, 120, 2, 4);
    const safe = deriveSpatialQaBusLimits([{
      balanceDeltaDb: 0.1,
      stereoCorrelation: 0.15,
      referenceStereoCorrelation: 0.25,
      renderedPeak: 0.8
    }]);
    const limited = deriveSpatialQaBusLimits([{
      balanceDeltaDb: 1.2,
      stereoCorrelation: -0.4,
      referenceStereoCorrelation: 0.2,
      renderedPeak: 1.02
    }]);
    return { offsets, safe, limited };
  });
  expect(result.offsets).toHaveLength(4);
  expect(new Set(result.offsets).size).toBe(4);
  expect(result.safe).toMatchObject({ limited: false, roomScale: 1, lateralScale: 1 });
  expect(result.limited.limited).toBe(true);
  expect(result.limited.roomScale).toBeLessThan(1);
  expect(result.limited.lateralScale).toBeLessThan(1);
  expect(result.limited.reasons).toEqual(expect.arrayContaining(["balance-delta", "phase-spread", "peak-headroom"]));
});

test("fast spatial calibration includes a peak hidden from the mono waveform", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(() => {
    const rate = 8000, length = rate * 20;
    const left = new Float32Array(length), right = new Float32Array(length);
    left[rate * 17] = 0.95;
    right[rate * 17] = -0.95;
    const buffer = {sampleRate: rate, length, numberOfChannels: 2,
      getChannelData: channel => channel ? right : left};
    return getSpatialCalibrationOffsets({waveform: [0.9, 0.1, 0.1, 0.1]}, 20, 2, 2, buffer);
  });
  expect(result).toHaveLength(2);
  expect(result[0]).toBeCloseTo(16, 5);
  expect(result[1]).not.toBe(result[0]);
});

test("clarity target keeps bass and gently lifts presence and air", async ({ page }) => {
  await page.goto("/");
  const values = await page.evaluate(() => Object.fromEntries(
    addSpatialClarityTarget([]).map(point => [point.frequency, point.logGain * 20 / Math.LN10])
  ));
  expect(values[100]).toBeGreaterThan(0.2);
  expect(values[100]).toBeLessThan(0.31);
  expect(values[1000]).toBeLessThan(0.2);
  expect(values[3000]).toBeGreaterThan(0.9);
  expect(values[3000]).toBeLessThan(1.3);
  expect(values[9000]).toBeGreaterThan(0.45);
  expect(values[9000]).toBeLessThan(1);
});

test("concurrent HRTF preparation shares registry and asset requests", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    await ensureUniversalHrtfProfile();
    state.hrtfLibrary = null;
    state.universalHrtfProfile = null;
    state.universalHrtfDataset = null;
    state.universalHrtfStatus = "idle";
    state.universalHrtfPromise = null;
    const originalFetch = window.fetch;
    const counts = {registry: 0, profile: 0, impulse: 0};
    window.fetch = async (...args) => {
      const url = String(args[0]);
      if (url.includes("/hrtf/profiles.json")) {
        counts.registry++;
        await new Promise(resolve => setTimeout(resolve, 40));
      } else if (url.includes("/hrtf/") && url.endsWith(".json")) counts.profile++;
      else if (url.includes("/hrtf/") && url.endsWith(".hrir")) counts.impulse++;
      return originalFetch(...args);
    };
    try {
      const profiles = await Promise.all([
        ensureUniversalHrtfProfile(), ensureUniversalHrtfProfile(), ensureUniversalHrtfProfile()
      ]);
      return {counts, same: profiles.every(profile => profile === profiles[0]),
        ready: state.universalHrtfStatus, promiseCleared: state.universalHrtfPromise === null};
    } finally { window.fetch = originalFetch; }
  });
  expect(result).toEqual({counts: {registry: 1, profile: 1, impulse: 1}, same: true,
    ready: "ready", promiseCleared: true});
});

test("HRTF preparation can retry after registry failure", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    await ensureUniversalHrtfProfile();
    state.hrtfLibrary = null;
    state.universalHrtfProfile = null;
    state.universalHrtfDataset = null;
    state.universalHrtfStatus = "idle";
    const originalFetch = window.fetch;
    window.fetch = (...args) => String(args[0]).includes("/hrtf/profiles.json")
      ? Promise.resolve(new Response("unavailable", {status: 503})) : originalFetch(...args);
    try {
      const failed = await Promise.all([ensureUniversalHrtfProfile(), ensureUniversalHrtfProfile()]);
      const fallback = state.universalHrtfStatus;
      const cleared = state.universalHrtfPromise === null;
      window.fetch = originalFetch;
      const recovered = await ensureUniversalHrtfProfile();
      return {failed: failed.every(value => value === null), fallback, cleared,
        recovered: Boolean(recovered), ready: state.universalHrtfStatus};
    } finally { window.fetch = originalFetch; }
  });
  expect(result).toEqual({failed: true, fallback: "fallback", cleared: true, recovered: true, ready: "ready"});
});

test("loads the measured HRTF library, resamples it, and keeps the fallback symmetric", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const library = await ensureHrtfLibrary();
    const rows = [];
    let fallbackSwapError = null;
    for (const entry of library.profiles) {
      state.hrtfProfileId = entry.id;
      state.universalHrtfProfile = null;
      state.universalHrtfDataset = null;
      state.universalHrtfStatus = "idle";
      state.hrtfImpulseCache.clear();
      const profile = await ensureUniversalHrtfProfile();
      const context48 = new OfflineAudioContext(2, 1024, 48000);
      const context96 = new OfflineAudioContext(2, 2048, 96000);
      const left = audioRenderer.createUniversalSofaImpulse(
        context48,
        { azimuth: -45, elevation: 20, distance: 1 },
        { role: "direct" }
      );
      const right = audioRenderer.createUniversalSofaImpulse(
        context48,
        { azimuth: 45, elevation: 20, distance: 1 },
        { role: "direct" }
      );
      const upsampled = audioRenderer.createUniversalSofaImpulse(
        context96,
        { azimuth: 25, elevation: 10, distance: 1 },
        { role: "direct" }
      );
      let energy = 0;
      let finite = true;
      for (let channel = 0; channel < 2; channel += 1) {
        const samples = left.getChannelData(channel);
        for (let index = 0; index < samples.length; index += 1) {
          finite = finite && Number.isFinite(samples[index]);
          energy += samples[index] * samples[index];
        }
      }
      if (entry.id === "universal-listener-v1") {
        fallbackSwapError = 0;
        for (let index = 0; index < left.length; index += 1) {
          fallbackSwapError = Math.max(
            fallbackSwapError,
            Math.abs(left.getChannelData(0)[index] - right.getChannelData(1)[index]),
            Math.abs(left.getChannelData(1)[index] - right.getChannelData(0)[index])
          );
        }
      }
      rows.push({
        id: profile.id,
        directions: state.universalHrtfDataset.directionCount,
        finite,
        energy,
        sampleRate48: left.sampleRate,
        length48: left.length,
        sampleRate96: upsampled.sampleRate,
        length96: upsampled.length
      });
    }
    return { defaultId: library.defaultId, rows, fallbackSwapError };
  });
  expect(result.defaultId).toBe("sadie-kemar");
  expect(result.rows.map((row) => row.id)).toEqual([
    "sadie-kemar",
    "sadie-ku100",
    "sadie-human-003",
    "sadie-human-009",
    "universal-listener-v1"
  ]);
  expect(result.rows.map((row) => row.directions)).toEqual([1550, 1550, 170, 170, 144]);
  result.rows.forEach((row) => {
    expect(row.finite).toBe(true);
    expect(row.energy).toBeGreaterThan(1e-6);
    expect(row.sampleRate48).toBe(48000);
    expect(row.length48).toBe(256);
    expect(row.sampleRate96).toBe(96000);
    expect(row.length96).toBe(512);
  });
  expect(result.fallbackSwapError).toBeLessThan(1e-5);
});

test("uses the automatic KEMAR HRTF even when an old manual selection is stored", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("spatial-audio-essential-hrtf-profile", "sadie-human-009");
  });
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => ({
    selected: state.hrtfProfileId,
    loaded: state.universalHrtfProfile?.id || null,
    status: state.universalHrtfStatus
  }))).toEqual({
    selected: "sadie-kemar",
    loaded: "sadie-kemar",
    status: "ready"
  });
});

test("encodes standards-compatible 24-bit stereo WAV output", async ({ page }) => {
  await page.goto("/");
  const header = await page.evaluate(async () => {
    const channels = [new Float32Array([0, 0.5, -0.5]), new Float32Array([0.25, -0.25, 0])];
    const blob = encodeWaveBlob({
      numberOfChannels: 2,
      length: 3,
      sampleRate: 48000,
      getChannelData: channel => channels[channel]
    }, { bitDepth: 24, gain: 1 });
    const bytes = await blob.arrayBuffer();
    const view = new DataView(bytes);
    return {
      riff: String.fromCharCode(...new Uint8Array(bytes, 0, 4)),
      format: view.getUint16(20, true),
      channels: view.getUint16(22, true),
      sampleRate: view.getUint32(24, true),
      bitDepth: view.getUint16(34, true),
      dataBytes: view.getUint32(40, true),
      size: bytes.byteLength
    };
  });
  expect(header).toEqual({ riff: "RIFF", format: 1, channels: 2, sampleRate: 48000, bitDepth: 24, dataBytes: 18, size: 62 });
});

test("float WAV metering preserves overs and PCM export clips only after gain", async ({ page }) => {
  await page.goto("/");
  const values = await page.evaluate(async () => {
    const samples = [new Float32Array([1.5, -1.25, 0.5, NaN])];
    const input = { numberOfChannels: 1, length: 4, sampleRate: 48000, getChannelData: c => samples[c] };
    const floatView = new DataView(await encodeWaveBlob(input, {bitDepth: 32, float: true}).arrayBuffer());
    const pcmView = new DataView(await encodeWaveBlob(input, {bitDepth: 24, gain: 0.5}).arrayBuffer());
    const silentView = new DataView(await encodeWaveBlob(input, {bitDepth: 24, gain: 0}).arrayBuffer());
    return { floatSamples: [0, 1, 2, 3].map(i => floatView.getFloat32(44 + i * 4, true)),
      firstPcm: [0, 1, 2].map(i => pcmView.getUint8(44 + i)),
      silent: [0, 1, 2].map(i => silentView.getUint8(44 + i)) };
  });
  expect(values.floatSamples).toEqual([1.5, -1.25, 0.5, 0]);
  expect(values.firstPcm).toEqual([255, 255, 95]);
  expect(values.silent).toEqual([0, 0, 0]);
});

test("chunked WAV encoding yields and matches the exact synchronous output", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const frames = 150003;
    const channels = [new Float32Array(frames), new Float32Array(frames)];
    for (let i = 0; i < frames; i++) {
      channels[0][i] = Math.sin(i * 0.043) * 1.4;
      channels[1][i] = Math.cos(i * 0.031) * 0.8;
    }
    channels[0][17] = NaN;
    const input = {numberOfChannels: 2, length: frames, sampleRate: 48000, getChannelData: c => channels[c]};
    let timerRan = false;
    const comparisons = [];
    for (const options of [{bitDepth: 32, float: true}, {bitDepth: 24, gain: 0.7}, {bitDepth: 24, gain: 0}]) {
      const expected = new Uint8Array(await encodeWaveBlob(input, options).arrayBuffer());
      if (!comparisons.length) setTimeout(() => { timerRan = true; }, 0);
      const encoded = await encodeWaveBlobAsync(input, options);
      const yieldedDuringEncoding = timerRan;
      const actual = new Uint8Array(await encoded.arrayBuffer());
      if (!comparisons.length && !yieldedDuringEncoding) return {timerRan: false, comparisons: []};
      let equal = actual.length === expected.length;
      for (let i = 0; equal && i < expected.length; i++) equal = actual[i] === expected[i];
      comparisons.push(equal);
    }
    return {timerRan, comparisons};
  });
  expect(result.timerRan).toBe(true);
  expect(result.comparisons).toEqual([true, true, true]);
});

test("WAV export retains the original filename if another track is selected", async ({ page }) => {
  await page.goto("/");
  const downloadPromise = page.waitForEvent("download");
  await page.evaluate(() => {
    const context = new OfflineAudioContext(2, 48000, 48000);
    const buffer = context.createBuffer(2, 48000, 48000);
    for (let c = 0; c < 2; c++) {
      const samples = buffer.getChannelData(c);
      for (let i = 0; i < samples.length; i++) samples[i] = 0.08 * Math.sin(i * 0.05);
    }
    state.file = {name: "first.wav"};
    state.audioBuffer = buffer;
    state.analysis = {mix: {peakDb: -22, rmsDb: -25}, stereoImage: {width: 0}};
    state.stemBuffers = null;
    exportFullSpatialWav();
    state.file = {name: "second.wav"};
  });
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("first - Full Spatial 24bit.wav");
  const bytes = fs.readFileSync(await download.path());
  expect(bytes.readUInt16LE(34)).toBe(24);
  expect(bytes.readUInt16LE(22)).toBe(2);
});

test("server measures unclipped floating-point peaks before export attenuation", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const data = new Float32Array(4800).fill(1.5);
    const input = {numberOfChannels: 1, length: data.length, sampleRate: 48000, getChannelData: () => data};
    const blob = encodeWaveBlob(input, {bitDepth: 32, float: true});
    const response = await fetch("/api/measure-output?filename=peak-test.wav", {
      method: "POST", headers: {"Content-Type": "audio/wav"}, body: blob
    });
    return { status: response.status, measurement: await response.json() };
  });
  expect(result.status).toBe(200);
  expect(result.measurement.samplePeakDb).toBeCloseTo(20 * Math.log10(1.5), 2);
  expect(result.measurement.estimatedTruePeakDb).toBeGreaterThan(3.5);
});

test("exposes production health, security headers, and accessible progress", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  const health = await page.request.get("/api/health");
  expect(health.ok()).toBe(true);
  expect(await health.json()).toMatchObject({
    status: "ok",
    service: "Spatial Audio Essential",
    analysis: { capacity: 1 }
  });
  const headers = health.headers();
  expect(headers["content-security-policy"]).toContain("script-src 'self'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["cache-control"]).toContain("no-store");
  expect(headers["x-request-id"]).toMatch(/^[a-f0-9]{16}$/);

  const brir = await page.request.get("/brir/air_aula_carolina_front_late.wav");
  expect(brir.ok()).toBe(true);
  expect(brir.headers()["content-type"]).toContain("audio");
  expect(brir.headers()["cache-control"]).toContain("immutable");
  expect((await brir.body()).length).toBeGreaterThan(500_000);

  await page.route("**/api/analyze?**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createAnalysisFixture())
    });
  });
  await page.goto("/");
  await expect(page.locator(".skip-link")).toHaveText("메인 작업 영역으로 건너뛰기");
  const filePath = testInfo.outputPath("progress-tone.wav");
  fs.writeFileSync(filePath, createToneWav());
  await page.locator("#audio-file").setInputFiles(filePath);
  await expect(page.locator("#analysis-progress")).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "오디오 분석 진행 단계" })).toHaveAttribute("aria-valuenow", /\d+/);
  await expect(page.locator("#play-button")).toBeEnabled();
  await expect(page.locator("#analysis-phase")).toContainText("완료");
  expect(errors()).toEqual([]);
});

test("keeps only essential controls while toggling theme and rendering mode", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.goto("/");

  await expect(page.locator("#perf-panel, #model-stack, #section-list, #waveform-canvas")).toHaveCount(0);

  await expect(page.locator("#width-slider")).toHaveCount(0);
  await expect(page.locator("#depth-slider")).toHaveCount(0);
  await expect(page.locator("#room-slider")).toHaveCount(0);
  await expect(page.locator("#gain-slider")).toHaveCount(0);
  await expect(page.locator("#remaster-toggle")).toHaveCount(0);
  await expect(page.locator("#remaster-value")).toHaveCount(0);
  await expect(page.locator("#spatial-wet-slider")).toHaveCount(0);
  await expect(page.locator("#spatial-radius-slider")).toHaveCount(0);
  await expect(page.locator("#spatial-reflection-slider")).toHaveCount(0);
  await expect(page.locator("#spatial-wet-value, #spatial-radius-value, #spatial-reflection-value")).toHaveCount(0);

  await page.getByRole("button", { name: "Original" }).click();
  await page.getByRole("button", { name: "Full Spatial" }).click();

  const beforeTheme = await page.locator("html").getAttribute("data-theme");
  await page.locator("#theme-toggle").click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", beforeTheme || "");

  expect(errors()).toEqual([]);
});

test("uses a linear stem bar with a minus 10 dB meter offset", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.goto("/");

  const meter = await page.evaluate(() => ({
    barAt80: studioView.softenStemBarLevel(0.8),
    barAt95: studioView.softenStemBarLevel(0.95),
    shapedAt80: studioView.shapeStemMeterLevel(0.8),
    shiftedScore: studioView.getStemMeterScoreFromDb(-20, -10),
    maximumScore: studioView.getStemMeterScoreFromDb(0, 0)
  }));

  expect(meter.barAt80).toBeCloseTo(0.8, 6);
  expect(meter.barAt95).toBeCloseTo(0.95, 6);
  expect(meter.shapedAt80).toBeCloseTo(0.8, 6);
  expect(meter.shiftedScore).toBeCloseTo(0.6118182, 6);
  expect(meter.maximumScore).toBeCloseTo(1, 6);
  expect(errors()).toEqual([]);
});

test("meters follow display frames and smoothing is refresh-rate independent", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(() => {
    const profile = studioView.getRuntimeQualityProfile();
    const ui = studioView.state;
    let frequencyReads = 0;
    const graph = {
      analyser: {
        getFloatFrequencyData(data) { frequencyReads++; data.fill(-40); },
        getFloatTimeDomainData(data) { data.fill(0); }
      },
      frequencyData: new Float32Array(128), timeData: new Float32Array(256)
    };
    state.audioContext = { sampleRate: 48000 };
    state.playback.graph = graph;
    state.playback.playing = true;
    ui.lastLiveAnalysisFrame = null;
    for (let i = 0; i < 144; i++) {
      const time = i / 144;
      studioView.readLiveSpectrumLevels(time);
      studioView.readMainAnalyserFrame(time, { frequency: false, maxAge: 0 });
    }
    const smooth = (hz) => {
      ui.visualFrameSeconds = 1 / hz;
      const levels = [];
      const input = new Float32Array(128).fill(-40);
      for (let i = 0; i < hz; i++) studioView.buildSpectrumLevels(input, 48000, levels);
      return levels[0];
    };
    const slow = smooth(60), fast = smooth(144);
    state.playback.playing = false;
    return { profile, frequencyReads, slow, fast };
  });
  expect(result.profile.meterInterval).toBe(0);
  expect(result.profile.stemDisplayInterval).toBe(0);
  expect(result.profile.spectrumInterval).toBe(0);
  expect(result.frequencyReads).toBe(144);
  expect(result.slow).toBeCloseTo(result.fast, 5);
});

test("keeps Spatial gain staging in the fidelity-safe range", async ({ page, browserName }) => {
  test.skip(browserName === "webkit", "Windows WebKit does not complete native-HRTF OfflineAudioContext rendering.");
  const errors = collectBrowserErrors(page);
  await page.goto("/");

  const values = await page.evaluate(async () => {
    const settings = { wet: 0.64, radius: 1.04, reflections: 0.4 };
    const analysis = {
      instruments: [],
      activeIds: [],
      mix: { peakDb: -1, rmsDb: -14 },
      stereoImage: { width: 0.36 }
    };
    const sampleRate = 48000;
    const offline = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, sampleRate, sampleRate);
    const brirBytes = await fetch(DEFAULT_MEASURED_BRIR_URL).then((response) => response.arrayBuffer());
    state.measuredBrirBuffer = await offline.decodeAudioData(brirBytes.slice(0));
    const testBuffer = offline.createBuffer(2, sampleRate, sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const samples = testBuffer.getChannelData(channel);
      const baseFrequency = channel === 0 ? 220 : 277;
      for (let index = 0; index < samples.length; index += 1) {
        const time = index / sampleRate;
        samples[index] =
          Math.sin(2 * Math.PI * baseFrequency * time) * 0.28 +
          Math.sin(2 * Math.PI * 1800 * time) * 0.08;
      }
    }
    const inputLeft = testBuffer.getChannelData(0);
    const inputRight = testBuffer.getChannelData(1);
    let inputSideEnergy = 0;
    let inputEnergy = 0;
    for (let index = 0; index < testBuffer.length; index += 1) {
      const side = (inputLeft[index] - inputRight[index]) * 0.5;
      inputSideEnergy += side * side;
      inputEnergy += inputLeft[index] * inputLeft[index] + inputRight[index] * inputRight[index];
    }
    const previousSettings = state.spatialSettings;
    const previousAnalysis = state.analysis;
    const previousStems = state.stemBuffers;
    state.spatialSettings = settings;
    state.analysis = analysis;
    state.stemBuffers = null;
    const graph = createSpatialPlaybackGraph(offline, testBuffer, analysis);
    startGraphSources(graph, 0, () => {});
    const rendered = await offline.startRendering();
    let renderedPeak = 0;
    let renderedEnergy = 0;
    let renderedFinite = true;
    for (let channel = 0; channel < rendered.numberOfChannels; channel += 1) {
      const samples = rendered.getChannelData(channel);
      for (let index = 0; index < samples.length; index += 1) {
        const value = samples[index];
        renderedFinite = renderedFinite && Number.isFinite(value);
        renderedPeak = Math.max(renderedPeak, Math.abs(value));
        renderedEnergy += value * value;
      }
    }
    const renderedLeft = rendered.getChannelData(0);
    const renderedRight = rendered.getChannelData(1);
    let renderedSideEnergy = 0;
    let renderedLeftEnergy = 0;
    let renderedRightEnergy = 0;
    let renderedCrossEnergy = 0;
    for (let index = 0; index < rendered.length; index += 1) {
      const side = (renderedLeft[index] - renderedRight[index]) * 0.5;
      renderedSideEnergy += side * side;
      renderedLeftEnergy += renderedLeft[index] * renderedLeft[index];
      renderedRightEnergy += renderedRight[index] * renderedRight[index];
      renderedCrossEnergy += renderedLeft[index] * renderedRight[index];
    }
    state.spatialSettings = previousSettings;
    state.analysis = previousAnalysis;
    state.stemBuffers = previousStems;
    return {
      compressorCount: graph.nodes.filter(node => node instanceof DynamicsCompressorNode).length,
      midDerivedSideGain: graph.spatialLayer.lateral.midSideSend.gain.value,
      midDerivedSideHighpass: graph.spatialLayer.lateral.midSideGuard.frequency.value,
      midDerivedSideLowpass: graph.spatialLayer.lateral.midSideAirGuard.frequency.value,
      decorrelatorDuration: graph.spatialLayer.lateral.decorrelator.buffer.duration,
      decorrelatorMonoError: (() => {
        const impulse = graph.spatialLayer.lateral.decorrelator.buffer;
        const left = impulse.getChannelData(0);
        const right = impulse.getChannelData(1);
        let error = 0;
        for (let index = 0; index < impulse.length; index += 1) {
          error = Math.max(error, Math.abs(left[index] + right[index]));
        }
        return error;
      })(),
      decorrelatorMonoCancelling: graph.spatialLayer.lateral.monoCancelling,
      measuredBrirChannels: state.measuredBrirBuffer.numberOfChannels,
      measuredBrirDuration: state.measuredBrirBuffer.duration,
      sideLift: audioRenderer.getLateralSideLift(analysis.stereoImage.width, settings),
      outputTrim: audioRenderer.getSpatialOutputPeakGuardPreGain(settings, analysis),
      centerDelayScale: audioRenderer.getFarFieldDelayScale({}, "center"),
      fieldDelayScale: audioRenderer.getFarFieldDelayScale({}, "field"),
      limiterThreshold: renderConfig.SPATIAL_OUTPUT_PEAK_GUARD_THRESHOLD_DB,
      limiterKnee: renderConfig.SPATIAL_OUTPUT_PEAK_GUARD_KNEE_DB,
      renderedPeak,
      renderedRms: Math.sqrt(renderedEnergy / (rendered.length * rendered.numberOfChannels)),
      lateralWidthRatio:
        (Math.sqrt(renderedSideEnergy / rendered.length) /
          Math.sqrt(renderedEnergy / (rendered.length * rendered.numberOfChannels))) /
        (Math.sqrt(inputSideEnergy / testBuffer.length) /
          Math.sqrt(inputEnergy / (testBuffer.length * testBuffer.numberOfChannels))),
      renderedCorrelation:
        renderedCrossEnergy /
        Math.sqrt(renderedLeftEnergy * renderedRightEnergy),
      renderedFinite
    };
  });

  expect(values.compressorCount).toBe(1);
  expect(values.midDerivedSideGain).toBeGreaterThanOrEqual(0.3);
  expect(values.midDerivedSideGain).toBeLessThanOrEqual(0.5);
  expect(values.midDerivedSideHighpass).toBe(700);
  expect(values.midDerivedSideLowpass).toBe(12000);
  expect(values.decorrelatorDuration).toBeGreaterThan(0.02);
  expect(values.decorrelatorDuration).toBeLessThan(0.022);
  expect(values.decorrelatorMonoError).toBeLessThan(1e-7);
  expect(values.decorrelatorMonoCancelling).toBe(true);
  expect(values.measuredBrirChannels).toBe(2);
  expect(values.measuredBrirDuration).toBeCloseTo(3.2, 1);
  expect(values.sideLift).toBeLessThanOrEqual(1.05);
  expect(values.outputTrim).toBeGreaterThanOrEqual(spatialRendererGolden.outputTrim[0]);
  expect(values.centerDelayScale).toBeGreaterThan(1.1);
  expect(values.fieldDelayScale).toBeGreaterThan(1.3);
  expect(values.limiterThreshold).toBeGreaterThanOrEqual(-0.8);
  expect(values.limiterThreshold).toBeLessThanOrEqual(-0.5);
  expect(values.limiterKnee).toBeLessThanOrEqual(0.5);
  expect(values.renderedFinite).toBe(true);
  expect(values.renderedPeak).toBeGreaterThan(spatialRendererGolden.renderedPeak[0]);
  expect(values.renderedPeak).toBeLessThan(spatialRendererGolden.renderedPeak[1]);
  expect(values.renderedRms).toBeGreaterThan(spatialRendererGolden.renderedRmsMinimum);
  expect(values.lateralWidthRatio).toBeGreaterThan(spatialRendererGolden.lateralWidthRatio[0]);
  expect(values.lateralWidthRatio).toBeLessThan(spatialRendererGolden.lateralWidthRatio[1]);
  expect(values.renderedCorrelation).toBeGreaterThan(spatialRendererGolden.stereoCorrelation[0]);
  expect(values.renderedCorrelation).toBeLessThan(spatialRendererGolden.stereoCorrelation[1]);
  expect(errors()).toEqual([]);
});

test("renders mocked analysis after file selection without moving the top cards", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await page.route("**/api/analyze?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createAnalysisFixture())
    });
  });

  await page.goto("/");
  const uploadBefore = await page.locator("#drop-zone").boundingBox();
  const transportBefore = await page.locator(".transport-panel").boundingBox();

  const filePath = testInfo.outputPath("tone.wav");
  fs.writeFileSync(filePath, createToneWav());
  await page.locator("#audio-file").setInputFiles(filePath);

  await expect(page.locator("#track-name")).toHaveText("tone.wav");
  await expect(page.locator("#active-count")).toHaveText("3 active");
  await expect(page.locator("#model-stack, #section-list, #waveform-canvas")).toHaveCount(0);
  await expect(page.locator("#instrument-list .instrument-row")).toHaveCount(4);
  await expect(page.locator("#spectrum-canvas")).toBeVisible();

  const uploadAfter = await page.locator("#drop-zone").boundingBox();
  const transportAfter = await page.locator(".transport-panel").boundingBox();
  expect(Math.abs(uploadAfter.y - uploadBefore.y)).toBeLessThan(2);
  expect(Math.abs(transportAfter.y - transportBefore.y)).toBeLessThan(2);

  expect(errors()).toEqual([]);
});

test("toggles playback with the Space key", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await page.route("**/api/analyze?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createAnalysisFixture())
    });
  });

  await page.goto("/");
  const filePath = testInfo.outputPath("space-toggle-tone.wav");
  fs.writeFileSync(filePath, createToneWav(44100, 3));
  await page.locator("#audio-file").setInputFiles(filePath);
  await expect(page.locator("#play-button")).toBeEnabled();

  await page.keyboard.press("Space");
  await expect(page.locator("#play-button")).toHaveText("Ⅱ", { timeout: 20000 });

  await page.locator("#seek-slider").focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#play-button")).toHaveText("▶");

  await page.getByRole("button", { name: "Original" }).focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#play-button")).toHaveText("Ⅱ");

  await expect(page.getByRole("button", { name: "Spatial" })).toHaveClass(/is-active/);

  await page.locator("#export-button").focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#play-button")).toHaveText("▶");

  await page.locator("#play-button").focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#play-button")).toHaveText("Ⅱ");

  await page.keyboard.press("Escape");
  await expect(page.locator("#play-button")).toHaveText("▶");
  await expect(page.locator("#current-time")).toHaveText("0:00");

  await page.keyboard.press("Space");
  await expect(page.locator("#play-button")).toHaveText("Ⅱ", { timeout: 500 });
  await page.keyboard.press("Space");
  await expect(page.locator("#play-button")).toHaveText("▶");

  await page.keyboard.press("Space");
  await page.keyboard.press("Space");
  await page.waitForTimeout(120);
  const rapidToggleState = await page.evaluate(() => ({
    playing: state.playback.playing,
    desired: state.playback.desired
  }));
  expect(rapidToggleState).toEqual({ playing: false, desired: false });
  expect(errors()).toEqual([]);
});

test("keeps analysis visible when browser audio decoding fails", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await page.route("**/api/analyze?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createAnalysisFixture())
    });
  });

  await page.goto("/");
  const filePath = testInfo.outputPath("unsupported.aiff");
  fs.writeFileSync(filePath, Buffer.from("not a browser-decodable audio file"));
  await page.locator("#audio-file").setInputFiles(filePath);

  await expect(page.locator("#status-text")).toHaveText("분석 완료 · 브라우저 디코딩 불가");
  await expect(page.locator("#track-name")).toHaveText("tone.wav");
  await expect(page.locator("#active-count")).toHaveText("3 active");
  await expect(page.locator("#play-button")).toBeDisabled();
  await expect(page.locator("#stop-button")).toBeDisabled();
  await expect(page.locator("#seek-slider")).toBeDisabled();

  expect(errors()).toEqual([]);
});

test("renders Demucs stems with inferred stage positions", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await page.addInitScript(() => {
    Object.defineProperty(window.navigator, "hardwareConcurrency", { configurable: true, value: 2 });
  });
  await page.route("**/api/analyze?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createAnalysisFixture({ demucsCompleted: true, stereoRight: true }))
    });
  });
  await page.route("**/outputs/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "audio/wav",
      body: createToneWav()
    });
  });

  await page.goto("/");
  const filePath = testInfo.outputPath("stem-tone.wav");
  fs.writeFileSync(filePath, createToneWav());
  await page.locator("#audio-file").setInputFiles(filePath);

  await expect(page.locator("#active-count")).toHaveText("4 stems");
  await expect(page.locator("#instrument-list .instrument-row")).toHaveCount(4);
  await expect(page.locator(".stage-node[data-id='vocals']")).toBeVisible();
  await expect(page.locator(".stage-node[data-id='other']")).toBeVisible();
  await expect(page.locator("#spectrum-scene")).toBeVisible();

  const positions = await page.evaluate(() => Object.values(state.stemBuffers).map((stem) => stem.stereoPosition));
  positions.forEach((position) => {
    expect(position.confidence).toBe(1);
    expect(position.pan).toBeCloseTo(0, 5);
    expect(position.panCurve.length).toBeGreaterThan(1);
  });
  await expect(page.locator("#stage-map svg")).toHaveCount(0);
  const musicStyle = await page.locator(".stage-node[data-id='other']").getAttribute("style");
  const musicLeft = Number(musicStyle.match(/left:\s*([\d.]+)%/)[1]);
  const musicTop = Number(musicStyle.match(/top:\s*([\d.]+)%/)[1]);

  await page.locator("#play-button").click();
  await expect(page.locator("#play-button")).toHaveText("Ⅱ");
  await page.waitForTimeout(200);
  expect(errors()).toEqual([]);
  const runtime = await page.evaluate(() => ({
    mode: state.playback.mode,
    playing: state.playback.playing,
    graphMode: state.playback.graph?.mode || null,
    stemBufferIds: Object.keys(state.stemBuffers || {}).sort(),
    hasSpatialLayer: Boolean(state.playback.graph?.spatialLayer)
  }));
  expect(runtime).toEqual({
    mode: "spatial",
    playing: true,
    graphMode: "spatial",
    stemBufferIds: ["bass", "drums", "other", "vocals"],
    hasSpatialLayer: true
  });
  const routing = await page.evaluate(() => ({
    ids: state.playback.graph?.spatialLayer?.stemObjects?.map((item) => item.id) || [],
    tapCounts: Object.fromEntries(
      (state.playback.graph?.spatialLayer?.stemObjects || []).map((item) => [item.id, item.reflections.taps.length])
    ),
    diffuseHighpasses: Object.fromEntries(
      (state.playback.graph?.spatialLayer?.stemObjects || []).map((item) => [
        item.id,
        item.reflections.highpass.frequency.value
      ])
    ),
    depthRoles: Object.fromEntries(
      Object.entries(renderConfig.STEM_OBJECT_ROUTES).map(([id, route]) => [id, route.depthRole])
    ),
    anchors: Object.fromEntries(
      Object.entries(renderConfig.STEM_OBJECT_ROUTES).map(([id, route]) => {
        const anchor = audioRenderer.getCoherentStemTapPlan(route.taps).find((tap) => tap.anchor);
        return [id, {
          azimuth: anchor.azimuth,
          distance: anchor.distance,
          delay: anchor.delay
        }];
      })
    ),
    directBusGain: state.playback.graph?.spatialLayer?.directBus?.gain.value,
    roomMasterGain: state.playback.graph?.spatialLayer?.wetMaster?.gain.value,
    sceneSumGain: state.playback.graph?.spatialLayer?.sceneSum?.gain.value,
    lateralBusGain: state.playback.graph?.spatialLayer?.lateralBus?.gain.value,
    externalizationBusGain: state.playback.graph?.spatialLayer?.externalizationBus?.gain.value,
    externalizationTapCount: state.playback.graph?.spatialLayer?.externalization?.taps?.length,
    externalizationRadiusRange: state.playback.graph?.spatialLayer?.externalization?.radiusRange,
    externalizationDistances: (state.playback.graph?.spatialLayer?.externalization?.taps || [])
      .map((tap) => tap.direction.distance),
    externalizationAzimuths: (state.playback.graph?.spatialLayer?.externalization?.taps || [])
      .map((tap) => tap.direction.azimuth),
    externalizationDelays: (state.playback.graph?.spatialLayer?.externalization?.taps || [])
      .map((tap) => tap.delay.delayTime.value),
    externalizationStageFront: state.playback.graph?.spatialLayer?.externalization?.stageFront,
    externalizationBalance: (state.playback.graph?.spatialLayer?.externalization?.taps || [])
      .reduce((sum, tap) => (
        sum + tap.gain.gain.value * Math.sin(tap.direction.azimuth * Math.PI / 180)
      ), 0),
    audioQualityId: state.playback.graph?.spatialLayer?.audioQuality?.id,
    orchestralHallBusGain: state.playback.graph?.spatialLayer?.orchestralHallBus?.gain.value,
    orchestralTapCount: state.playback.graph?.spatialLayer?.orchestralHall?.taps?.length,
    orchestralHighpass: state.playback.graph?.spatialLayer?.orchestralHall?.bodyGuard?.frequency.value,
    orchestralLowpass: state.playback.graph?.spatialLayer?.orchestralHall?.airGuard?.frequency.value,
    orchestralDelays: (state.playback.graph?.spatialLayer?.orchestralHall?.taps || [])
      .map((tap) => tap.delay.delayTime.value),
    hallDimensions: { ...SPATIAL_CUBIC_HALL },
    hallField: renderConfig.SPATIAL_FIELD_DIRECTIONS.map((direction) => ({
      id: direction.id,
      azimuth: direction.azimuth,
      elevation: direction.elevation,
      distance: direction.distance,
      delay: direction.delay,
      rendered: audioRenderer.getRoomHrtfPosition(direction)
    })),
    orchestralBalance: (state.playback.graph?.spatialLayer?.orchestralHall?.taps || [])
      .reduce((sum, tap) => (
        sum + tap.gain.gain.value * Math.sin(tap.direction.azimuth * Math.PI / 180)
      ), 0),
    lateEnvelopmentBusGain: state.playback.graph?.spatialLayer?.lateEnvelopmentBus?.gain.value,
    lateEnvelopmentSend: state.playback.graph?.spatialLayer?.lateEnvelopment?.send?.gain.value,
    lateEnvelopmentTapCount: state.playback.graph?.spatialLayer?.lateEnvelopment?.taps?.length,
    lateEnvelopmentDelays: (state.playback.graph?.spatialLayer?.lateEnvelopment?.taps || [])
      .map((tap) => tap.delay.delayTime.value),
    lateEnvelopmentHighpass: state.playback.graph?.spatialLayer?.lateEnvelopment?.bodyGuard?.frequency.value,
    lateEnvelopmentLowpass: state.playback.graph?.spatialLayer?.lateEnvelopment?.airGuard?.frequency.value,
    lateEnvelopmentDiffusionSeconds: state.playback.graph?.spatialLayer?.lateEnvelopment?.renderers?.[0]?.buffer?.duration,
    lateEnvelopmentStartsAfterEarlyWindow: state.playback.graph?.spatialLayer?.lateEnvelopment?.startsAfterEarlyWindow,
    lateEnvelopmentBalance: (state.playback.graph?.spatialLayer?.lateEnvelopment?.taps || [])
      .reduce((sum, tap) => (
        sum + tap.gain.gain.value * Math.sin(tap.direction.azimuth * Math.PI / 180)
      ), 0),
    venueBusGain: state.playback.graph?.spatialLayer?.venueTailBus?.gain.value,
    venueDuration: state.playback.graph?.spatialLayer?.venueTail?.convolver?.buffer?.duration,
    venueHighpass: state.playback.graph?.spatialLayer?.venueTail?.bodyGuard?.frequency.value,
    venueLowpass: state.playback.graph?.spatialLayer?.venueTail?.airGuard?.frequency.value,
    venuePreDelay: state.playback.graph?.spatialLayer?.venueTail?.preDelay?.delayTime.value,
    wetLowGuard: state.playback.graph?.spatialLayer?.roomLowGuard?.frequency.value,
    wetAirGuard: state.playback.graph?.spatialLayer?.roomAirGuard?.frequency.value,
    roomResponseEq: state.playback.graph?.spatialLayer?.roomResponseEq?.filters?.map((filter) => ({
      type: filter.type,
      frequency: filter.frequency.value,
      gain: filter.gain.value
    })),
    roomResponseMaximumCorrection: state.playback.graph?.spatialLayer?.roomResponseEq?.maximumCorrectionDb,
    distanceProfileId: state.playback.graph?.spatialLayer?.distanceProfile?.id,
    distanceProfiles: [0.9, 1.04, 1.22].map((radius) => {
      const profile = audioRenderer.getSpatialDistanceBrirProfile(radius);
      return {
        id: profile.id,
        preDelay: profile.preDelay,
        highpass: profile.highpass,
        lowpass: profile.lowpass,
        earlyDelayScale: profile.earlyDelayScale
      };
    }),
    lateralHighpass: state.playback.graph?.spatialLayer?.lateral?.sideGuard?.frequency.value
      ?? renderConfig.SPATIAL_RESEARCH_PROFILE.lateralHighpassHz,
    fieldHighpass: state.playback.graph?.spatialLayer?.field?.bodyGuard?.frequency.value,
    coherence: Object.fromEntries(
      Object.entries(renderConfig.STEM_OBJECT_ROUTES).map(([id, route]) => {
        const taps = audioRenderer.getCoherentStemTapPlan(route.taps);
        const anchor = taps.find((tap) => tap.anchor) || taps[0];
        const totalGain = taps.reduce((sum, tap) => sum + tap.gain, 0);
        return [id, {
          anchorShare: totalGain > 0 ? anchor.gain / totalGain : 0,
          anchorLeads: taps.every((tap) => (
            tap === anchor || tap.delay - anchor.delay >= renderConfig.SPATIAL_RESEARCH_PROFILE.anchorLeadSeconds
          ))
        }];
      })
    ),
    qualityGains: (state.playback.graph?.spatialLayer?.stemObjects || []).map((item) => item.qualityGain),
    directPathDelays: (state.playback.graph?.spatialLayer?.stemObjects || [])
      .flatMap((item) => item.primaryPaths.map((path) => path.delaySeconds)),
    usesOriginalAnchor: state.playback.graph?.spatialLayer?.usesOriginalAnchor,
    originalAnchorSend: state.playback.graph?.spatialLayer?.originalAnchorSend || null,
    fullSpatial: state.playback.graph?.spatialLayer?.fullSpatial,
    mixtureProfile: state.playback.graph?.spatialLayer?.mixtureProfile,
    phasePreserving: (state.playback.graph?.spatialLayer?.stemObjects || [])
      .map((item) => item.phasePreserving),
    directGains: (state.playback.graph?.spatialLayer?.stemObjects || [])
      .map((item) => item.directGain),
    directRendererModes: (state.playback.graph?.spatialLayer?.stemObjects || [])
      .flatMap((item) => item.primaryPaths.map((path) => path.rendererMode)),
    reflectionBalance: (state.playback.graph?.spatialLayer?.stemObjects || []).map((item) => (
      item.reflections.taps.reduce((sum, tap) => (
        sum + tap.gain * Math.sin((tap.azimuth || 0) * Math.PI / 180)
      ), 0)
    )),
    residualPhasePreserving: state.playback.graph?.spatialLayer?.residualPrimary?.phasePreserving,
    cancellationGains: (state.playback.graph?.spatialLayer?.residualCancellationGains || [])
      .map((gain) => gain.gain.value)
  }));
  expect(routing.ids).toEqual(["vocals", "other", "drums", "bass"]);
  expect(routing.tapCounts).toEqual({
    full: { vocals: 4, other: 5, drums: 6, bass: 4 },
    balanced: { vocals: 4, other: 4, drums: 6, bass: 4 },
    safe: { vocals: 2, other: 4, drums: 4, bass: 2 }
  }[routing.audioQualityId]);
  expect(routing.diffuseHighpasses).toEqual({
    vocals: 1100,
    other: 650,
    drums: 1200,
    bass: 320
  });
  expect(routing.depthRoles).toEqual({
    vocals: "stage-front",
    guitar: "stage-mid",
    piano: "stage-mid",
    other: "stage-mid",
    drums: "stage-back",
    bass: "stage-back"
  });
  expect(Object.values(routing.anchors).every((anchor) => Math.abs(anchor.azimuth) <= 32)).toBe(true);
  expect(routing.anchors.vocals.distance).toBeGreaterThanOrEqual(7);
  expect(routing.anchors.vocals.distance).toBeLessThan(routing.anchors.other.distance);
  expect(routing.anchors.other.distance).toBeLessThan(routing.anchors.drums.distance);
  expect(routing.anchors.other.distance).toBeLessThan(routing.anchors.bass.distance);
  expect(routing.anchors.vocals.delay).toBeLessThan(routing.anchors.other.delay);
  expect(routing.anchors.other.delay).toBeLessThan(routing.anchors.drums.delay);
  expect(routing.directBusGain).toBeCloseTo(0.86, 4);
  const normalizedRoomMasterGain = routing.roomMasterGain / { full: 1, balanced: 0.94, safe: 0.86 }[routing.audioQualityId];
  expect(normalizedRoomMasterGain).toBeGreaterThan(0.16);
  expect(normalizedRoomMasterGain).toBeLessThan(0.20);
  expect(routing.sceneSumGain).toBeCloseTo(0.86, 4);
  expect(routing.lateralBusGain).toBeGreaterThan(0.25);
  expect(routing.lateralBusGain).toBeLessThan(0.34);
  expect(routing.externalizationBusGain).toBeGreaterThan(0.8);
  expect(routing.externalizationBusGain).toBeLessThan(0.9);
  expect(routing.externalizationTapCount).toBe({ full: 24, balanced: 16, safe: 8 }[routing.audioQualityId]);
  expect(routing.externalizationRadiusRange).toEqual([7.2, 11.8]);
  expect(routing.externalizationStageFront).toBe(true);
  expect(Math.min(...routing.externalizationDistances)).toBeCloseTo(7.2, 4);
  expect(Math.max(...routing.externalizationDistances)).toBeCloseTo({ full: 11.8, balanced: 11.1, safe: 10.2 }[routing.audioQualityId], 4);
  expect(Math.max(...routing.externalizationAzimuths.map(Math.abs))).toBeLessThanOrEqual(79);
  expect(Math.min(...routing.externalizationDelays)).toBeCloseTo(7.2 / 343, 4);
  expect(Math.max(...routing.externalizationDelays)).toBeCloseTo({ full: 0.035, balanced: 0.0324, safe: 0.0297 }[routing.audioQualityId], 3);
  expect(Math.abs(routing.externalizationBalance)).toBeLessThan(1e-7);
  expect(routing.orchestralHallBusGain).toBeGreaterThan(0.6);
  expect(routing.orchestralHallBusGain).toBeLessThanOrEqual(0.76);
  expect(routing.orchestralTapCount).toBe({ full: 10, balanced: 8, safe: 6 }[routing.audioQualityId]);
  expect(routing.orchestralHighpass).toBe(160);
  expect(routing.orchestralLowpass).toBe(12500);
  const hallDelayScale = routing.distanceProfiles.find((profile) => profile.id === routing.distanceProfileId).earlyDelayScale;
  expect(Math.min(...routing.orchestralDelays)).toBeCloseTo(0.0292 * hallDelayScale, 4);
  expect(Math.max(...routing.orchestralDelays)).toBeCloseTo(
    { full: 0.0505, balanced: 0.0412, safe: 0.0412 }[routing.audioQualityId] * hallDelayScale,
    4
  );
  expect(Math.abs(routing.orchestralBalance)).toBeLessThan(1e-7);
  expect(routing.hallDimensions).toMatchObject({
    width: 20,
    depth: 20,
    height: 20,
    wallDistance: 10,
    speedOfSound: 343
  });
  expect(routing.hallField.some((direction) => direction.azimuth === 0)).toBe(true);
  expect(routing.hallField.some((direction) => Math.abs(direction.azimuth) === 180)).toBe(true);
  expect(routing.hallField.some((direction) => Math.abs(direction.azimuth) === 90)).toBe(true);
  expect(routing.hallField.some((direction) => direction.elevation >= 80)).toBe(true);
  expect(Math.min(...routing.hallField.map((direction) => direction.distance))).toBe(10);
  expect(Math.max(...routing.hallField.map((direction) => direction.distance))).toBeCloseTo(14.14, 2);
  expect(routing.hallField.every((direction) => (
    direction.rendered.azimuth === direction.azimuth &&
    direction.rendered.elevation === direction.elevation &&
    direction.rendered.distance === direction.distance
  ))).toBe(true);
  expect(routing.hallField.every((direction) => (
    Math.abs(direction.delay - direction.distance / routing.hallDimensions.speedOfSound) < 0.0001
  ))).toBe(true);
  expect(routing.lateEnvelopmentBusGain).toBeGreaterThan(0.6);
  expect(routing.lateEnvelopmentBusGain).toBeLessThanOrEqual(0.82);
  expect(routing.lateEnvelopmentSend).toBeGreaterThan(0.1);
  expect(routing.lateEnvelopmentSend).toBeLessThanOrEqual(0.22);
  expect(routing.lateEnvelopmentTapCount).toBe(16);
  expect(Math.min(...routing.lateEnvelopmentDelays)).toBeCloseTo(18 / 343, 4);
  expect(Math.max(...routing.lateEnvelopmentDelays)).toBeCloseTo(42 / 343, 4);
  expect(routing.lateEnvelopmentHighpass).toBe(220);
  expect(routing.lateEnvelopmentLowpass).toBe(14000);
  expect(routing.lateEnvelopmentDiffusionSeconds).toBeCloseTo(0.72, 3);
  expect(routing.lateEnvelopmentStartsAfterEarlyWindow).toBe(false);
  expect(Math.abs(routing.lateEnvelopmentBalance)).toBeLessThan(1e-7);
  expect(routing.venueBusGain).toBeGreaterThan(0.1);
  expect(routing.venueBusGain).toBeLessThan(0.25);
  expect(routing.venueDuration).toBeCloseTo(3.2, 1);
  const activeDistanceProfile = routing.distanceProfiles.find((profile) => profile.id === routing.distanceProfileId);
  expect(routing.venueHighpass).toBe(activeDistanceProfile.highpass);
  expect(routing.venueLowpass).toBe(activeDistanceProfile.lowpass);
  expect(routing.venuePreDelay).toBeCloseTo(activeDistanceProfile.preDelay, 4);
  expect(routing.wetLowGuard).toBe(180);
  expect(routing.wetAirGuard).toBe(16000);
  expect(routing.lateralHighpass).toBe(220);
  expect(routing.fieldHighpass).toBe(320);
  expect(routing.distanceProfileId).toBe("far");
  expect(routing.distanceProfiles).toEqual([
    { id: "near", preDelay: 0, highpass: 250, lowpass: 11500, earlyDelayScale: 0.92 },
    { id: "mid", preDelay: 0.006, highpass: 220, lowpass: 10500, earlyDelayScale: 1 },
    { id: "far", preDelay: 0.012, highpass: 235, lowpass: 9600, earlyDelayScale: 1.12 }
  ]);
  expect(routing.roomResponseEq.map((filter) => filter.type)).toEqual(["lowshelf", "peaking", "peaking"]);
  expect(routing.roomResponseEq.map((filter) => filter.frequency)).toEqual([165, 340, 4200]);
  expect(routing.roomResponseMaximumCorrection).toBeLessThanOrEqual(1.8);
  Object.values(routing.coherence).forEach((coherence) => {
    expect(coherence.anchorShare).toBeGreaterThan(0.59);
    expect(coherence.anchorLeads).toBe(true);
  });
  routing.qualityGains.forEach((gain) => {
    expect(gain).toBeGreaterThanOrEqual(0.94);
    expect(gain).toBeLessThanOrEqual(1.02);
  });
  expect(routing.directPathDelays.every((delay) => delay === 0)).toBe(true);
  expect(routing.usesOriginalAnchor).toBe(false);
  expect(routing.originalAnchorSend).toBeNull();
  expect(routing.fullSpatial).toBe(true);
  expect(routing.mixtureProfile.stemScale).toBeGreaterThanOrEqual(0.72);
  expect(routing.mixtureProfile.stemScale).toBeLessThanOrEqual(1.18);
  expect(Number.isFinite(routing.mixtureProfile.residualRatio)).toBe(true);
  expect(routing.phasePreserving.every((value) => value === false)).toBe(true);
  expect(routing.directGains.every((gain) => gain === routing.mixtureProfile.stemScale)).toBe(true);
  expect(routing.directRendererModes.every((mode) => mode === "program-matched-binaural")).toBe(true);
  routing.reflectionBalance.forEach((balance) => expect(Math.abs(balance)).toBeLessThan(1e-7));
  expect(routing.residualPhasePreserving).toBe(false);
  expect(routing.cancellationGains).toHaveLength(4);
  routing.cancellationGains.forEach((gain) => expect(gain).toBeLessThan(0));
  const musicStyleDuringPlayback = await page.locator(".stage-node[data-id='other']").getAttribute("style");
  const musicLeftDuringPlayback = Number((musicStyleDuringPlayback || "").match(/left:\s*([\d.]+)%/)?.[1]);
  const musicTopDuringPlayback = Number((musicStyleDuringPlayback || "").match(/top:\s*([\d.]+)%/)?.[1]);
  expect(musicLeftDuringPlayback).toBeCloseTo(musicLeft, 3);
  expect(musicTopDuringPlayback).toBeCloseTo(musicTop, 3);
  const spectrumPixels = await page.locator("#spectrum-canvas").evaluate((canvas) => {
    const context = canvas.getContext("2d");
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    let alpha = 0;
    for (let index = 3; index < image.data.length; index += 64) {
      alpha += image.data[index];
    }
    return alpha;
  });
  expect(spectrumPixels).toBeGreaterThan(0);

  expect(errors()).toEqual([]);
});

test("loads quality-gated guitar and piano as optional adaptive stems", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await page.route("**/api/analyze?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createAnalysisFixture({
        demucsCompleted: true,
        adaptiveSix: true,
        stereoRight: true
      }))
    });
  });
  await page.route("**/outputs/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "audio/wav", body: createToneWav() });
  });

  await page.goto("/");
  const filePath = testInfo.outputPath("adaptive-six-tone.wav");
  fs.writeFileSync(filePath, createToneWav());
  await page.locator("#audio-file").setInputFiles(filePath);

  await expect(page.locator("#active-count")).toHaveText("6 stems");
  await expect(page.locator("#instrument-list .instrument-row")).toHaveCount(6);
  await expect(page.locator(".stage-node[data-id='guitar']")).toBeVisible();
  await expect(page.locator(".stage-node[data-id='piano']")).toBeVisible();
  await page.locator("#play-button").click();
  await page.waitForFunction(() => state.playback.graph?.spatialLayer?.stemObjects?.length === 6);
  const adaptive = await page.evaluate(() => ({
    ids: Object.keys(state.stemBuffers || {}).sort((a, b) => STEM_ORDER.indexOf(a) - STEM_ORDER.indexOf(b)),
    spatialIds: state.playback.graph?.spatialLayer?.stemObjects?.map((stem) => stem.id) || [],
    guitarConfidence: state.stemBuffers?.guitar?.quality?.hybridConfidence,
    pianoConfidence: state.stemBuffers?.piano?.quality?.hybridConfidence,
    required: CORE_STEM_ORDER,
    transientControls: state.playback.graph?.spatialLayer?.transientControls?.length
  }));
  expect(adaptive.ids).toEqual(["vocals", "guitar", "piano", "other", "drums", "bass"]);
  expect(adaptive.spatialIds).toEqual(adaptive.ids);
  expect(adaptive.guitarConfidence).toBe(0.72);
  expect(adaptive.pianoConfidence).toBe(0.66);
  expect(adaptive.required).toEqual(["vocals", "other", "drums", "bass"]);
  expect(adaptive.transientControls).toBe(0);
  expect(errors()).toEqual([]);
});

test("computes a mixture-consistent residual for aligned stem partitions", async ({ page }) => {
  await page.goto("/");
  const profile = await page.evaluate(() => {
    const context = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, 2048, 48000);
    const reference = context.createBuffer(2, 2048, 48000);
    const stems = ["vocals", "other", "drums", "bass"].map((id) => ({
      id,
      buffer: context.createBuffer(2, 2048, 48000)
    }));
    for (let channel = 0; channel < 2; channel += 1) {
      const referenceData = reference.getChannelData(channel);
      for (let index = 0; index < reference.length; index += 1) {
        const value = Math.sin(2 * Math.PI * (220 + channel * 31) * index / 48000) * 0.4;
        referenceData[index] = value;
        stems.forEach((stem) => {
          stem.buffer.getChannelData(channel)[index] = value * 0.25;
        });
      }
    }
    return audioRenderer.getMixtureConsistencyProfile(reference, stems);
  });
  expect(profile.stemScale).toBeCloseTo(1, 6);
  expect(profile.residualRatio).toBeLessThan(1e-6);
  expect(profile.reliable).toBe(true);
  expect(profile.sampleCount).toBeGreaterThan(0);
});

test("detects and corrects a common sample lag across the Demucs stem set", async ({ page }) => {
  await page.goto("/");
  const alignment = await page.evaluate(() => {
    const context = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, 4096, 48000);
    const reference = context.createBuffer(2, 4096, 48000);
    const ids = ["vocals", "other", "drums", "bass"];
    const loaded = Object.fromEntries(ids.map((id) => [id, {
      id,
      buffer: context.createBuffer(2, 4096, 48000)
    }]));
    const lag = 7;
    for (let channel = 0; channel < 2; channel += 1) {
      const referenceData = reference.getChannelData(channel);
      for (let index = 0; index < reference.length - lag; index += 1) {
        const value = (
          Math.sin(index * 0.071 + channel * 0.31) * 0.24 +
          Math.sin(index * 0.193 + channel * 0.17) * 0.11
        );
        referenceData[index] = value;
        ids.forEach((id) => {
          loaded[id].buffer.getChannelData(channel)[index + lag] = value * 0.25;
        });
      }
    }
    return estimateStemSetAlignment(reference, loaded);
  });
  expect(alignment.lagSamples).toBe(7);
  expect(alignment.correlation).toBeGreaterThan(0.99);
  expect(alignment.reliable).toBe(true);
  expect(alignment.inspectedSamples).toBeGreaterThan(1000);
});

test("adapts the symmetric DSP quality tier from real render-capacity pressure", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(() => {
    const changes = [];
    const controller = new window.SpatialRuntimeQualityController({
      initialTier: "full",
      ceilingTier: "full",
      cooldownMs: 0,
      highWindowLimit: 3,
      lowWindowLimit: 4,
      onTierChange: (change) => changes.push({ tier: change.tier, reason: change.reason })
    });
    controller.handleUpdate({ averageLoad: 0.82, peakLoad: 0.96, underrunRatio: 0 }, 1000);
    controller.handleUpdate({ averageLoad: 0.84, peakLoad: 0.97, underrunRatio: 0 }, 2000);
    controller.handleUpdate({ averageLoad: 0.86, peakLoad: 0.98, underrunRatio: 0.01 }, 3000);
    const degraded = controller.snapshot();
    for (let index = 0; index < 4; index += 1) {
      controller.handleUpdate({ averageLoad: 0.22, peakLoad: 0.34, underrunRatio: 0 }, 4000 + index * 1000);
    }
    return { degraded, recovered: controller.snapshot(), changes };
  });

  expect(result.degraded.tier).toBe("balanced");
  expect(result.recovered.tier).toBe("full");
  expect(result.changes).toEqual([
    { tier: "balanced", reason: "render-overload" },
    { tier: "full", reason: "render-headroom" }
  ]);
});

test("incomplete render-capacity events cannot trigger quality recovery", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(() => {
    const changes = [];
    const controller = new window.SpatialRuntimeQualityController({initialTier: "balanced", ceilingTier: "full",
      cooldownMs: 0, lowWindowLimit: 3, onTierChange: change => changes.push(change)});
    controller.handleUpdate({averageLoad: 0.1, peakLoad: 0.1, underrunRatio: 0}, 1);
    controller.handleUpdate({}, 2);
    controller.handleUpdate({averageLoad: 0.1, peakLoad: 0.1, underrunRatio: 0}, 3);
    controller.handleUpdate({averageLoad: 0.1, peakLoad: 0.1, underrunRatio: 0}, 4);
    const before = controller.snapshot().tier;
    controller.handleUpdate({averageLoad: 0.1, peakLoad: 0.1, underrunRatio: 0}, 5);
    return {before, after: controller.snapshot().tier, changes};
  });
  expect(result.before).toBe("balanced");
  expect(result.after).toBe("full");
  expect(result.changes).toHaveLength(1);
});

test("mono stem position matches a duplicated stereo stem including silence", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(() => {
    const rate = 48000, length = rate;
    const context = new OfflineAudioContext(2, length, rate);
    const mono = context.createBuffer(1, length, rate), stereo = context.createBuffer(2, length, rate);
    const source = mono.getChannelData(0);
    for (let i = rate / 3; i < rate * 2 / 3; i++) source[i] = 0.1 * Math.sin(i * 0.17);
    stereo.copyToChannel(source, 0); stereo.copyToChannel(source, 1);
    const silent = context.createBuffer(1, length, rate);
    return {mono: analyzeStemStereoPosition(mono), stereo: analyzeStemStereoPosition(stereo),
      silent: analyzeStemStereoPosition(silent)};
  });
  expect(result.mono).toEqual(result.stereo);
  expect(result.mono.pan).toBe(0);
  expect(result.mono.confidence).toBe(1);
  expect(result.silent.confidence).toBe(0);
});

test("stem position analysis yields to the UI and supports cancellation", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const rate = 48000, length = rate * 8;
    const context = new OfflineAudioContext(2, length, rate);
    const buffer = context.createBuffer(2, length, rate);
    for (let channel = 0; channel < 2; channel++) {
      const samples = buffer.getChannelData(channel);
      for (let i = 0; i < length; i++) samples[i] = Math.sin(i * 0.05) * (channel ? 0.15 : 0.1);
    }
    const expected = analyzeStemStereoPosition(buffer);
    let yielded = false;
    setTimeout(() => { yielded = true; }, 0);
    const actual = await analyzeStemStereoPositionAsync(buffer);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 0);
    let aborted = false;
    try { await analyzeStemStereoPositionAsync(buffer, controller.signal); }
    catch (error) { aborted = error.name === "AbortError"; }
    return {expected, actual, yielded, aborted};
  });
  expect(result.actual).toEqual(result.expected);
  expect(result.yielded).toBe(true);
  expect(result.aborted).toBe(true);
});

test("stem analysis divides unusually large windows into bounded steps", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const data = new Float32Array(100000).fill(0.1);
    const buffer = {numberOfChannels: 1, length: data.length, duration: 1 / 6, getChannelData: () => data};
    const iterator = stemStereoPositionSteps(buffer);
    let yields = 0, step;
    do { step = iterator.next(); if (!step.done) yields++; } while (!step.done);
    return {yields, result: step.value, asyncResult: await analyzeStemStereoPositionAsync(buffer)};
  });
  expect(result.yields).toBeGreaterThanOrEqual(3);
  expect(result.result).toEqual(result.asyncResult);
  expect(result.result.pan).toBe(0);
});

test("render-capacity monitoring clears stale state on detach or failed attach", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(() => {
    let stopped = 0;
    const controller = new window.SpatialRuntimeQualityController({initialTier: "balanced", ceilingTier: "full", lowWindowLimit: 2, cooldownMs: 0});
    const capacity = {start() {}, stop() { stopped++; }};
    const attached = controller.attach({renderCapacity: capacity});
    controller.handleUpdate({averageLoad: 0.1, peakLoad: 0.1, underrunRatio: 0}, 1);
    const missing = controller.attach({});
    const afterDetach = controller.snapshot();
    const failed = controller.attach({renderCapacity: {start() { throw new Error("unsupported"); }}});
    const afterFailure = controller.snapshot();
    controller.handleUpdate({averageLoad: 0.1, peakLoad: 0.1, underrunRatio: 0}, 2);
    return {attached, missing, failed, afterDetach, afterFailure, tier: controller.snapshot().tier, stopped};
  });
  expect(result.attached).toBe(true);
  expect(result.missing).toBe(false);
  expect(result.failed).toBe(false);
  expect(result.afterDetach.supported).toBe(false);
  expect(result.afterFailure.supported).toBe(false);
  expect(result.tier).toBe("balanced");
  expect(result.stopped).toBe(1);
});

test("recreates a closed audio context and reuses its quality controller", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const first = await ensureAudioContext();
    const controller = state.runtimeQualityController;
    await first.close();
    const second = await ensureAudioContext();
    const result = {firstState: first.state, secondState: second.state, replaced: first !== second,
      sameController: state.runtimeQualityController === controller};
    await second.close();
    return result;
  });
  expect(result.firstState).toBe("closed");
  expect(result.secondState).not.toBe("closed");
  expect(result.replaced).toBe(true);
  expect(result.sameController).toBe(true);
});

test("starts spatial playback on a replacement audio context", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    await ensureUniversalHrtfProfile();
    const first = await ensureAudioContext();
    const buffer = first.createBuffer(2, first.sampleRate * 2, first.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const samples = buffer.getChannelData(channel);
      for (let i = 0; i < samples.length; i++) samples[i] = 0.05 * Math.sin(2 * Math.PI * 440 * i / first.sampleRate);
    }
    state.audioBuffer = buffer;
    state.analysis = {mix: {peakDb: -20, rmsDb: -30}, stereoImage: {width: 0}, instruments: []};
    state.stemBuffers = null;
    state.spatialOutputCalibration = null;
    state.playback.offset = 0.75;
    await first.close();
    await startPlayback();
    const second = state.audioContext;
    const result = {replaced: second !== first, playing: state.playback.playing,
      graphContext: state.playback.graph?.master?.context === second,
      outputContext: state.playback.output?.context === second,
      spatial: Boolean(state.playback.graph?.spatialLayer)};
    await second.close();
    return result;
  });
  expect(result).toEqual({replaced: true, playing: true, graphContext: true, outputContext: true, spatial: true});
  await page.waitForFunction(() => !state.playback.playing && !state.playback.desired);
  const restarted = await page.evaluate(async () => {
    const previous = state.audioContext;
    const savedOffset = state.playback.offset;
    await startPlayback();
    const ok = state.playback.playing && state.audioContext !== previous &&
      state.playback.graph?.master?.context === state.audioContext;
    const restartTime = getPlaybackTime();
    stopPlayback();
    await state.audioContext.close();
    return {ok, savedOffset, restartTime};
  });
  expect(restarted.ok).toBe(true);
  expect(restarted.savedOffset).toBeGreaterThanOrEqual(0.75);
  expect(restarted.savedOffset).toBeLessThan(1.2);
  expect(restarted.restartTime).toBeGreaterThanOrEqual(restarted.savedOffset - 0.02);
  expect(restarted.restartTime).toBeLessThan(restarted.savedOffset + 0.2);
});

test("renders the complete four-stem Full Spatial graph within audio safety guards", async ({ page, browserName }) => {
  test.skip(browserName === "webkit", "Windows WebKit does not complete native-HRTF OfflineAudioContext rendering.");
  await page.goto("/");
  const metrics = await page.evaluate(async () => {
    await ensureUniversalHrtfProfile();
    const sampleRate = 24000;
    const sourceLength = Math.round(sampleRate * 0.4);
    const renderLength = sampleRate;
    const context = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, renderLength, sampleRate);
    const reference = context.createBuffer(2, sourceLength, sampleRate);
    const ids = ["vocals", "other", "drums", "bass"];
    const frequencies = [330, 550, 120, 70];
    const stems = Object.fromEntries(ids.map((id) => [id, {
      id,
      separation: 0.9,
      spatialWeight: 1,
      alignmentSamples: 0,
      alignmentOffsetSeconds: 0,
      buffer: context.createBuffer(2, sourceLength, sampleRate)
    }]));
    for (let channel = 0; channel < 2; channel += 1) {
      const referenceData = reference.getChannelData(channel);
      ids.forEach((id, stemIndex) => {
        const stemData = stems[id].buffer.getChannelData(channel);
        for (let index = 0; index < sourceLength; index += 1) {
          const phase = channel === 0 ? stemIndex * 0.13 : stemIndex * 0.13 + 0.21;
          const value = Math.sin(2 * Math.PI * frequencies[stemIndex] * index / sampleRate + phase) * 0.055;
          stemData[index] = value;
          referenceData[index] += value;
        }
      });
    }

    const previous = {
      stems: state.stemBuffers,
      settings: state.spatialSettings,
      analysis: state.analysis,
      brir: state.measuredBrirBuffer,
      calibration: state.playbackCalibration,
      quality: state.audioQualityTier
    };
    const brirBytes = await fetch(DEFAULT_MEASURED_BRIR_URL).then((response) => response.arrayBuffer());
    state.measuredBrirBuffer = await context.decodeAudioData(brirBytes.slice(0));
    state.stemBuffers = stems;
    state.spatialSettings = { wet: 0.72, radius: 1.14, reflections: 0.62 };
    state.analysis = { mix: { peakDb: -8, rmsDb: -20, approxLufs: -21.5, estimatedTruePeakDb: -7.8 }, stereoImage: { width: 0.42 } };
    state.playbackCalibration = { estimatedTruePeakDb: -7.8, approxLufs: -21.5, sampleRate };
    state.audioQualityTier = "full";
    const graph = createSpatialPlaybackGraph(context, reference, state.analysis);
    const stemSpatialProfile = Object.fromEntries(graph.spatialLayer.stemObjects.map((item) => [item.id, {
      directGain: item.directGain,
      roomSceneScale: item.roomSceneScale,
      spatialConfidence: item.spatialConfidence,
      reflectionSend: item.reflections.send.gain.value,
      externalizationSend: item.externalization.send.gain.value,
      confidenceSendScale: item.externalization.confidenceSendScale,
      lateralEarlyScale: item.externalization.lateralEarlyScale,
      primaryDelays: item.primaryPaths.map((path) => path.delaySeconds)
    }]));
    startGraphSources(graph, 0, () => {});
    const rendered = await context.startRendering();

    let peak = 0;
    let energy = 0;
    let monoEnergy = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;
    let finite = true;
    const left = rendered.getChannelData(0);
    const right = rendered.getChannelData(1);
    for (let index = 0; index < rendered.length; index += 1) {
      const l = left[index];
      const r = right[index];
      finite = finite && Number.isFinite(l) && Number.isFinite(r);
      peak = Math.max(peak, Math.abs(l), Math.abs(r));
      leftEnergy += l * l;
      rightEnergy += r * r;
      monoEnergy += ((l + r) * 0.5) ** 2;
      energy += l * l + r * r;
    }
    const renderedCalibration = analyzeRenderedSpatialCalibration(rendered, reference, 0, 0.4);
    const result = {
      finite,
      peak,
      rms: Math.sqrt(energy / (rendered.length * 2)),
      monoRms: Math.sqrt(monoEnergy / rendered.length),
      balanceRatio: Math.sqrt(leftEnergy / Math.max(rightEnergy, 1e-12)),
      residualRatio: graph.spatialLayer.mixtureProfile.residualRatio,
      usesOriginalAnchor: graph.spatialLayer.usesOriginalAnchor,
      phasePreserving: graph.spatialLayer.stemObjects.every((item) => item.phasePreserving),
      externalizationTaps: graph.spatialLayer.externalization.taps.length,
      loudnessMatchGain: graph.loudnessMatchGain,
      truePeakHeadroomGain: graph.truePeakHeadroomGain,
      stemSpatialProfile,
      adaptiveVocalRoomScale: {
        high: audioRenderer.getStemRoomSceneScale({ id: "vocals", separation: 0.95, spatialWeight: 1 }),
        low: audioRenderer.getStemRoomSceneScale({ id: "vocals", separation: 0.2, spatialWeight: 0.75 })
      },
      sceneSeparation: Object.fromEntries(
        Object.entries(graph.spatialLayer.separatedScenes || {}).map(([id, scene]) => [id, {
          vocals: scene.vocalSend.gain.value,
          instruments: scene.instrumentSend.gain.value,
          residual: scene.residualSend.gain.value,
          output: scene.output.gain.value
        }])
      ),
      instrumentPresenceEq: {
        frequency: graph.spatialLayer.instrumentPresenceEq.frequency.value,
        gain: graph.spatialLayer.instrumentPresenceEq.gain.value,
        q: graph.spatialLayer.instrumentPresenceEq.Q.value
      },
      transientControlCount: graph.spatialLayer.transientControls.length,
      compositeRendererCount: graph.spatialLayer.stemObjects.reduce((count, item) => (
        count + Number(Boolean(item.reflections.compositeRenderer)) +
        Number(Boolean(item.externalization.compositeRenderer))
      ), 0) + Number(Boolean(graph.spatialLayer.orchestralHall.compositeRenderer)) +
        Number(Boolean(graph.spatialLayer.field.compositeRenderer)),
      graphNodeCount: graph.nodes.length,
      renderedCalibration
    };
    state.stemBuffers = previous.stems;
    state.spatialSettings = previous.settings;
    state.analysis = previous.analysis;
    state.measuredBrirBuffer = previous.brir;
    state.playbackCalibration = previous.calibration;
    state.audioQualityTier = previous.quality;
    return result;
  });

  expect(metrics.finite).toBe(true);
  expect(metrics.peak).toBeGreaterThan(0.03);
  expect(metrics.peak).toBeLessThan(1);
  expect(metrics.rms).toBeGreaterThan(0.01);
  expect(metrics.monoRms).toBeGreaterThan(0.005);
  expect(metrics.balanceRatio).toBeGreaterThan(0.75);
  expect(metrics.balanceRatio).toBeLessThan(1.33);
  expect(metrics.residualRatio).toBeLessThan(1e-5);
  expect(metrics.usesOriginalAnchor).toBe(false);
  expect(metrics.phasePreserving).toBe(false);
  expect(metrics.stemSpatialProfile.vocals.roomSceneScale).toBeGreaterThanOrEqual(0.82);
  expect(metrics.stemSpatialProfile.vocals.roomSceneScale).toBeLessThan(0.90);
  expect(metrics.stemSpatialProfile.other.roomSceneScale).toBe(1);
  expect(metrics.stemSpatialProfile.drums.roomSceneScale).toBe(1);
  expect(metrics.stemSpatialProfile.bass.roomSceneScale).toBe(1);
  expect(metrics.stemSpatialProfile.vocals.directGain)
    .toBeCloseTo(metrics.stemSpatialProfile.other.directGain, 8);
  expect(metrics.stemSpatialProfile.vocals.primaryDelays).toEqual([0, 0]);
  expect(metrics.stemSpatialProfile.vocals.reflectionSend)
    .toBeLessThan(metrics.stemSpatialProfile.other.reflectionSend);
  expect(metrics.stemSpatialProfile.vocals.externalizationSend).toBeGreaterThan(0.018);
  expect(metrics.stemSpatialProfile.vocals.externalizationSend).toBeLessThan(0.021);
  expect(metrics.stemSpatialProfile.vocals.confidenceSendScale).toBeLessThanOrEqual(1);
  expect(metrics.adaptiveVocalRoomScale.low).toBeGreaterThan(metrics.adaptiveVocalRoomScale.high);
  expect(metrics.sceneSeparation.lateral.vocals).toBeLessThan(0.05);
  expect(metrics.sceneSeparation.lateral.instruments).toBe(1);
  expect(metrics.sceneSeparation.venue.vocals).toBeLessThan(metrics.sceneSeparation.venue.instruments * 0.5);
  Object.values(metrics.sceneSeparation).forEach((scene) => {
    expect(scene.output).toBeCloseTo(0.86, 4);
  });
  expect(metrics.instrumentPresenceEq.frequency).toBe(2650);
  expect(metrics.instrumentPresenceEq.gain).toBeCloseTo(-0.8, 2);
  expect(metrics.instrumentPresenceEq.q).toBeCloseTo(0.76, 2);
  expect(metrics.transientControlCount).toBe(0);
  expect(metrics.compositeRendererCount).toBe(10);
  expect(metrics.graphNodeCount).toBeLessThan(200);
  expect(metrics.stemSpatialProfile.other.lateralEarlyScale).toBe(1.16);
  expect(metrics.stemSpatialProfile.drums.lateralEarlyScale).toBe(1.1);
  expect(metrics.externalizationTaps).toBe(24);
  expect(metrics.loudnessMatchGain).toBeGreaterThanOrEqual(0.82);
  expect(metrics.loudnessMatchGain).toBeLessThanOrEqual(1);
  expect(metrics.truePeakHeadroomGain).toBe(1);
  expect(metrics.renderedCalibration.gain).toBeGreaterThanOrEqual(0.5);
  expect(metrics.renderedCalibration.gain).toBeLessThanOrEqual(4.5);
  expect(Math.abs(metrics.renderedCalibration.levelErrorDb)).toBeLessThan(0.01);
  expect(metrics.renderedCalibration.renderedPeak).toBeCloseTo(metrics.peak, 6);
});

test("keeps the phase-safe Full Spatial fallback stable at 44.1 and 96 kHz", async ({ page, browserName }) => {
  test.skip(browserName === "webkit", "Windows WebKit does not complete native-HRTF OfflineAudioContext rendering.");
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const previous = {
      analysis: state.analysis,
      stemBuffers: state.stemBuffers,
      measuredBrirBuffer: state.measuredBrirBuffer,
      quality: state.audioQualityTier,
      calibration: state.playbackCalibration
    };
    const rendered = [];
    for (const sampleRate of [44100, 96000]) {
      const frameCount = Math.round(sampleRate * 0.12);
      const context = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, frameCount, sampleRate);
      const sourceBuffer = context.createBuffer(2, frameCount, sampleRate);
      const left = sourceBuffer.getChannelData(0);
      const right = sourceBuffer.getChannelData(1);
      for (let index = 0; index < frameCount; index += 1) {
        const time = index / sampleRate;
        left[index] = Math.sin(2 * Math.PI * 440 * time) * 0.19 + Math.sin(2 * Math.PI * 71 * time) * 0.07;
        right[index] = Math.sin(2 * Math.PI * 440 * time + 0.18) * 0.17 + Math.sin(2 * Math.PI * 71 * time) * 0.07;
      }
      state.analysis = {
        mix: { peakDb: -12, rmsDb: -24, approxLufs: -23, integratedLufs: -23, estimatedTruePeakDb: -11.8 },
        stereoImage: { width: 0.38 }
      };
      state.stemBuffers = null;
      state.measuredBrirBuffer = null;
      state.audioQualityTier = "safe";
      state.playbackCalibration = { estimatedTruePeakDb: -11.8, approxLufs: -23, sampleRate };
      const graph = createSpatialPlaybackGraph(context, sourceBuffer, state.analysis);
      startGraphSources(graph, 0);
      const output = await context.startRendering();
      const outputLeft = output.getChannelData(0);
      const outputRight = output.getChannelData(1);
      let peak = 0;
      let energy = 0;
      let difference = 0;
      for (let index = 0; index < output.length; index += 1) {
        const l = outputLeft[index];
        const r = outputRight[index];
        peak = Math.max(peak, Math.abs(l), Math.abs(r));
        energy += l * l + r * r;
        difference += (l - r) * (l - r);
      }
      rendered.push({
        sampleRate,
        finite: outputLeft.every(Number.isFinite) && outputRight.every(Number.isFinite),
        peak,
        rms: Math.sqrt(energy / Math.max(1, output.length * 2)),
        stereoDifference: Math.sqrt(difference / Math.max(1, output.length))
      });
    }
    state.analysis = previous.analysis;
    state.stemBuffers = previous.stemBuffers;
    state.measuredBrirBuffer = previous.measuredBrirBuffer;
    state.audioQualityTier = previous.quality;
    state.playbackCalibration = previous.calibration;
    return rendered;
  });

  for (const result of results) {
    expect(result.finite, `${result.sampleRate} Hz finite`).toBe(true);
    expect(result.peak, `${result.sampleRate} Hz peak`).toBeLessThan(1);
    expect(result.rms, `${result.sampleRate} Hz rms`).toBeGreaterThan(0.015);
    expect(result.stereoDifference, `${result.sampleRate} Hz stereo`).toBeGreaterThan(0.002);
  }
});

test("level-matches Original without spatial processing while stem displays stay idle", async ({ page, browserName }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await page.route("**/api/analyze?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createAnalysisFixture({ demucsCompleted: true }))
    });
  });
  await page.route("**/outputs/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "audio/wav",
      body: createToneWav()
    });
  });

  await page.goto("/");
  const filePath = testInfo.outputPath("original-stem-tone.wav");
  fs.writeFileSync(filePath, createToneWav());
  await page.locator("#audio-file").setInputFiles(filePath);
  await expect(page.locator("#export-button")).toBeEnabled();

  await page.getByRole("button", { name: "Original" }).click();

  await page.locator("#play-button").click();
  await page.waitForTimeout(500);
  const originalGraph = await page.evaluate(() => ({
    hasDeviceCorrection: Object.prototype.hasOwnProperty.call(state.playback.graph || {}, "deviceCorrection"),
    outputGainScale: state.playback.graph?.outputGainScale,
    expectedGain: state.spatialOutputCalibration?.originalMatchGain,
    hasCompressor: state.playback.graph?.nodes.some((node) => node instanceof DynamicsCompressorNode),
    mode: state.playback.graph?.mode
  }));
  expect(originalGraph.hasDeviceCorrection).toBe(false);
  expect(originalGraph.hasCompressor).toBe(false);
  expect(originalGraph.mode).toBe("original");
  expect(originalGraph.expectedGain).toBeGreaterThan(0);
  expect(originalGraph.outputGainScale).toBeCloseTo(originalGraph.expectedGain, 6);
  let levels = await page.evaluate(() => ({
    row: Number.parseFloat(document.querySelector(".instrument-row[data-id='other']")?.style.getPropertyValue("--level") || "0"),
    field: Number.parseFloat(document.querySelector(".stage-node[data-id='other']")?.style.getPropertyValue("--level") || "0")
  }));
  expect(levels.row).toBeLessThanOrEqual(0.01);
  expect(levels.field).toBeLessThanOrEqual(0.01);

  // Headless Firefox는 출력 오디오 클록이 정지할 수 있어 실시간 analyser 전환은 Chromium에서 검증한다.
  if (browserName !== "firefox") {
    await page.getByRole("button", { name: "Spatial" }).click();
    await page.waitForFunction(() => {
      const row = document.querySelector(".instrument-row[data-id='other']");
      const node = document.querySelector(".stage-node[data-id='other']");
      const rowLevel = Number.parseFloat(row?.style.getPropertyValue("--level") || "0");
      const nodeLevel = Number.parseFloat(node?.style.getPropertyValue("--level") || "0");
      return rowLevel > 0.02 && nodeLevel > 0.02;
    }, null, { timeout: 8000 });

    levels = await page.evaluate(() => ({
      row: Number.parseFloat(document.querySelector(".instrument-row[data-id='other']")?.style.getPropertyValue("--level") || "0"),
      field: Number.parseFloat(document.querySelector(".stage-node[data-id='other']")?.style.getPropertyValue("--level") || "0")
    }));
    expect(levels.row).toBeGreaterThan(0.02);
    expect(levels.field).toBeGreaterThan(0.02);

    await page.getByRole("button", { name: "Original" }).click();
    await page.waitForFunction(() => {
      const row = document.querySelector(".instrument-row[data-id='other']");
      const node = document.querySelector(".stage-node[data-id='other']");
      const rowLevel = Number.parseFloat(row?.style.getPropertyValue("--level") || "0");
      const nodeLevel = Number.parseFloat(node?.style.getPropertyValue("--level") || "0");
      return rowLevel <= 0.01 && nodeLevel <= 0.01;
    }, null, { timeout: 8000 });
  }

  const relevantErrors = errors().filter((message) => !(browserName === "firefox" && message === "JSHandle@object"));
  expect(relevantErrors).toEqual([]);
});

test("fixes cards at whole-song positions and shows every stem without internal scrolling", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await page.goto("/");
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await page.evaluate((fixture) => {
    fixture.file.duration = 2;
    state.analysis = fixture;
    const context = new OfflineAudioContext(2, 48000, 24000);
    state.stemBuffers = Object.fromEntries(Object.values(STEM_PROFILES).map((profile, index) => {
      const buffer = context.createBuffer(2, 48000, 24000);
      for (let frame = 0; frame < buffer.length; frame += 1) {
        const pan = profile.id === "vocals" ? 0 : (frame / buffer.length * 1.2 - 0.6 +
          (profile.id === "piano" ? 0.25 : 0));
        const sample = Math.sin(2 * Math.PI * (220 + index * 110) * frame / 24000) * 0.1;
        buffer.getChannelData(0)[frame] = sample * Math.sqrt((1 - pan) / 2);
        buffer.getChannelData(1)[frame] = sample * Math.sqrt((1 + pan) / 2);
      }
      return [profile.id, { ...profile, kind: "stem", active: true, buffer,
        stereoPosition: analyzeStemStereoPosition(buffer) }];
    }));
    studioView.renderAnalysis(fixture);
    studioView.updateStagePositions(0.1, { immediate: true });
  }, createAnalysisFixture());
  const card = page.locator('.stage-node[data-id="piano"]');
  const before = await card.evaluate((node) => parseFloat(node.style.left));
  expect(Number(await card.getAttribute("data-pan"))).toBeCloseTo(0.25, 2);
  const beforeBounds = await card.boundingBox();
  await page.evaluate(() => {
    state.playback.playing = true;
    studioView.updateRealtimeDisplay(1.8);
    studioView.updateSoundFieldDisplay(1.8, { piano: 1 });
    studioView.updateStagePositions();
    state.playback.playing = false;
  });
  const after = await card.evaluate((node) => parseFloat(node.style.left));
  expect(after).toBe(before);
  expect(await card.boundingBox()).toEqual(beforeBounds);
  expect(await page.locator('.stage-node[data-id="vocals"]').evaluate((node) => parseFloat(node.style.left)))
    .toBeCloseTo(50, 1);
  await expect(page.locator("#stage-map svg")).toHaveCount(0);
  // Cluster all measured sources in the centre to exercise label collision handling.
  await page.evaluate(() => {
    Object.values(state.stemBuffers).forEach((stem) => {
      stem.stereoPosition.pan = 0;
      stem.stereoPosition.panCurve = [0, 0];
    });
  });
  for (const width of [1480, 1180, 700, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => studioView.updateStagePositions(0, { immediate: true }));
    const layout = await page.evaluate(() => {
      const field = document.querySelector("#stage-map").getBoundingClientRect();
      const nodes = [...document.querySelectorAll(".stage-node")].map((node) => node.getBoundingClientRect());
      const overlaps = nodes.flatMap((a, index) => nodes.slice(index + 1).filter((b) =>
        Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 &&
        Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2));
      const rows = [...document.querySelectorAll(".instrument-row")];
      const list = document.querySelector("#instrument-list");
      const listBounds = list.getBoundingClientRect();
      return {
        listScroll: list.scrollHeight > list.clientHeight + 1,
        clippedRows: rows.some((row) => row.getBoundingClientRect().bottom > listBounds.bottom),
        overlaps: overlaps.length,
        outside: nodes.some((node) => node.left < field.left || node.right > field.right ||
          node.top < field.top || node.bottom > field.bottom),
        overflow: rows.some((row) => row.scrollWidth > row.clientWidth + 1 || row.scrollHeight > row.clientHeight + 1),
        textOutside: rows.some((row) => {
          const bounds = row.getBoundingClientRect();
          return [...row.querySelectorAll("strong, .stem-copy span, em")].some((text) => {
            const rect = text.getBoundingClientRect();
            return rect.left < bounds.left || rect.right > bounds.right || rect.bottom > bounds.bottom;
          });
        })
      };
    });
    expect(layout, `layout at ${width}px`).toEqual({ overlaps: 0, outside: false, overflow: false,
      textOutside: false, listScroll: false, clippedRows: false });
    if (width === 1480 || width === 375) {
      await page.locator(".analysis-grid").first().screenshot({ path: testInfo.outputPath(`analysis-${width}.png`) });
    }
  }
  expect(errors()).toEqual([]);
});

test("switches audible output and ignores stale or stopped transitions", async ({ page, browserName }) => {
  const errors = collectBrowserErrors(page);
  await page.goto("/");
  await page.evaluate(async (fixture) => {
    const context = await ensureAudioContext();
    fixture.file.duration = 12;
    state.analysis = fixture;
    state.file = { name: "mode-switch.wav" };
    const tone = (frequency) => {
      const buffer = context.createBuffer(2, context.sampleRate * 12, context.sampleRate);
      for (let channel = 0; channel < 2; channel += 1) {
        const data = buffer.getChannelData(channel);
        for (let index = 0; index < data.length; index += 1) {
          data[index] = 0.1 * Math.sin(2 * Math.PI * frequency * index / context.sampleRate);
        }
      }
      return buffer;
    };
    state.audioBuffer = tone(440);
    state.stemBuffers = null;
    studioView.renderAnalysis(fixture);
    refs.playButton.disabled = false;
    refs.stopButton.disabled = false;
    const analyser = context.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0;
    const sink = context.createGain();
    sink.gain.value = 0;
    analyser.connect(sink).connect(context.destination);
    const factory = createPlaybackGraph;
    window.__modeGraphs = [];
    createPlaybackGraph = (...args) => {
      const graph = factory(...args);
      graph.master.connect(analyser);
      window.__modeGraphs.push(graph);
      return graph;
    };
    window.__outputModeTone = () => {
      const data = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(data);
      const band = (frequency) => {
        const bin = Math.round(frequency / context.sampleRate * analyser.fftSize);
        return Math.max(...data.slice(bin - 2, bin + 3));
      };
      return band(1200) - band(440);
    };
    window.__outputPeak = () => {
      const samples = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(samples);
      return Math.max(...samples.map(Math.abs));
    };
  }, createAnalysisFixture());
  await page.getByRole("button", { name: "Original", exact: true }).click();
  await page.locator("#play-button").click();
  await expect.poll(() => page.evaluate(() => state.playback.graph?.mode)).toBe("original");
  if (browserName !== "firefox") {
    await expect.poll(() => page.evaluate(() => window.__outputModeTone())).toBeLessThan(-30);
  }
  await page.locator('[data-mode="spatial"]').click();
  await expect.poll(() => page.evaluate(() => state.playback.graph?.mode)).toBe("spatial");
  if (browserName !== "firefox") {
    await expect.poll(() => page.evaluate(() => window.__outputPeak())).toBeGreaterThan(0.00001);
  }
  // Multiple requests within the same event loop must collapse to the final mode.
  await page.evaluate(() => {
    for (const mode of ["original", "spatial", "original", "spatial", "original"]) {
      document.querySelector(`[data-mode="${mode}"]`).click();
    }
  });
  await expect.poll(() => page.evaluate(() => state.playback.graph?.mode)).toBe("original");
  if (browserName !== "firefox") {
    await expect.poll(() => page.evaluate(() => window.__outputModeTone())).toBeLessThan(-30);
  }
  // Interrupt successive fades rather than waiting for the previous one to end.
  await page.evaluate(async () => {
    for (const mode of ["spatial", "original", "spatial", "original"]) {
      document.querySelector(`[data-mode="${mode}"]`).click();
      await new Promise((resolve) => setTimeout(resolve, 35));
    }
  });
  await expect.poll(() => page.evaluate(() => state.playback.graph?.mode)).toBe("original");
  if (browserName !== "firefox") {
    await expect.poll(() => page.evaluate(() => window.__outputModeTone())).toBeLessThan(-30);
  }
  // Stop while both incoming and outgoing graphs are still fading.
  await page.locator('[data-mode="spatial"]').click();
  await expect.poll(() => page.evaluate(() => state.playback.graph?.mode)).toBe("spatial");
  await page.locator("#stop-button").click();
  await expect.poll(() => page.evaluate(() => window.__outputPeak())).toBeLessThan(0.000001);
  await page.waitForTimeout(650);
  expect(await page.evaluate(() => ({ peak: window.__outputPeak(),
    graphs: state.playback.graphs.size, output: state.playback.output.gain.value })))
    .toEqual({ peak: 0, graphs: 0, output: 0 });
  await page.locator("#play-button").click();
  await expect.poll(() => page.evaluate(() => state.playback.graph?.mode)).toBe("spatial");
  if (browserName !== "firefox") {
    await expect.poll(() => page.evaluate(() => window.__outputPeak())).toBeGreaterThan(0.05);
  }
  // A rebuild waiting for AudioContext must not start sound after Stop.
  await page.evaluate(() => {
    window.__contextOriginal = ensureAudioContext;
    ensureAudioContext = () => new Promise((resolve) => {
      window.__releaseModeContext = () => resolve(state.audioContext);
    });
    document.querySelector('[data-mode="original"]').click();
    stopPlayback();
    window.__releaseModeContext();
    ensureAudioContext = window.__contextOriginal;
  });
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => ({ playing: state.playback.playing, graph: state.playback.graph,
    liveGraphs: window.__modeGraphs.filter((graph) => !graph.disposed).length })))
    .toEqual({ playing: false, graph: null, liveGraphs: 0 });
  // A pending Play must also remain cancelled after its context becomes ready.
  await page.evaluate(async () => {
    ensureAudioContext = () => new Promise((resolve) => {
      window.__releasePlayContext = () => resolve(state.audioContext);
    });
    const pendingPlay = startPlayback();
    stopPlayback();
    window.__releasePlayContext();
    ensureAudioContext = window.__contextOriginal;
    await pendingPlay;
  });
  expect(await page.evaluate(() => ({ playing: state.playback.playing,
    graphs: state.playback.graphs.size, output: state.playback.output.gain.value })))
    .toEqual({ playing: false, graphs: 0, output: 0 });
  // A failure after sources start must still clean up their audible output.
  await page.evaluate(async () => {
    const startSources = startGraphSources;
    startGraphSources = (...args) => {
      startSources(...args);
      throw new Error("simulated partial start failure");
    };
    try {
      await startPlayback();
    } catch (error) {
      if (error.message !== "simulated partial start failure") throw error;
    } finally {
      startGraphSources = startSources;
    }
  });
  await expect.poll(() => page.evaluate(() => window.__outputPeak())).toBeLessThan(0.000001);
  expect(await page.evaluate(() => ({ playing: state.playback.playing,
    graphs: state.playback.graphs.size, output: state.playback.output.gain.value })))
    .toEqual({ playing: false, graphs: 0, output: 0 });
  expect(errors()).toEqual([]);
});

function collectBrowserErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  return () => errors;
}

function createToneWav(sampleRate = 44100, durationSeconds = 1.25) {
  const frameCount = Math.floor(sampleRate * durationSeconds);
  const bytesPerSample = 2;
  const dataSize = frameCount * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let index = 0; index < frameCount; index += 1) {
    const t = index / sampleRate;
    const envelope = Math.min(1, index / 800) * Math.min(1, (frameCount - index) / 800);
    const sample = Math.sin(2 * Math.PI * 440 * t) * 0.35 * envelope;
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + index * bytesPerSample);
  }
  return buffer;
}

function createAnalysisFixture(options = {}) {
  const curve = Array.from({ length: 72 }, (_, index) => 0.18 + Math.sin(index / 8) * 0.08);
  const waveform = Array.from({ length: 120 }, (_, index) => Math.abs(Math.sin(index / 9)) * 0.85 + 0.05);
  const stereoImage = createStereoImageFixture(options.stereoRight);
  const instrumentBase = {
    active: true,
    confidence: 0.76,
    peak: 0.88,
    mean: 0.32,
    curve,
    displayCurve: curve,
    q: 0.8
  };
  return {
    jobId: "test-job",
    cacheKey: "test-cache",
    file: {
      name: "tone.wav",
      sampleRate: 44100,
      channels: options.stereoRight ? 2 : 1,
      duration: 1.25
    },
    models: {
      primary: "Playwright fixture",
      features: "fixture",
      deepSeparator: {
        name: "Demucs / Hybrid Transformer Demucs fine-tuned",
        model: "htdemucs_ft",
        qualityProfile: "spatial-q3-adaptive6",
        postprocess: "softmask-v2-hybrid",
        settings: {
          profile: "spatial-q3-adaptive6",
          postprocess: "softmask-v2-hybrid",
          device: "cuda",
          shifts: 2,
          overlap: 0.36,
          segment: 7,
          jobs: 1
        },
        available: true,
        requested: true,
        status: options.demucsCompleted ? "completed" : "ready",
        cached: Boolean(options.demucsCompleted),
        stems: options.demucsCompleted
          ? [
              "_cache/demucs/test/vocals.wav",
              ...(options.adaptiveSix ? [
                "_cache/demucs/test/guitar.wav",
                "_cache/demucs/test/piano.wav"
              ] : []),
              "_cache/demucs/test/other.wav",
              "_cache/demucs/test/drums.wav",
              "_cache/demucs/test/bass.wav"
            ]
          : [],
        stemQuality: options.demucsCompleted
          ? {
              vocals: { separation: 0.78, spatialWeight: 0.98 },
              ...(options.adaptiveSix ? {
                guitar: { separation: 0.76, spatialWeight: 0.98, hybridConfidence: 0.72, adaptivelyAccepted: true },
                piano: { separation: 0.7, spatialWeight: 0.94, hybridConfidence: 0.66, adaptivelyAccepted: true }
              } : {}),
              other: { separation: 0.74, spatialWeight: 0.96 },
              drums: { separation: 0.82, spatialWeight: 1.02 },
              bass: { separation: 0.8, spatialWeight: 1 }
            }
          : {}
      },
      notes: []
    },
    timeline: {
      times: [0, 0.5, 1.0, 1.25],
      rms: [0.1, 0.7, 0.5, 0.1],
      onset: [0.05, 0.8, 0.4, 0.05],
      centroid: [0.4, 0.58, 0.5, 0.38]
    },
    waveform,
    tempo: { bpm: 92, confidence: 0.76 },
    key: { label: "C major", confidence: 0.64 },
    mix: {
      rmsDb: -18.6,
      approxLufs: -19.4,
      peakDb: -3.2,
      crestDb: 15.4,
      centroidHz: 1280,
      rolloffHz: 5200,
      flatness: 0.18,
      zcr: 0.08
    },
    stereoImage,
    instruments: [
      {
        ...instrumentBase,
        id: "violins1",
        label: "1st Violins",
        family: "strings",
        position: { x: -2.6, y: 0.1, z: -1.6 },
        freq: 2300,
        color: "#78a95d",
        stereo: stereoImage.instruments.violins1 || createMonoStereoFixture()
      },
      {
        ...instrumentBase,
        id: "piano",
        label: "Piano",
        family: "keyboard",
        position: { x: -1.2, y: 0.1, z: -2.8 },
        freq: 1250,
        color: "#d6c4a0",
        stereo: stereoImage.instruments.piano || createMonoStereoFixture()
      },
      {
        ...instrumentBase,
        id: "flute",
        label: "Flute",
        family: "woodwinds",
        position: { x: 0.8, y: 0.2, z: -3.1 },
        freq: 3600,
        color: "#a9c9a2",
        stereo: stereoImage.instruments.flute || createMonoStereoFixture()
      },
      {
        ...instrumentBase,
        id: "basses",
        label: "Double Basses",
        family: "strings",
        active: false,
        position: { x: 2.5, y: 0, z: -1.4 },
        freq: 115,
        color: "#a07058",
        stereo: stereoImage.instruments.basses || createMonoStereoFixture()
      }
    ],
    activeIds: ["violins1", "piano", "flute"],
    sections: [
      { start: 0, end: 0.62, energy: 0.58, brightness: 0.46, density: 0.34 },
      { start: 0.62, end: 1.25, energy: 0.72, brightness: 0.55, density: 0.48 }
    ],
    recommendations: [
      "Playwright fixture recommendation"
    ]
  };
}

function createStereoImageFixture(stereoRight = false) {
  if (!stereoRight) {
    return {
      status: "mono",
      pan: 0,
      width: 0,
      correlation: 1,
      confidence: 0,
      instruments: {}
    };
  }
  const ids = ["violins1", "piano", "flute", "basses"];
  const instruments = Object.fromEntries(ids.map((id) => [id, {
    pan: 0.9,
    width: 0.42,
    confidence: 0.95,
    energy: 0.82,
    panCurve: Array.from({ length: 72 }, () => 0.9)
  }]));
  return {
    status: "stereo",
    pan: 0.72,
    width: 0.42,
    correlation: 0.54,
    confidence: 0.9,
    instruments
  };
}

function createMonoStereoFixture() {
  return {
    pan: 0,
    width: 0,
    confidence: 0,
    energy: 0,
    panCurve: []
  };
}

test("automatically applies the universal HRTF and concert-hall BRIR", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("#hrtf-profile-control")).toHaveCount(0);
  await expect(page.locator("#brir-profile-control")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => state.hrtfProfileId)).toBe("sadie-kemar");
  await expect.poll(() => page.evaluate(() => state.brirProfileId)).toBe("aula");
  await expect(page.locator("#spatial-quality-status, #spatial-cache-status")).toHaveCount(0);

  const quality = await page.evaluate(() => {
    const context = new AudioContext({ sampleRate: 48000 });
    const buffer = context.createBuffer(2, 48000, 48000);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    for (let index = 0; index < left.length; index += 1) {
      const value = Math.sin(2 * Math.PI * 1000 * index / 48000) * 0.2;
      left[index] = value;
      right[index] = value * 0.92 + Math.sin(2 * Math.PI * 3300 * index / 48000) * 0.03;
    }
    const coherence = window.SpatialAudioQuality.analyzeMultibandCoherence(buffer);
    const safety = window.SpatialAudioQuality.buildSafetyProfile(coherence);
    const impulse = context.createBuffer(2, 48000, 48000);
    for (let index = 0; index < impulse.length; index += 1) {
      const decay = Math.exp(-index / 9000);
      impulse.getChannelData(0)[index] = (index === 0 ? 0.5 : Math.sin(index * 0.31) * decay * 0.02);
      impulse.getChannelData(1)[index] = (index === 2 ? 0.46 : Math.sin(index * 0.37) * decay * 0.018);
    }
    const impulseMetrics = window.SpatialAudioQuality.analyzeBinauralResponse(impulse);
    context.close();
    return {
      bands: coherence.bands.length,
      average: coherence.averageCorrelation,
      gains: Object.values(safety.bandGains),
      impulseMetrics: {
        edt: impulseMetrics.edtSeconds,
        t20: impulseMetrics.t20Seconds,
        iaccLate: impulseMetrics.iaccLate,
        listenerEnvelopment: impulseMetrics.listenerEnvelopment,
        bandIds: Object.keys(impulseMetrics.bandIacc)
      },

    };
  });

  expect(quality.bands).toBe(5);
  expect(quality.average).toBeGreaterThan(-1);
  expect(quality.gains.every((gain) => gain >= 0.38 && gain <= 1.08)).toBeTruthy();
  expect(Number.isFinite(quality.impulseMetrics.edt)).toBeTruthy();
  expect(Number.isFinite(quality.impulseMetrics.t20)).toBeTruthy();
  expect(quality.impulseMetrics.iaccLate).toBeGreaterThanOrEqual(-1);
  expect(quality.impulseMetrics.iaccLate).toBeLessThanOrEqual(1);
  expect(quality.impulseMetrics.listenerEnvelopment).toBeGreaterThanOrEqual(0);
  expect(quality.impulseMetrics.listenerEnvelopment).toBeLessThanOrEqual(1);
  expect(quality.impulseMetrics.bandIds).toEqual(["low", "mid", "high"]);


});

test("provides a hidden-reference MUSHRA session and persists completed results", async ({ page }) => {
  await page.goto("/mushra");
  const result = await page.evaluate(() => {
    const record = {
      schema: "SpatialAudioEssential.ListeningTest/2.0",
      sessionId: "playwright",
      completedAt: new Date().toISOString(),
      samples: []
    };
    persistListeningTestResult(record);
    const history = JSON.parse(localStorage.getItem("spatial-audio-essential-listening-history") || "[]");
    return {
      anchorBuilder: typeof createLowpassAnchor,
      encoder: typeof encodeMushraWave,
      storedSchema: history[0]?.schema,
      storedSession: history[0]?.sessionId
    };
  });
  expect(result).toEqual({
    anchorBuilder: "function",
    encoder: "function",
    storedSchema: "SpatialAudioEssential.ListeningTest/2.0",
    storedSession: "playwright"
  });
});


test("does not add a coherent opposite-polarity copy of recorded side cues", async ({ page }) => {
  await page.goto("/");
  const metrics = await page.evaluate(async () => {
    const results = [];
    for (const sampleRate of [44100, 96000]) {
      for (const frequency of [50, 3000]) {
        const context = new OfflineAudioContext(2, sampleRate / 2, sampleRate);
        const buffer = context.createBuffer(2, sampleRate / 2, sampleRate);
        for (let index = 0; index < buffer.length; index += 1) {
          const mid = 0.1 * Math.sin(2 * Math.PI * 440 * index / sampleRate);
          const side = 0.03 * Math.sin(2 * Math.PI * frequency * index / sampleRate);
          buffer.getChannelData(0)[index] = mid + side;
          buffer.getChannelData(1)[index] = mid - side;
        }
        const source = context.createBufferSource();
        source.buffer = buffer;
        const layer = audioRenderer.createLateralSideExpansionLayer(context, source, context.destination, {
          analysis: { stereoImage: { width: 0.36 } }
        });
        // Isolate the recorded-side branch from the separate ambience generator.
        layer.decorrelator.disconnect();
        source.connect(context.destination);
        source.start();
        const rendered = await context.startRendering();
        let monoError = 0;
        let inputSideEnergy = 0;
        let outputSideEnergy = 0;
        let addedSideEnergy = 0;
        let firstAddedFrame = -1;
        for (let index = 0; index < buffer.length; index += 1) {
          const inputL = buffer.getChannelData(0)[index];
          const inputR = buffer.getChannelData(1)[index];
          const l = rendered.getChannelData(0)[index];
          const r = rendered.getChannelData(1)[index];
          const inputSide = (inputL - inputR) / 2;
          const outputSide = (l - r) / 2;
          monoError = Math.max(monoError, Math.abs((l + r - inputL - inputR) / 2));
          if (firstAddedFrame < 0 && Math.abs(outputSide - inputSide) > 1e-6) firstAddedFrame = index;
          if (index > sampleRate / 10) {
            inputSideEnergy += inputSide ** 2;
            outputSideEnergy += outputSide ** 2;
            addedSideEnergy += (outputSide - inputSide) ** 2;
          }
        }
        results.push({ sampleRate, frequency, monoError, firstAddedFrame,
          sideRatio: Math.sqrt(outputSideEnergy / inputSideEnergy),
          addedSideRatio: Math.sqrt(addedSideEnergy / inputSideEnergy) });
        layer.nodes.forEach((node) => node.disconnect());
      }
    }
    return results;
  });
  for (const result of metrics) {
    expect(result.monoError).toBeLessThan(1e-7);
    expect(result.firstAddedFrame).toBe(-1);
    expect(result.sideRatio).toBeCloseTo(1, 6);
    expect(result.addedSideRatio).toBeLessThan(0.000001);
  }
});

test("preserves instrument and vocal direct samples when expanding room width", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    await ensureUniversalHrtfProfile();
    const sampleRate = 48000;
    const length = sampleRate;
    const analysis = { mix: { peakDb: -12, rmsDb: -25 }, stereoImage: { width: 0.36 } };
    state.analysis = analysis;
    state.spatialOutputCalibration = null;
    state.playbackCalibration = { estimatedTruePeakDb: -12, approxLufs: -25, sampleRate };
    state.audioQualityTier = "full";
    const render = async (width, vocalOnly = false) => {
      const context = new OfflineAudioContext(2, length, sampleRate);
      const reference = context.createBuffer(2, length, sampleRate);
      state.stemBuffers = Object.fromEntries(["vocals", "other", "drums", "bass"].map((id) => [id, {
        id, separation: 1, spatialWeight: 1,
        buffer: context.createBuffer(2, length, sampleRate)
      }]));
      for (let channel = 0; channel < 2; channel += 1) {
        for (let index = 0; index < length; index += 1) {
          const time = index / sampleRate;
          const polarity = channel === 0 ? 1 : -1;
          const vocal = 0.04 * Math.sin(2 * Math.PI * 440 * time) +
            (vocalOnly ? polarity * 0.003 * Math.sin(2 * Math.PI * 1400 * time) : 0);
          const instrument = vocalOnly ? 0 : 0.015 * Math.sin(2 * Math.PI * 900 * time) +
            polarity * (0.012 * Math.sin(2 * Math.PI * 3000 * time) +
              0.012 * Math.sin(2 * Math.PI * 50 * time));
          state.stemBuffers.vocals.buffer.getChannelData(channel)[index] = vocal;
          state.stemBuffers.other.buffer.getChannelData(channel)[index] = instrument;
          reference.getChannelData(channel)[index] = vocal + instrument;
        }
      }
      const graph = createSpatialPlaybackGraph(context, reference, analysis, { stageWidth: width });
      // The width stage belongs exclusively to the room return.
      graph.spatialLayer.wetMaster.gain.value = 0;
      startGraphSources(graph, 0);
      const rendered = await context.startRendering();
      const sideAmplitude = (frequency) => {
        let real = 0, imaginary = 0;
        for (let index = sampleRate / 2; index < length; index += 1) {
          const side = (rendered.getChannelData(0)[index] - rendered.getChannelData(1)[index]) / 2;
          const phase = 2 * Math.PI * frequency * index / sampleRate;
          real += side * Math.cos(phase);
          imaginary += side * Math.sin(phase);
        }
        return Math.hypot(real, imaginary);
      };
      const output = { left: Float32Array.from(rendered.getChannelData(0)),
        right: Float32Array.from(rendered.getChannelData(1)),
        treble: sideAmplitude(3000), bass: sideAmplitude(50) };
      disconnectGraph(graph);
      return output;
    };
    const baseline = await render(1);
    const expanded = await render();
    const voiceBefore = await render(1, true);
    const voiceAfter = await render(2, true);
    let monoError = 0, voiceError = 0, peak = 0;
    for (let index = 0; index < length; index += 1) {
      monoError = Math.max(monoError, Math.abs((expanded.left[index] + expanded.right[index] -
        baseline.left[index] - baseline.right[index]) / 2));
      voiceError = Math.max(voiceError, Math.abs(voiceBefore.left[index] - voiceAfter.left[index]),
        Math.abs(voiceBefore.right[index] - voiceAfter.right[index]));
      peak = Math.max(peak, Math.abs(expanded.left[index]), Math.abs(expanded.right[index]));
    }
    return { sideRatio: expanded.treble / baseline.treble,
      bassRatio: expanded.bass / baseline.bass, monoError, voiceError, peak };
  });
  expect(result.sideRatio).toBeGreaterThan(0.9999);
  expect(result.sideRatio).toBeLessThan(1.0001);
  expect(result.bassRatio).toBeGreaterThan(0.98);
  expect(result.bassRatio).toBeLessThan(1.02);
  expect(result.monoError).toBeLessThan(2e-7);
  expect(result.voiceError).toBeLessThan(1e-7);
  expect(result.peak).toBeLessThan(0.5);
});
