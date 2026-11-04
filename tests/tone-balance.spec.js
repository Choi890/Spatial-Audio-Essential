const { test, expect } = require("@playwright/test");
const fs = require("node:fs");

test("retains bass and vocal presence at common sample rates", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  const results = await page.evaluate(async () => {
    await ensureUniversalHrtfProfile();
    const results = [];
    for (const rate of [44100, 96000]) {
      const length = rate * 2, frequencies = [64, 1024, 4096];
      const context = new OfflineAudioContext(2, length, rate);
      const buffer = context.createBuffer(2, length, rate);
      for (let channel = 0; channel < 2; channel++) {
        const samples = buffer.getChannelData(channel);
        for (let i = 0; i < length; i++) samples[i] = frequencies.reduce((sum, f) => sum + 0.02 * Math.sin(2 * Math.PI * f * i / rate), 0);
      }
      state.analysis = {mix: {peakDb: -20, rmsDb: -28}, stereoImage: {width: 0}};
      state.stemBuffers = null;
      state.measuredBrirBuffer = null;
      state.playbackCalibration = {estimatedTruePeakDb: -20, approxLufs: -28, sampleRate: rate};
      state.spatialOutputCalibration = await calibrateSpatialProcessedOutput(buffer, state.analysis, {fast: true});
      const graph = createSpatialPlaybackGraph(context, buffer, state.analysis);
      startGraphSources(graph, 0);
      const rendered = await context.startRendering();
      const amplitude = (audio, frequency) => {
        let energy = 0;
        for (let channel = 0; channel < 2; channel++) {
          const samples = audio.getChannelData(channel);
          let real = 0, imaginary = 0;
          for (let i = rate; i < length; i++) {
            const phase = 2 * Math.PI * frequency * i / rate;
            real += samples[i] * Math.cos(phase); imaginary += samples[i] * Math.sin(phase);
          }
          energy += real * real + imaginary * imaginary;
        }
        return Math.sqrt(energy);
      };
      const gains = frequencies.map(f => 20 * Math.log10(amplitude(rendered, f) / amplitude(buffer, f)));
      results.push({rate, bass: gains[0] - gains[1], presence: gains[2] - gains[1]});
      disconnectGraph(graph);
    }
    return results;
  });
  for (const result of results) {
    expect(result.bass, JSON.stringify(result)).toBeGreaterThan(-0.5);
    expect(result.bass, JSON.stringify(result)).toBeLessThan(0.5);
    expect(result.presence, JSON.stringify(result)).toBeGreaterThan(0.4);
    expect(result.presence, JSON.stringify(result)).toBeLessThan(1.4);
  }
});

test("preserves the program spectrum across stereo images and stem availability", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.goto("/");
  const measurements = await page.evaluate(async () => {
    await ensureUniversalHrtfProfile();
    const sampleRate = 48000;
    const length = sampleRate * 2;
    const frequencies = [32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 12000];
    const results = [];
    state.analysis = { mix: { peakDb: -15, rmsDb: -25 }, stereoImage: { width: 0.4 } };
    state.spatialOutputCalibration = null;
    state.playbackCalibration = { estimatedTruePeakDb: -15, approxLufs: -25, sampleRate };
    state.audioQualityTier = "full";
    const decodeContext = new OfflineAudioContext(2, 1, sampleRate);
    const brirBytes = await fetch(DEFAULT_MEASURED_BRIR_URL).then((response) => response.arrayBuffer());
    const brir = await decodeContext.decodeAudioData(brirBytes);
    for (const measuredRoom of [false, true]) {
      state.measuredBrirBuffer = measuredRoom ? brir : null;
      for (const stereo of [false, true]) {
        for (const stems of [false, true]) {
          const context = new OfflineAudioContext(2, length, sampleRate);
          const buffer = context.createBuffer(2, length, sampleRate);
          for (let channel = 0; channel < 2; channel += 1) {
            const data = buffer.getChannelData(channel);
            for (let index = 0; index < length; index += 1) {
              data[index] = frequencies.reduce((sum, frequency, band) => sum + 0.008 *
                Math.sin(2 * Math.PI * frequency * index / sampleRate + band * 0.73 +
                  (stereo && channel ? (band % 3 + 1) * 0.7 : 0)), 0);
            }
          }
          state.stemBuffers = stems ? { other: { id: "other", buffer, separation: 1, spatialWeight: 1 } } : null;
          state.spatialOutputCalibration = await calibrateSpatialProcessedOutput(buffer, state.analysis, { fast: true });
          const graph = createSpatialPlaybackGraph(context, buffer, state.analysis);
          startGraphSources(graph, 0);
          const rendered = await context.startRendering();
          const amplitude = (audio, frequency) => {
            let energy = 0;
            for (let channel = 0; channel < 2; channel += 1) {
              const data = audio.getChannelData(channel);
              let real = 0, imaginary = 0;
              for (let index = length / 2; index < length; index += 1) {
                const phase = 2 * Math.PI * frequency * index / sampleRate;
                real += data[index] * Math.cos(phase);
                imaginary += data[index] * Math.sin(phase);
              }
              energy += real * real + imaginary * imaginary;
            }
            return Math.sqrt(energy);
          };
          const gains = frequencies.map((frequency) => 20 * Math.log10(
            amplitude(rendered, frequency) / amplitude(buffer, frequency)));
          results.push({ measuredRoom, stereo, stems, gains, spreadDb: Math.max(...gains) - Math.min(...gains) });
          disconnectGraph(graph);
        }
      }
    }
    return results;
  });
  const reportPath = testInfo.outputPath("tone-response.json");
  fs.writeFileSync(reportPath, JSON.stringify(measurements, null, 2));
  await testInfo.attach("tone-response.json", { path: reportPath, contentType: "application/json" });
  for (const result of measurements) {
    expect(result.spreadDb, JSON.stringify(result)).toBeLessThan(1.5);
    // Relative to 1 kHz, retain bass and add bounded presence for vocal clarity.
    const [bass32, bass64, , , , reference1k, presence2k, presence4k] = result.gains;
    expect(bass32 - reference1k, JSON.stringify(result)).toBeGreaterThan(-1.0);
    expect(bass64 - reference1k, JSON.stringify(result)).toBeGreaterThan(-0.4);
    expect(presence2k - reference1k, JSON.stringify(result)).toBeGreaterThan(0.4);
    expect(presence4k - reference1k, JSON.stringify(result)).toBeGreaterThan(0.4);
    expect(presence4k - reference1k, JSON.stringify(result)).toBeLessThan(1.4);
  }
});
