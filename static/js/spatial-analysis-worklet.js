class SpatialAnalysisProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.blockCount = 0;
    this.previousRms = 0;
    this.smoothedRms = 1e-6;
    this.lastTransientFrame = -4096;
    this.leftLow = 0;
    this.rightLow = 0;
    this.leftMidLowpass = 0;
    this.rightMidLowpass = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input?.length) return true;
    const left = input[0];
    const right = input[1] || left;
    if (output?.length) {
      output[0]?.set(left);
      if (output[1]) output[1].set(right);
    }
    let ll = 0;
    let rr = 0;
    let lr = 0;
    let peak = 0;
    let lowLl = 0; let lowRr = 0; let lowLr = 0;
    let midLl = 0; let midRr = 0; let midLr = 0;
    let highLl = 0; let highRr = 0; let highLr = 0;
    const lowAlpha = Math.exp(-2 * Math.PI * 500 / sampleRate);
    const midAlpha = Math.exp(-2 * Math.PI * 2000 / sampleRate);
    for (let index = 0; index < left.length; index += 1) {
      const l = left[index] || 0;
      const r = right[index] || 0;
      ll += l * l;
      rr += r * r;
      lr += l * r;
      peak = Math.max(peak, Math.abs(l), Math.abs(r));
      this.leftLow = (1 - lowAlpha) * l + lowAlpha * this.leftLow;
      this.rightLow = (1 - lowAlpha) * r + lowAlpha * this.rightLow;
      this.leftMidLowpass = (1 - midAlpha) * l + midAlpha * this.leftMidLowpass;
      this.rightMidLowpass = (1 - midAlpha) * r + midAlpha * this.rightMidLowpass;
      const lowLeft = this.leftLow;
      const lowRight = this.rightLow;
      const midLeft = this.leftMidLowpass - lowLeft;
      const midRight = this.rightMidLowpass - lowRight;
      const highLeft = l - this.leftMidLowpass;
      const highRight = r - this.rightMidLowpass;
      lowLl += lowLeft * lowLeft; lowRr += lowRight * lowRight; lowLr += lowLeft * lowRight;
      midLl += midLeft * midLeft; midRr += midRight * midRight; midLr += midLeft * midRight;
      highLl += highLeft * highLeft; highRr += highRight * highRight; highLr += highLeft * highRight;
    }
    const rms = Math.sqrt((ll + rr) / Math.max(1, left.length * 2));
    this.smoothedRms = this.smoothedRms * 0.92 + rms * 0.08;
    const flux = Math.max(0, rms - this.previousRms) / Math.max(1e-6, this.smoothedRms);
    const frame = currentFrame;
    const transient = flux > 0.36 && peak > 0.01 && frame - this.lastTransientFrame > sampleRate * 0.06;
    if (transient) this.lastTransientFrame = frame;
    this.previousRms = rms;
    this.blockCount += 1;
    if (this.blockCount % 32 === 0 || transient) {
      this.port.postMessage({
        type: "spatial-analysis",
        frame,
        rms,
        peak,
        correlation: lr / Math.sqrt(Math.max(1e-12, ll * rr)),
        bandCorrelation: {
          low: lowLr / Math.sqrt(Math.max(1e-12, lowLl * lowRr)),
          mid: midLr / Math.sqrt(Math.max(1e-12, midLl * midRr)),
          high: highLr / Math.sqrt(Math.max(1e-12, highLl * highRr))
        },
        transient,
        transientStrength: Math.min(1, flux)
      });
    }
    return true;
  }
}

registerProcessor("spatial-analysis-processor", SpatialAnalysisProcessor);
