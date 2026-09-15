const { test } = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('../static/js/spatial-quality.js');
const quality = window.SpatialAudioQuality;

function buffer(left, right = left, sampleRate = 48000) {
  return { sampleRate, length: left.length, duration: left.length / sampleRate,
    numberOfChannels: 2, getChannelData: channel => channel ? right : left };
}
function tone(seconds, frequency) {
  return Float32Array.from({ length: seconds * 48000 }, (_, i) =>
    0.5 * Math.sin(2 * Math.PI * frequency * i / 48000));
}

test('long-track coherence keeps original-rate high frequency energy', () => {
  const short = quality.analyzeMultibandCoherence(buffer(tone(4, 8000)));
  const long = quality.analyzeMultibandCoherence(buffer(tone(180, 8000)));
  for (let i = 0; i < short.bands.length; i++) {
    assert.ok(Math.abs(short.bands[i].levelDb - long.bands[i].levelDb) < 0.1);
    assert.ok(long.bands[i].correlation > 0.999);
  }
});

test('IACC detects reversed polarity and energy on odd samples', () => {
  let seed = 1234;
  const left = Float32Array.from({ length: 12000 }, (_, i) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return i % 2 ? seed / 2 ** 32 - 0.5 : 0;
  });
  for (const polarity of [-1, 1]) {
    const result = quality.analyzeBinauralResponse(buffer(left, left.map(x => x * polarity)));
    assert.ok(result.iacc80 > 0.999);
    assert.ok(result.iaccLate > 0.999);
    for (const value of Object.values(result.bandIacc)) assert.ok(value > 0.999);
  }
});

test('silent and empty analysis returns finite bounded metrics', () => {
  for (const count of [0, 4800]) {
    const input = buffer(new Float32Array(count));
    const result = quality.analyzeBinauralResponse(input);
    assert.equal(result.iacc80, 0);
    assert.equal(result.iaccLate, 0);
    for (const band of quality.analyzeMultibandCoherence(input).bands) {
      assert.ok(Number.isFinite(band.levelDb));
    }
  }
});

test('long-track level estimate does not sample a periodic tone only at zero crossings', () => {
  const result = quality.estimateLevelDb(buffer(tone(180, 8000)));
  assert.ok(Math.abs(result - 20 * Math.log10(0.5 / Math.sqrt(2))) < 0.01);
});
