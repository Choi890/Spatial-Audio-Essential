(function binauralSceneModule(global) {
  "use strict";

  const SIZE = 2048;
  const spectra = new WeakMap();
  const toneImpulseCache = new Map();
  const TONE_IMPULSE_CACHE_LIMIT = 12;
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

  // Radix-2 transform used only while preparing cached FIRs, never in the audio callback.
  function fft(real, imaginary, inverse = false) {
    const length = real.length;
    for (let index = 1, reversed = 0; index < length; index += 1) {
      let bit = length >> 1;
      for (; reversed & bit; bit >>= 1) reversed ^= bit;
      reversed ^= bit;
      if (index < reversed) {
        [real[index], real[reversed]] = [real[reversed], real[index]];
        [imaginary[index], imaginary[reversed]] = [imaginary[reversed], imaginary[index]];
      }
    }
    for (let size = 2; size <= length; size *= 2) {
      const angle = (inverse ? 2 : -2) * Math.PI / size;
      const stepReal = Math.cos(angle), stepImaginary = Math.sin(angle);
      for (let start = 0; start < length; start += size) {
        let rotationReal = 1, rotationImaginary = 0;
        for (let offset = 0; offset < size / 2; offset += 1) {
          const even = start + offset, odd = even + size / 2;
          const r = real[odd] * rotationReal - imaginary[odd] * rotationImaginary;
          const i = real[odd] * rotationImaginary + imaginary[odd] * rotationReal;
          real[odd] = real[even] - r;
          imaginary[odd] = imaginary[even] - i;
          real[even] += r;
          imaginary[even] += i;
          const next = rotationReal * stepReal - rotationImaginary * stepImaginary;
          rotationImaginary = rotationReal * stepImaginary + rotationImaginary * stepReal;
          rotationReal = next;
        }
      }
    }
    if (inverse) for (let index = 0; index < length; index += 1) {
      real[index] /= length;
      imaginary[index] /= length;
    }
  }

  function transform(data) {
    const real = new Float64Array(SIZE), imaginary = new Float64Array(SIZE);
    real.set(data.subarray(0, SIZE));
    fft(real, imaginary);
    return { real, imaginary };
  }

  function programSpectrum(buffer, startFrame = 0, endFrame = buffer.length) {
    const full = startFrame === 0 && endFrame === buffer.length;
    if (full && spectra.has(buffer)) return spectra.get(buffer);
    const ll = new Float64Array(SIZE / 2 + 1), rr = new Float64Array(ll.length);
    const lrReal = new Float64Array(ll.length), lrImaginary = new Float64Array(ll.length);
    const windows = Math.min(6, Math.max(1, Math.ceil((endFrame - startFrame) / SIZE)));
    for (let window = 0; window < windows; window += 1) {
      const start = startFrame + (windows === 1 ? 0 : Math.floor(Math.max(0, endFrame - startFrame - SIZE) * window / (windows - 1)));
      const channels = [0, Math.min(1, buffer.numberOfChannels - 1)].map((channel) => {
        const samples = buffer.getChannelData(channel), data = new Float64Array(SIZE);
        for (let index = 0; index < SIZE; index += 1) {
          data[index] = (start + index < endFrame ? samples[start + index] || 0 : 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * index / (SIZE - 1)));
        }
        return transform(data);
      });
      for (let bin = 0; bin < ll.length; bin += 1) {
        const l = channels[0], r = channels[1];
        ll[bin] += l.real[bin] ** 2 + l.imaginary[bin] ** 2;
        rr[bin] += r.real[bin] ** 2 + r.imaginary[bin] ** 2;
        lrReal[bin] += l.real[bin] * r.real[bin] + l.imaginary[bin] * r.imaginary[bin];
        lrImaginary[bin] += l.imaginary[bin] * r.real[bin] - l.real[bin] * r.imaginary[bin];
      }
    }
    const result = { ll, rr, lrReal, lrImaginary };
    if (full) spectra.set(buffer, result);
    return result;
  }

  function buildProgramMatchedImpulses(context, buffer, impulses) {
    const response = impulses.map((impulse) => [0, 1].map((ear) => transform(impulse.getChannelData(ear))));
    let impulseEnergy = 0;
    for (const impulse of impulses) for (let ear = 0; ear < 2; ear += 1) {
      for (const sample of impulse.getChannelData(ear)) impulseEnergy += sample * sample;
    }
    // Public HRIR files have arbitrary absolute recording gain. Normalize the
    // whole matrix with one scalar before applying the bounded spectral match.
    const normalization = Math.sqrt(2 / Math.max(1e-12, impulseEnergy));
    for (const ears of response) for (const ear of ears) for (let bin = 0; bin < SIZE; bin += 1) {
      ear.real[bin] *= normalization;
      ear.imaginary[bin] *= normalization;
    }
    const spectrum = programSpectrum(buffer);
    const inputPower = new Float64Array(SIZE / 2 + 1), outputPower = new Float64Array(inputPower.length);
    for (let bin = 0; bin < inputPower.length; bin += 1) {
      const sourceBin = Math.min(SIZE / 2, Math.round(bin * context.sampleRate / buffer.sampleRate));
      const ll = spectrum.ll[sourceBin], rr = spectrum.rr[sourceBin];
      inputPower[bin] = ll + rr;
      for (let ear = 0; ear < 2; ear += 1) {
        const l = response[0][ear], r = response[1][ear];
        const crossReal = l.real[bin] * r.real[bin] + l.imaginary[bin] * r.imaginary[bin];
        const crossImaginary = l.imaginary[bin] * r.real[bin] - l.real[bin] * r.imaginary[bin];
        outputPower[bin] += (l.real[bin] ** 2 + l.imaginary[bin] ** 2) * ll +
          (r.real[bin] ** 2 + r.imaginary[bin] ** 2) * rr + 2 *
          (crossReal * spectrum.lrReal[sourceBin] - crossImaginary * spectrum.lrImaginary[sourceBin]);
      }
    }
    // Broad shared correction: never invert the two ears separately, which would
    // destroy ILD and pinna ratios. Do not boost a silent or near-null band.
    const points = [];
    const total = inputPower.reduce((sum, power) => sum + power, 0);
    for (let frequency = 40; frequency < context.sampleRate / 2; frequency *= 2 ** (1 / 3)) {
      const low = Math.max(0, Math.floor(frequency / 2 ** (1 / 6) / context.sampleRate * SIZE));
      const high = Math.min(SIZE / 2, Math.ceil(frequency * 2 ** (1 / 6) / context.sampleRate * SIZE));
      let input = 0, output = 0;
      for (let bin = low; bin <= high; bin += 1) { input += inputPower[bin]; output += outputPower[bin]; }
      if (input > total * 1e-7 && output > input * 1e-5) {
        points.push({ frequency, logGain: clamp(0.5 * Math.log(input / output), -Math.log(2), Math.log(2)) });
      }
    }
    const { real: correctionReal, imaginary: correctionImaginary } = correctionSpectrum(points, context.sampleRate);
    return response.map((ears) => {
      const impulse = context.createBuffer(2, SIZE, context.sampleRate);
      ears.forEach(({ real, imaginary }, ear) => {
        for (let bin = 0; bin < SIZE; bin += 1) {
          const r = real[bin] * correctionReal[bin] - imaginary[bin] * correctionImaginary[bin];
          imaginary[bin] = real[bin] * correctionImaginary[bin] + imaginary[bin] * correctionReal[bin];
          real[bin] = r;
        }
        fft(real, imaginary, true);
        const channel = impulse.getChannelData(ear);
        for (let index = 0; index < SIZE; index += 1) {
          const taper = index < SIZE * 0.75 ? 1 : 0.5 + 0.5 * Math.cos(Math.PI * (index / SIZE - 0.75) / 0.25);
          channel[index] = real[index] * taper;
        }
      });
      return impulse;
    });
  }

  function correctionSpectrum(points, sampleRate) {
    const correctionReal = new Float64Array(SIZE), correctionImaginary = new Float64Array(SIZE);
    for (let bin = 0; bin <= SIZE / 2; bin += 1) {
      const frequency = Math.max(1, bin * sampleRate / SIZE);
      let value = 0;
      if (points.length) {
        const upper = points.findIndex((point) => point.frequency >= frequency);
        if (upper < 0) value = points[points.length - 1].logGain;
        else if (upper === 0) value = points[0].logGain;
        else {
          const a = points[upper - 1], b = points[upper];
          const t = Math.log(frequency / a.frequency) / Math.log(b.frequency / a.frequency);
          value = a.logGain + t * (b.logGain - a.logGain);
        }
      }
      correctionReal[bin] = value;
      if (bin > 0 && bin < SIZE / 2) correctionReal[SIZE - bin] = value;
    }
    // Real cepstrum -> causal minimum-phase common equalizer.
    fft(correctionReal, correctionImaginary, true);
    for (let index = 1; index < SIZE / 2; index += 1) correctionReal[index] *= 2;
    for (let index = SIZE / 2 + 1; index < SIZE; index += 1) correctionReal[index] = 0;
    correctionImaginary.fill(0);
    fft(correctionReal, correctionImaginary);
    for (let bin = 0; bin < SIZE; bin += 1) {
      const magnitude = Math.exp(correctionReal[bin]), phase = correctionImaginary[bin];
      correctionReal[bin] = magnitude * Math.cos(phase);
      correctionImaginary[bin] = magnitude * Math.sin(phase);
    }
    return { real: correctionReal, imaginary: correctionImaginary };
  }

  function measureToneCurve(reference, rendered, offsetSeconds, durationSeconds) {
    const skip = Math.min(0.15, durationSeconds * 0.15);
    const a = programSpectrum(reference, Math.round((offsetSeconds + skip) * reference.sampleRate),
      Math.min(reference.length, Math.round((offsetSeconds + durationSeconds) * reference.sampleRate)));
    const b = programSpectrum(rendered, Math.round(skip * rendered.sampleRate),
      Math.min(rendered.length, Math.round(durationSeconds * rendered.sampleRate)));
    const totalA = a.ll.reduce((sum, value, index) => sum + value + a.rr[index], 0);
    const totalB = b.ll.reduce((sum, value, index) => sum + value + b.rr[index], 0);
    const level = 0.5 * Math.log(Math.max(1e-12, totalA) / Math.max(1e-12, totalB));
    const points = [];
    for (let frequency = 40; frequency < reference.sampleRate / 2; frequency *= 2 ** (1 / 3)) {
      const low = Math.max(0, Math.floor(frequency / 2 ** (1 / 6) / reference.sampleRate * SIZE));
      const high = Math.min(SIZE / 2, Math.ceil(frequency * 2 ** (1 / 6) / reference.sampleRate * SIZE));
      let input = 0, output = 0;
      for (let bin = low; bin <= high; bin += 1) {
        input += a.ll[bin] + a.rr[bin];
        output += b.ll[bin] + b.rr[bin];
      }
      if (input > totalA * 1e-6 && output > totalB * 1e-6) {
        points.push({ frequency, logGain: clamp(0.5 * Math.log(input / output) - level,
          -Math.log(2), Math.log(2)) });
      }
    }
    return points;
  }

  function buildToneCorrectionImpulse(context, points) {
    // The same calibration is used across preview windows, playback and export.
    const key = JSON.stringify([context.sampleRate, points.map(({ frequency, logGain }) => [frequency, logGain])]);
    const cached = toneImpulseCache.get(key);
    if (cached) {
      toneImpulseCache.delete(key);
      toneImpulseCache.set(key, cached);
      return cached;
    }
    const { real, imaginary } = correctionSpectrum(points, context.sampleRate);
    fft(real, imaginary, true);
    const impulse = context.createBuffer(1, SIZE, context.sampleRate);
    const data = impulse.getChannelData(0);
    for (let index = 0; index < SIZE; index += 1) {
      const taper = index < SIZE * 0.75 ? 1 : 0.5 + 0.5 * Math.cos(Math.PI * (index / SIZE - 0.75) / 0.25);
      data[index] = real[index] * taper;
    }
    toneImpulseCache.set(key, impulse);
    if (toneImpulseCache.size > TONE_IMPULSE_CACHE_LIMIT) {
      toneImpulseCache.delete(toneImpulseCache.keys().next().value);
    }
    return impulse;
  }

  global.SpatialAudioBinauralScene = Object.freeze({ buildProgramMatchedImpulses,
    measureToneCurve, buildToneCorrectionImpulse });
})(window);
