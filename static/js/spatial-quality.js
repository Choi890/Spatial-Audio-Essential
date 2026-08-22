(function spatialQualityModule(global) {
  "use strict";

  const DEFAULT_BANDS = Object.freeze([
    Object.freeze({ id: "low", label: "Low", low: 80, high: 260 }),
    Object.freeze({ id: "lowMid", label: "Low-mid", low: 260, high: 900 }),
    Object.freeze({ id: "mid", label: "Mid", low: 900, high: 2800 }),
    Object.freeze({ id: "presence", label: "Presence", low: 2800, high: 7500 }),
    Object.freeze({ id: "air", label: "Air", low: 7500, high: 15000 })
  ]);

  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
  const toDb = (value) => 20 * Math.log10(Math.max(1e-9, value));

  function channelData(buffer, channel) {
    if (!buffer || typeof buffer.getChannelData !== "function") return null;
    return buffer.getChannelData(Math.min(channel, Math.max(0, buffer.numberOfChannels - 1)));
  }

  function sampleWindow(buffer, options = {}) {
    const sampleRate = Math.max(8000, Number(buffer?.sampleRate) || 48000);
    const length = Math.max(0, Number(buffer?.length) || 0);
    const maximumSamples = Math.max(4096, Math.round((options.maximumSeconds || 4) * sampleRate));
    const stride = Math.max(1, Math.ceil(length / maximumSamples));
    return { sampleRate, length, stride };
  }

  // 두 개의 1차 필터를 직렬로 사용해 분석 전용의 가벼운 대역 통과 응답을 만든다.
  function createBandSampler(sampleRate, lowHz, highHz) {
    const highpassAlpha = Math.exp(-2 * Math.PI * clamp(lowHz, 10, sampleRate * 0.44) / sampleRate);
    const lowpassAlpha = Math.exp(-2 * Math.PI * clamp(highHz, lowHz + 10, sampleRate * 0.47) / sampleRate);
    let previousInput = 0;
    let highpass = 0;
    let lowpass = 0;
    return (sample) => {
      highpass = highpassAlpha * (highpass + sample - previousInput);
      previousInput = sample;
      lowpass = (1 - lowpassAlpha) * highpass + lowpassAlpha * lowpass;
      return lowpass;
    };
  }

  function analyzeMultibandCoherence(buffer, options = {}) {
    const left = channelData(buffer, 0);
    const right = channelData(buffer, 1) || left;
    if (!left || !right) return { bands: [], averageCorrelation: 1, stereo: false };
    const bands = options.bands || DEFAULT_BANDS;
    const { sampleRate, length, stride } = sampleWindow(buffer, options);
    const skip = Math.min(length, Math.round((options.skipSeconds || 0.05) * sampleRate));
    const results = bands.map((band) => {
      const leftFilter = createBandSampler(sampleRate / stride, band.low, band.high);
      const rightFilter = createBandSampler(sampleRate / stride, band.low, band.high);
      let ll = 0;
      let rr = 0;
      let lr = 0;
      let side = 0;
      let mid = 0;
      let count = 0;
      for (let index = skip; index < length; index += stride) {
        const l = leftFilter(left[index] || 0);
        const r = rightFilter(right[index] || 0);
        ll += l * l;
        rr += r * r;
        lr += l * r;
        const m = (l + r) * 0.5;
        const s = (l - r) * 0.5;
        mid += m * m;
        side += s * s;
        count += 1;
      }
      const correlation = clamp(lr / Math.sqrt(Math.max(1e-12, ll * rr)), -1, 1);
      const sideRatio = clamp(side / Math.max(1e-12, side + mid), 0, 1);
      // 역상 또는 이미 넓은 대역은 확장을 줄이고, 상관도가 높은 대역만 제한적으로 보강한다.
      const coherenceRoom = clamp((correlation + 0.05) / 0.95, 0, 1);
      const widthRoom = clamp((0.5 - sideRatio) / 0.5, 0, 1);
      const recommendedGain = clamp(0.46 + coherenceRoom * widthRoom * 0.66, 0.38, 1.08);
      return Object.freeze({
        ...band,
        correlation,
        sideRatio,
        recommendedGain,
        levelDb: toDb(Math.sqrt((ll + rr) / Math.max(1, count * 2)))
      });
    });
    const active = results.filter((band) => band.levelDb > -62);
    const averageCorrelation = active.length
      ? active.reduce((sum, band) => sum + band.correlation, 0) / active.length
      : 1;
    return Object.freeze({ bands: Object.freeze(results), averageCorrelation, stereo: buffer.numberOfChannels > 1 });
  }

  function analyzeTransientMap(buffer, options = {}) {
    const left = channelData(buffer, 0);
    const right = channelData(buffer, 1) || left;
    if (!left || !right) return Object.freeze({ events: Object.freeze([]), density: 0, strength: 0 });
    const sampleRate = buffer.sampleRate || 48000;
    const frameSize = Math.max(64, Math.round((options.frameSeconds || 0.008) * sampleRate));
    const hopSize = Math.max(32, Math.round((options.hopSeconds || 0.004) * sampleRate));
    const minimumGap = Math.max(1, Math.round((options.minimumGapSeconds || 0.075) * sampleRate / hopSize));
    const events = [];
    let previous = 0;
    let moving = 1e-6;
    let lastEventFrame = -minimumGap;
    let frameIndex = 0;
    let strengthSum = 0;
    for (let start = 0; start + frameSize < buffer.length; start += hopSize, frameIndex += 1) {
      let energy = 0;
      for (let index = start; index < start + frameSize; index += 16) {
        const l = left[index] || 0;
        const r = right[index] || 0;
        energy += l * l + r * r;
      }
      const rms = Math.sqrt(energy / Math.max(1, frameSize * 0.125));
      moving = moving * 0.94 + rms * 0.06;
      const flux = Math.max(0, rms - previous);
      const normalized = flux / Math.max(1e-5, moving);
      if (normalized > 0.34 && rms > 0.004 && frameIndex - lastEventFrame >= minimumGap) {
        const strength = clamp((normalized - 0.2) / 1.4, 0.12, 1);
        events.push(Object.freeze({ time: start / sampleRate, strength }));
        strengthSum += strength;
        lastEventFrame = frameIndex;
      }
      previous = rms;
    }
    const duration = Math.max(0.001, buffer.duration || buffer.length / sampleRate);
    return Object.freeze({
      events: Object.freeze(events),
      density: events.length / duration,
      strength: events.length ? strengthSum / events.length : 0
    });
  }

  function normalizedCrossCorrelation(left, right, start, end, maximumLag) {
    let best = -1;
    for (let lag = -maximumLag; lag <= maximumLag; lag += 1) {
      let lr = 0;
      let ll = 0;
      let rr = 0;
      const from = Math.max(start, start - lag);
      const to = Math.min(end, end - lag);
      for (let index = from; index < to; index += 2) {
        const l = left[index] || 0;
        const r = right[index + lag] || 0;
        lr += l * r;
        ll += l * l;
        rr += r * r;
      }
      best = Math.max(best, lr / Math.sqrt(Math.max(1e-12, ll * rr)));
    }
    return clamp(best, -1, 1);
  }

  function analyzeBinauralResponse(buffer) {
    const left = channelData(buffer, 0);
    const right = channelData(buffer, 1) || left;
    if (!left || !right) return null;
    const sampleRate = buffer.sampleRate || 48000;
    const length = buffer.length || left.length;
    let peak = 0;
    let onsetIndex = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;
    let earlyEnergy = 0;
    let lateEnergy = 0;
    let clarityEarly = 0;
    let clarityLate = 0;
    const directWindow = Math.min(length, Math.round(sampleRate * 0.08));
    const clarityWindow = Math.min(length, Math.round(sampleRate * 0.05));
    for (let index = 0; index < length; index += 1) {
      const l = left[index] || 0;
      const r = right[index] || 0;
      const energy = l * l + r * r;
      const samplePeak = Math.max(Math.abs(l), Math.abs(r));
      if (samplePeak > peak) {
        peak = samplePeak;
        onsetIndex = index;
      }
      leftEnergy += l * l;
      rightEnergy += r * r;
      if (index < directWindow) earlyEnergy += energy;
      else lateEnergy += energy;
      if (index < clarityWindow) clarityEarly += energy;
      else clarityLate += energy;
    }
    const onsetThreshold = peak * 0.12;
    for (let index = 0; index <= onsetIndex; index += 1) {
      if (Math.max(Math.abs(left[index] || 0), Math.abs(right[index] || 0)) >= onsetThreshold) {
        onsetIndex = index;
        break;
      }
    }
    const earlyEnd = Math.min(length, onsetIndex + Math.round(sampleRate * 0.08));
    const clarityEnd = Math.min(length, onsetIndex + Math.round(sampleRate * 0.05));
    const directEnd = Math.min(length, onsetIndex + Math.round(sampleRate * 0.01));
    earlyEnergy = 0;
    lateEnergy = 0;
    clarityEarly = 0;
    clarityLate = 0;
    for (let index = onsetIndex; index < length; index += 1) {
      const l = left[index] || 0;
      const r = right[index] || 0;
      const energy = l * l + r * r;
      if (index < directEnd) earlyEnergy += energy;
      else lateEnergy += energy;
      if (index < clarityEnd) clarityEarly += energy;
      else clarityLate += energy;
    }
    const iacc80 = normalizedCrossCorrelation(left, right, onsetIndex, earlyEnd, Math.round(sampleRate * 0.001));
    const lateEnd = Math.min(length, earlyEnd + Math.round(sampleRate * 1.5));
    const iaccLate = normalizedCrossCorrelation(left, right, earlyEnd, lateEnd, Math.round(sampleRate * 0.001));
    const decay = estimateEnergyDecay(left, right, onsetIndex, sampleRate);
    const bandIacc = analyzeBandIacc(left, right, onsetIndex, earlyEnd, sampleRate);
    return Object.freeze({
      peakDbfs: toDb(peak),
      balanceDb: 10 * Math.log10(Math.max(1e-12, leftEnergy) / Math.max(1e-12, rightEnergy)),
      iacc80,
      iaccLate,
      apparentWidth: clamp(1 - Math.max(0, iacc80), 0, 1),
      listenerEnvelopment: clamp(1 - Math.max(0, iaccLate), 0, 1),
      drrDb: 10 * Math.log10(Math.max(1e-12, earlyEnergy) / Math.max(1e-12, lateEnergy)),
      c50Db: 10 * Math.log10(Math.max(1e-12, clarityEarly) / Math.max(1e-12, clarityLate)),
      c80Db: 10 * Math.log10(
        Math.max(1e-12, energyBetween(left, right, onsetIndex, earlyEnd)) /
        Math.max(1e-12, energyBetween(left, right, earlyEnd, length))
      ),
      edtSeconds: decay.edtSeconds,
      t20Seconds: decay.t20Seconds,
      onsetSeconds: onsetIndex / sampleRate,
      bandIacc
    });
  }

  function energyBetween(left, right, start, end) {
    let energy = 0;
    for (let index = start; index < end; index += 1) {
      energy += (left[index] || 0) ** 2 + (right[index] || 0) ** 2;
    }
    return energy;
  }

  function estimateEnergyDecay(left, right, onsetIndex, sampleRate) {
    const length = Math.min(left.length, right.length);
    const stride = 16;
    const bins = Math.max(1, Math.ceil((length - onsetIndex) / stride));
    const schroeder = new Float64Array(bins);
    let integrated = 0;
    for (let bin = bins - 1; bin >= 0; bin -= 1) {
      const start = onsetIndex + bin * stride;
      const end = Math.min(length, start + stride);
      integrated += energyBetween(left, right, start, end);
      schroeder[bin] = integrated;
    }
    const reference = Math.max(1e-15, schroeder[0]);
    const timeAtDb = (targetDb) => {
      for (let bin = 0; bin < bins; bin += 1) {
        const db = 10 * Math.log10(Math.max(1e-15, schroeder[bin]) / reference);
        if (db <= targetDb) return bin * stride / sampleRate;
      }
      return NaN;
    };
    const t5 = timeAtDb(-5);
    const t10 = timeAtDb(-10);
    const t25 = timeAtDb(-25);
    return {
      edtSeconds: Number.isFinite(t10) ? Math.max(0, t10 * 6) : NaN,
      t20Seconds: Number.isFinite(t5) && Number.isFinite(t25) ? Math.max(0, (t25 - t5) * 3) : NaN
    };
  }

  function analyzeBandIacc(left, right, start, end, sampleRate) {
    const definitions = [
      { id: "low", low: 80, high: 500 },
      { id: "mid", low: 500, high: 2000 },
      { id: "high", low: 2000, high: 12000 }
    ];
    return Object.freeze(Object.fromEntries(definitions.map((band) => {
      const leftFilter = createBandSampler(sampleRate, band.low, band.high);
      const rightFilter = createBandSampler(sampleRate, band.low, band.high);
      const bandLeft = new Float32Array(Math.max(0, end - start));
      const bandRight = new Float32Array(bandLeft.length);
      for (let index = 0; index < bandLeft.length; index += 1) {
        bandLeft[index] = leftFilter(left[start + index] || 0);
        bandRight[index] = rightFilter(right[start + index] || 0);
      }
      return [band.id, normalizedCrossCorrelation(
        bandLeft,
        bandRight,
        0,
        bandLeft.length,
        Math.round(sampleRate * 0.001)
      )];
    })));
  }

  function compareRenderedToReference(rendered, reference) {
    const renderedMetrics = analyzeBinauralResponse(rendered);
    const referenceMetrics = analyzeBinauralResponse(reference);
    if (!renderedMetrics || !referenceMetrics) return null;
    const levelDeltaDb = estimateLevelDb(rendered) - estimateLevelDb(reference);
    return Object.freeze({
      ...renderedMetrics,
      levelDeltaDb,
      balanceDeltaDb: renderedMetrics.balanceDb - referenceMetrics.balanceDb,
      widthDelta: renderedMetrics.apparentWidth - referenceMetrics.apparentWidth,
      status: Math.abs(levelDeltaDb) <= 1 && Math.abs(renderedMetrics.balanceDb) <= 1.25 && renderedMetrics.peakDbfs <= -0.05
        ? "pass"
        : "review"
    });
  }

  function estimateLevelDb(buffer) {
    const left = channelData(buffer, 0);
    const right = channelData(buffer, 1) || left;
    if (!left || !right) return -120;
    const stride = Math.max(1, Math.ceil(buffer.length / 240000));
    let energy = 0;
    let count = 0;
    for (let index = 0; index < buffer.length; index += stride) {
      energy += (left[index] || 0) ** 2 + (right[index] || 0) ** 2;
      count += 2;
    }
    return toDb(Math.sqrt(energy / Math.max(1, count)));
  }

  function buildSafetyProfile(coherence) {
    const byId = Object.fromEntries((coherence?.bands || []).map((band) => [band.id, band]));
    const gain = (id, fallback) => clamp(Number(byId[id]?.recommendedGain) || fallback, 0.38, 1.08);
    return Object.freeze({
      bandGains: Object.freeze({
        lowMid: Math.min(0.78, gain("lowMid", 0.72)),
        mid: gain("mid", 0.9),
        presence: gain("presence", 0.92),
        air: Math.min(0.94, gain("air", 0.82))
      }),
      lowFrequencyProtected: true,
      maximumExpansionGain: 1.08
    });
  }

  global.SpatialAudioQuality = Object.freeze({
    DEFAULT_BANDS,
    analyzeBinauralResponse,
    analyzeMultibandCoherence,
    analyzeTransientMap,
    buildSafetyProfile,
    compareRenderedToReference,
    estimateLevelDb
  });
})(window);
