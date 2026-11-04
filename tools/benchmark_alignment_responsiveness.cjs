const { chromium } = require("@playwright/test");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.SPATIAL_AUDIO_URL || "http://127.0.0.1:8768/");
    const result = await page.evaluate(async () => {
      const rate = 48000, length = rate * 3, lag = 7;
      const context = new OfflineAudioContext(2, length, rate);
      const reference = context.createBuffer(2, length, rate);
      const stems = Object.fromEntries(["vocals", "drums", "bass", "other"].map(id => [id, {buffer: context.createBuffer(2, length, rate)}]));
      let seed = 1;
      for (let channel = 0; channel < 2; channel++) for (let i = 0; i < length - lag; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const value = (seed / 2 ** 32 - 0.5) * 0.4;
        reference.getChannelData(channel)[i] = value;
        for (const stem of Object.values(stems)) stem.buffer.getChannelData(channel)[i + lag] = value * 0.25;
      }
      const run = async (asyncMode) => {
        const started = performance.now(); let delay;
        const timer = new Promise(resolve => setTimeout(() => { delay = performance.now() - started; resolve(); }, 0));
        const profile = asyncMode ? await estimateStemSetAlignmentAsync(reference, stems) : estimateStemSetAlignment(reference, stems);
        const duration = performance.now() - started;
        await timer;
        return {profile, duration, delay};
      };
      await run(false); await run(true);
      const sync = [], async = [];
      for (let i = 0; i < 5; i++) { sync.push(await run(false)); async.push(await run(true)); }
      if (JSON.stringify(sync[0].profile) !== JSON.stringify(async[0].profile)) throw new Error("Results differ");
      const median = list => list.sort((a, b) => a - b)[2];
      return {profile: sync[0].profile,
        synchronous: {analysisMs: median(sync.map(x => x.duration)), timerDelayMs: median(sync.map(x => x.delay))},
        chunked: {analysisMs: median(async.map(x => x.duration)), timerDelayMs: median(async.map(x => x.delay))}};
    });
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
