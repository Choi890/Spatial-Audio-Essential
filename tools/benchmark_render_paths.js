const { chromium } = require("@playwright/test");

// Relative cost exploration only: muted paths change the sound and are not product presets.
async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.SPATIAL_AUDIO_URL || "http://127.0.0.1:8768/");
    const rows = await page.evaluate(async () => {
      await ensureUniversalHrtfProfile();
      const sampleRate = 48000;
      const frames = sampleRate * 12;
      const factory = new OfflineAudioContext(2, 1, sampleRate);
      await ensureMeasuredBrirBuffer(factory);
      const mix = factory.createBuffer(2, frames, sampleRate);
      for (let channel = 0; channel < 2; channel++) {
        const data = mix.getChannelData(channel);
        for (let i = 0; i < frames; i++) {
          data[i] = 0.05 * Math.sin(i * 0.032 + channel * 0.2) + 0.03 * Math.sin(i * 0.076);
        }
      }
      state.analysis = { mix: { peakDb: -15, rmsDb: -26 }, stereoImage: { width: 0.35 } };
      state.audioQualityTier = "full";
      state.spatialOutputCalibration = null;
      state.stemBuffers = {};
      for (const id of ["vocals", "drums", "bass", "other"]) {
        const stem = factory.createBuffer(2, frames, sampleRate);
        for (let channel = 0; channel < 2; channel++) {
          const target = stem.getChannelData(channel), source = mix.getChannelData(channel);
          for (let i = 0; i < frames; i++) target[i] = source[i] * 0.25;
        }
        state.stemBuffers[id] = { id, buffer: stem, separation: 1 };
      }
      const paths = [
        ["all", null], ["without-late", "lateEnvelopmentBus"], ["without-venue", "venueTailBus"],
        ["without-lateral", "lateralBus"], ["without-external", "externalizationBus"],
        ["without-hall", "orchestralHallBus"],
      ];
      const results = [];
      for (let pass = 0; pass < 2; pass++) {
        for (const [name, disabledBus] of paths) {
          const context = new OfflineAudioContext(2, frames + sampleRate, sampleRate);
          const graph = createSpatialPlaybackGraph(context, mix, state.analysis, { visualMeters: false });
          if (disabledBus) graph.spatialLayer[disabledBus].disconnect();
          startGraphSources(graph, 0);
          const started = performance.now();
          await context.startRendering();
          results.push({ pass, name, milliseconds: Math.round((performance.now() - started) * 10) / 10 });
          disconnectGraph(graph);
        }
      }
      return results;
    });
    console.log(JSON.stringify({ fixture: "12-second synthetic stereo, four stems", sampleRate: 48000, rows }, null, 2));
  } finally {
    await browser.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
