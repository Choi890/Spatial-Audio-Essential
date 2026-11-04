const { chromium } = require("@playwright/test");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.SPATIAL_AUDIO_URL || "http://127.0.0.1:8768/");
    const result = await page.evaluate(async () => {
      const rate = 48000, length = rate * 180;
      const context = new OfflineAudioContext(2, 1, rate);
      const buffers = Array.from({length: 4}, () => context.createBuffer(2, length, rate));
      for (let stem = 0; stem < buffers.length; stem++) for (let channel = 0; channel < 2; channel++) {
        const data = buffers[stem].getChannelData(channel);
        for (let i = 0; i < length; i++) data[i] = Math.sin(i * (0.07 + stem * 0.01)) * (channel ? 0.1 : 0.2);
      }
      const currentSource = stemStereoPositionSteps.toString();
      const chunkStart = currentSource.indexOf("    for (let chunkStart = start;");
      const chunkEnd = currentSource.indexOf("    if (!right) r = l;", chunkStart);
      if (chunkStart < 0 || chunkEnd < 0) throw new Error("Cannot construct previous implementation");
      const oldSource = currentSource.slice(0, chunkStart) + `    for (let frame = start; frame < end; frame += 1) {
        l += left[frame] ** 2;
        if (right) r += right[frame] ** 2;
        if ((frame - start + 1) % 32768 === 0) yield;
      }
` + currentSource.slice(chunkEnd);
      const previousSteps = new Function(`return (${oldSource})`)();
      const oldAsync = async buffer => {
        const iterator = previousSteps(buffer);
        let step, processed = 0, started = performance.now();
        do {
          step = iterator.next();
          if (!step.done && (++processed >= 16 || performance.now() - started >= 8)) {
            await yieldStemAnalysis(); processed = 0; started = performance.now();
          }
        } while (!step.done);
        return step.value;
      };
      const run = async (method) => {
        const started = performance.now();
        let timerDelay;
        const timer = new Promise(resolve => setTimeout(() => { timerDelay = performance.now() - started; resolve(); }, 0));
        const analysis = await Promise.all(buffers.map(buffer => method(buffer)));
        const analysisMs = performance.now() - started;
        await timer;
        return {analysis, analysisMs, timerDelay};
      };
      await run(oldAsync); await run(analyzeStemStereoPositionAsync);
      const old = [], current = [];
      for (let i = 0; i < 3; i++) { old.push(await run(oldAsync)); current.push(await run(analyzeStemStereoPositionAsync)); }
      if (JSON.stringify(old[0].analysis) !== JSON.stringify(current[0].analysis)) throw new Error("Results differ");
      const median = values => values.sort((a, b) => a - b)[1];
      return {seconds: 180, channels: 2, stems: buffers.length,
        previous: {analysisMs: median(old.map(x => x.analysisMs)), timerDelayMs: median(old.map(x => x.timerDelay))},
        current: {analysisMs: median(current.map(x => x.analysisMs)), timerDelayMs: median(current.map(x => x.timerDelay))}};
    });
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
