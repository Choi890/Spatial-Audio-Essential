const fs = require("node:fs");
const { performance } = require("node:perf_hooks");

const source = fs.readFileSync("static/app.js", "utf8");
const current = source.slice(source.indexOf("function estimateStemSetAlignment("), source.indexOf("\nfunction getDemucsStemItems("));
const cacheStart = current.indexOf("  const summedWindows =");
const cacheEnd = current.indexOf("  let bestLag =", cacheStart);
const prior = current.slice(0, cacheStart) + current.slice(cacheEnd)
  .replace("for (const { start, end, first, channels } of summedWindows)", "for (const { start, end } of windows)")
  .replace("const stemSum = channels[channel][index + lag - first];", `let stemSum = 0;
        for (const channels of stemChannels) {
          stemSum += channels[Math.min(channel, channels.length - 1)][index + lag] || 0;
        }`);
if (cacheStart < 0 || cacheEnd < 0 || prior.includes("summedWindows")) throw new Error("Unable to construct baseline");
const compile = code => new Function(`const STEM_ALIGNMENT_MAX_LAG_SAMPLES = 128;
const STEM_ALIGNMENT_SAMPLE_LIMIT = 24000; const STEM_ALIGNMENT_MIN_CORRELATION = 0.12;
${code}; return estimateStemSetAlignment;`)();
const functions = [compile(prior), compile(current)];
const length = 144000, lag = 7;
const channels = Array.from({ length: 2 }, () => new Float32Array(length));
const stemData = Array.from({ length: 4 }, () => Array.from({ length: 2 }, () => new Float32Array(length)));
let seed = 1;
for (let i = 0; i < length - lag; i++) for (let channel = 0; channel < 2; channel++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  const value = (seed / 2 ** 32 - 0.5) * 0.4;
  channels[channel][i] = value;
  for (const stem of stemData) stem[channel][i + lag] = value * 0.25;
}
const buffer = data => ({ length, numberOfChannels: data.length, getChannelData: channel => data[channel] });
const ref = buffer(channels), stems = Object.fromEntries(stemData.map((data, index) => [index, { buffer: buffer(data) }]));
const results = functions.map(fn => {
  fn(ref, stems);
  const times = [], output = [];
  for (let i = 0; i < 5; i++) { const start = performance.now(); output.push(fn(ref, stems)); times.push(performance.now() - start); }
  times.sort((a, b) => a - b);
  return { medianMs: times[2], result: output[0] };
});
if (JSON.stringify(results[0].result) !== JSON.stringify(results[1].result)) throw new Error("Alignment results differ");
console.log(JSON.stringify({ baseline: results[0], cached: results[1] }, null, 2));
