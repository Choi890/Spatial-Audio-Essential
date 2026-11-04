const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const window = {
  SpatialAudioUtils: { clamp: (x, a, b) => Math.max(a, Math.min(b, x)) },
  SpatialAudioConfig: { STEM_ORDER: ["vocals"] },
};
vm.runInNewContext(
  fs.readFileSync(require.resolve("../static/js/spatial-renderer.js"), "utf8"),
  { window },
);

test("render plans isolate settings and calibration while sharing PCM and caches", () => {
  const pcm = { sampleRate: 48000 };
  const source = {
    analysis: { mix: { peakDb: -3 }, stereoImage: { width: 0.4 } },
    stemBuffers: { vocals: { buffer: pcm, quality: { separation: 0.9 } } },
    spatialSettings: { wet: 0.8, radius: 1.3, reflections: 0.7 },
    spatialOutputCalibration: {
      gain: 1,
      toneCurve: [{ frequency: 100, gain: -1 }],
    },
    hrtfImpulseCache: new Map(),
  };
  const plan = window.SpatialAudioRenderer.createRenderPlan(source, pcm);
  source.spatialSettings.wet = 0;
  source.analysis.mix.peakDb = 0;
  source.stemBuffers.vocals.quality.separation = 0;
  source.spatialOutputCalibration.toneCurve[0].gain = 5;
  assert.equal(plan.snapshot.spatialSettings.wet, 0.8);
  assert.equal(plan.snapshot.analysis.mix.peakDb, -3);
  assert.equal(plan.snapshot.stemBuffers.vocals.quality.separation, 0.9);
  assert.equal(plan.snapshot.spatialOutputCalibration.toneCurve[0].gain, -1);
  assert.equal(plan.snapshot.stemBuffers.vocals.buffer, pcm);
  assert.equal(plan.buffer, pcm);
  assert.equal(plan.snapshot.hrtfImpulseCache, source.hrtfImpulseCache);
  assert.equal(Object.isFrozen(plan.snapshot.spatialSettings), true);
  const calibrated = plan.withCalibration({ gain: 0.8 });
  assert.equal(calibrated.snapshot.spatialOutputCalibration.gain, 0.8);
  assert.equal(calibrated.snapshot.spatialSettings.wet, 0.8);
  assert.equal(plan.snapshot.spatialOutputCalibration.gain, 1);
  assert.equal(source.spatialOutputCalibration.gain, 1);
});

test("Original uses the measured gain", () => {
  const context = {
    destination: {},
    createGain: () => ({ gain: { value: 1 }, connect(target) { return target; } }),
    createBufferSource: () => ({ connect(target) { return target; } }),
    createAnalyser: () => ({ frequencyBinCount: 1024, connect(target) { return target; } }),
  };
  const pcm = {};
  const source = { stemBuffers: null, spatialOutputCalibration: { originalMatchGain: 0.73 } };
  const renderer = window.SpatialAudioRenderer.createRenderer(source);
  const original = renderer.createOriginalPlaybackGraph(context, pcm);
  assert.equal(original.master.gain.value, 0.73);
  assert.equal(original.outputGainScale, 0.73);
  assert.equal(original.source.buffer, pcm);
  source.spatialOutputCalibration.originalMatchGain = 1.1;
  assert.equal(renderer.createOriginalPlaybackGraph(context, pcm).outputGainScale, 1.1);
  source.spatialOutputCalibration.originalMatchGain = NaN;
  assert.equal(renderer.createOriginalPlaybackGraph(context, pcm).outputGainScale, 1);
});


test("reverb tuning is bounded and leaves more room for sparse dynamic music", () => {
  const tune = window.SpatialAudioRenderer.getReverbScale;
  const dense = tune({activeIds: ["vocals", "drums", "bass"], mix: {crestDb: 8}, sections: [{density: 1}]});
  const sparse = tune({activeIds: ["piano"], mix: {crestDb: 20}, sections: [{density: 0.1}]});
  assert.ok(dense < sparse);
  assert.ok(dense >= 0.67);
  for (const analysis of [undefined, {}, {mix: {crestDb: NaN}}, {sections: [{density: 100}]}]) {
    assert.ok(tune(analysis) >= 0.67 && tune(analysis) <= 1);
  }
});

test("track-level width guard reduces added reflections only for confident wide stereo", () => {
  const tune = window.SpatialAudioRenderer.getReverbScale;
  const base = {activeIds: ["vocals", "drums"], mix: {crestDb: 12}, sections: [{density: 0.5}]};
  const narrow = tune({...base, stereoImage: {status: "stereo", width: 0.2, confidence: 1}});
  const wide = tune({...base, stereoImage: {status: "stereo", width: 0.7, confidence: 1}});
  const uncertain = tune({...base, stereoImage: {status: "stereo", width: 0.7, confidence: 0}});
  assert.ok(Math.abs(narrow - wide - 0.08) < 1e-9);
  assert.equal(uncertain, narrow);
  assert.equal(tune({...base, stereoImage: {status: "mono", width: 1, confidence: 1}}), narrow);
});


test("separate render plans reuse the track's mix profile and discard it with the track", () => {
  let reads = 0;
  const makeBuffer = (sample) => ({length: 64, numberOfChannels: 1,
    getChannelData() { reads++; return new Float32Array(64).fill(sample); }});
  const mix = makeBuffer(0.5), stem = makeBuffer(0.5);
  const state = { analysis: {}, spatialSettings: {}, stemBuffers: {}, mixtureProfileMemo: {} };
  const stems = [{buffer: stem, alignmentSamples: 0}];
  const renderer = () => window.SpatialAudioRenderer.createRenderer(
    window.SpatialAudioRenderer.createRenderPlan(state, mix).snapshot);
  const first = renderer().getMixtureConsistencyProfile(mix, stems);
  const afterFirst = reads;
  assert.equal(renderer().getMixtureConsistencyProfile(mix, stems), first);
  assert.equal(reads, afterFirst);
  state.mixtureProfileMemo = {};
  assert.notEqual(renderer().getMixtureConsistencyProfile(mix, stems), first);
  assert.ok(reads > afterFirst);
});

test("calibration plans reuse mixture measurements only for matching stems and alignment", () => {
  let reads = 0;
  const makeBuffer = (sample) => ({length: 32, numberOfChannels: 1, getChannelData() { reads++; return new Float32Array(32).fill(sample); }});
  const mix = makeBuffer(0.5), vocal = makeBuffer(0.25), drums = makeBuffer(0.25);
  const state = { analysis: {}, spatialSettings: {}, stemBuffers: {} };
  const plan = window.SpatialAudioRenderer.createRenderPlan(state, mix);
  const firstRenderer = window.SpatialAudioRenderer.createRenderer(plan.snapshot);
  const nextRenderer = window.SpatialAudioRenderer.createRenderer(plan.withCalibration({gain: 1}).snapshot);
  const stems = [{buffer: vocal, alignmentSamples: 0}, {buffer: drums, alignmentSamples: 0}];
  const first = firstRenderer.getMixtureConsistencyProfile(mix, stems);
  const initialReads = reads;
  assert.equal(nextRenderer.getMixtureConsistencyProfile(mix, stems), first);
  assert.equal(reads, initialReads);
  const changed = nextRenderer.getMixtureConsistencyProfile(mix, [{buffer: vocal, alignmentSamples: 1}, stems[1]]);
  assert.notEqual(changed, first);
  assert.ok(reads > initialReads);
});

test("mixture measurement uses only the common aligned interval", () => {
  const makeBuffer = (data) => ({ length: data.length, numberOfChannels: 1, getChannelData: () => data });
  const reference = makeBuffer(Float32Array.from([1, 1, 0.9, 0.9, 0.9, 0.9]));
  const stem = makeBuffer(Float32Array.from([1, 1, 1, 1, 0, 0]));
  const renderer = window.SpatialAudioRenderer.createRenderer({analysis: {}, spatialSettings: {}, stemBuffers: {}});
  const result = renderer.getMixtureConsistencyProfile(reference, [{buffer: stem, alignmentSamples: -2}]);
  assert.equal(result.sampleCount, 4);
  assert.ok(Math.abs(result.stemScale - 0.9) < 1e-5, JSON.stringify(result));
  assert.ok(result.residualRatio < 1e-5, JSON.stringify(result));
  const noOverlap = renderer.getMixtureConsistencyProfile(reference, [{buffer: stem, alignmentSamples: -6}]);
  assert.equal(noOverlap.reliable, false);
  assert.equal(noOverlap.sampleCount, 0);
});

test("mix consistency does not alias an 8 kHz signal in a long track", () => {
  const rate = 48000, length = rate * 3;
  const samples = Float32Array.from({length}, (_, index) => 0.5 * Math.sin(2 * Math.PI * 8000 * index / rate));
  const quieter = Float32Array.from(samples, value => value * 0.9);
  const makeBuffer = (data) => ({ length, numberOfChannels: 2, getChannelData: () => data });
  const reference = makeBuffer(samples), stem = makeBuffer(quieter);
  const state = { analysis: {}, spatialSettings: {}, stemBuffers: {}, mixtureProfileMemo: {} };
  const renderer = window.SpatialAudioRenderer.createRenderer(state);
  const result = renderer.getMixtureConsistencyProfile(reference, [{buffer: stem, alignmentSamples: 0}]);
  assert.ok(Math.abs(result.stemScale - 1 / 0.9) < 1e-5, JSON.stringify(result));
  assert.ok(result.residualRatio < 1e-5, JSON.stringify(result));
  assert.equal(result.reliable, true);
});

test("mix consistency finds sparse audio outside its distributed windows", () => {
  const length = 480000, samples = new Float32Array(length), quieter = new Float32Array(length);
  for (let i = 20000; i < 20512; i++) { samples[i] = 0.4; quieter[i] = 0.36; }
  const makeBuffer = (data) => ({length, numberOfChannels: 2, getChannelData: () => data});
  const renderer = window.SpatialAudioRenderer.createRenderer({analysis: {}, spatialSettings: {}, stemBuffers: {}});
  const result = renderer.getMixtureConsistencyProfile(makeBuffer(samples), [{buffer: makeBuffer(quieter), alignmentSamples: 0}]);
  assert.ok(Math.abs(result.stemScale - 1 / 0.9) < 1e-5, JSON.stringify(result));
  assert.ok(result.residualRatio < 1e-5, JSON.stringify(result));
  assert.equal(result.reliable, true);
});

test("mono reference uses both channels of stereo stems for mixture scaling", () => {
  const length = 512;
  const mono = new Float32Array(length).fill(0.5);
  const left = new Float32Array(length).fill(0.55), right = new Float32Array(length).fill(0.35);
  const reference = {length, numberOfChannels: 1, getChannelData: () => mono};
  const stem = {length, numberOfChannels: 2, getChannelData: channel => channel ? right : left};
  const renderer = window.SpatialAudioRenderer.createRenderer({analysis: {}, spatialSettings: {}, stemBuffers: {}});
  const result = renderer.getMixtureConsistencyProfile(reference, [{buffer: stem}]);
  const expected = 0.5 * (0.55 + 0.35) / (0.55 ** 2 + 0.35 ** 2);
  assert.ok(Math.abs(result.stemScale - expected) < 1e-5, JSON.stringify(result));
});
