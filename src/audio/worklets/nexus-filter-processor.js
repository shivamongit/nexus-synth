/* Dual ZDF VCF + capture — AudioWorklet, plain JS */

function fastTanh(x) {
  if (x < -3) return -1;
  if (x > 3) return 1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

class TptSvf {
  constructor() {
    this.ic1 = 0;
    this.ic2 = 0;
  }
  reset() {
    this.ic1 = 0;
    this.ic2 = 0;
  }
  process(x, g, k, type) {
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = x - this.ic2;
    const v1 = a1 * this.ic1 + a2 * v3;
    const v2 = this.ic2 + a2 * this.ic1 + a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    const lp = v2;
    const bp = v1;
    const hp = x - k * v1 - v2;
    switch (type | 0) {
      case 1: return hp;
      case 2: return bp;
      case 3: return hp + lp;
      case 4: return lp - hp;
      default: return lp;
    }
  }
}

class ZdfLadder {
  constructor() {
    this.s = [0, 0, 0, 0];
  }
  reset() {
    this.s[0] = this.s[1] = this.s[2] = this.s[3] = 0;
  }
  process(x, g, res, drive) {
    const G = g / (1 + g);
    const G2 = G * G;
    const G3 = G2 * G;
    const G4 = G2 * G2;
    const k = res * 3.9;
    const s0 = this.s[0];
    const s1 = this.s[1];
    const s2 = this.s[2];
    const s3 = this.s[3];
    const S =
      G3 * s0 * (1 - G) +
      G2 * s1 * (1 - G) +
      G * s2 * (1 - G) +
      s3 * (1 - G);
    const u = (fastTanh(x * (1 + drive * 4)) - k * S) / (1 + k * G4);
    let y = u;
    for (let i = 0; i < 4; i++) {
      const v = (y - this.s[i]) * G;
      const pole = v + this.s[i];
      this.s[i] = pole + v;
      y = fastTanh(pole);
    }
    return y;
  }
}

class DualFilter {
  constructor() {
    this.svfA1 = new TptSvf();
    this.svfA2 = new TptSvf();
    this.svfB1 = new TptSvf();
    this.svfB2 = new TptSvf();
    this.ladA = new ZdfLadder();
    this.ladB = new ZdfLadder();
  }
  reset() {
    this.svfA1.reset();
    this.svfA2.reset();
    this.svfB1.reset();
    this.svfB2.reset();
    this.ladA.reset();
    this.ladB.reset();
  }
  stage(x, cutoff, res, drive, model, type, slope, fs, svf1, svf2, lad) {
    const fc = clamp(cutoff, 20, fs * 0.49);
    const g = Math.tan(Math.PI * fc / fs);
    const k = 2 - 2 * clamp(res, 0, 0.98);
    const driven = fastTanh(x * (1 + drive * 2));
    if ((model | 0) === 1) {
      const y = lad.process(driven, g, clamp(res, 0, 1), drive);
      if ((type | 0) === 1) return driven - y;
      if ((type | 0) === 2) return y * (driven - y) * 2;
      return y;
    }
    const y1 = svf1.process(driven, g, k, type);
    if ((slope | 0) >= 24) return svf2.process(y1, g, k, type);
    return y1;
  }
  process(x, p, fs) {
    const a = this.stage(
      x, p.f1c, p.f1r, p.f1d, p.f1m, p.f1t, p.f1s, fs,
      this.svfA1, this.svfA2, this.ladA,
    );
    if (p.f2on < 0.5) return a;
    const b = this.stage(
      p.routing < 0.5 ? a : x,
      p.f2c, p.f2r, p.f2d, p.f2m, p.f2t, p.f2s, fs,
      this.svfB1, this.svfB2, this.ladB,
    );
    const mix = clamp(p.f2mix, 0, 1);
    return a * (1 - mix) + b * mix;
  }
}

class NexusFilterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'f1Cutoff', defaultValue: 8000, minValue: 20, maxValue: 20000, automationRate: 'a-rate' },
      { name: 'f1Res', defaultValue: 0.2, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'f1Drive', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'f1Model', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'f1Type', defaultValue: 0, minValue: 0, maxValue: 4, automationRate: 'k-rate' },
      { name: 'f1Slope', defaultValue: 24, minValue: 12, maxValue: 24, automationRate: 'k-rate' },
      { name: 'f2Cutoff', defaultValue: 12000, minValue: 20, maxValue: 20000, automationRate: 'a-rate' },
      { name: 'f2Res', defaultValue: 0.15, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'f2Drive', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'f2Model', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'f2Type', defaultValue: 0, minValue: 0, maxValue: 4, automationRate: 'k-rate' },
      { name: 'f2Slope', defaultValue: 12, minValue: 12, maxValue: 24, automationRate: 'k-rate' },
      { name: 'f2Mix', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'routing', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'f2On', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'spread', defaultValue: 0, minValue: 0, maxValue: 100, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.L = new DualFilter();
    this.R = new DualFilter();
    this.pR = {
      f1c: 8000, f1r: 0.2, f1d: 0, f1m: 0, f1t: 0, f1s: 24,
      f2c: 12000, f2r: 0.15, f2d: 0, f2m: 0, f2t: 0, f2s: 12,
      f2mix: 0, routing: 0, f2on: 0,
    };
    this.port.onmessage = (e) => {
      if (e.data === 'reset') {
        this.L.reset();
        this.R.reset();
      }
    };
  }

  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0] || !output || !output[0]) return true;
    const n = output[0].length;
    const chs = output.length;
    const f1c = params.f1Cutoff;
    const f2c = params.f2Cutoff;
    const p = {
      f1c: 8000, f1r: params.f1Res[0], f1d: params.f1Drive[0],
      f1m: params.f1Model[0], f1t: params.f1Type[0], f1s: params.f1Slope[0],
      f2c: 12000, f2r: params.f2Res[0], f2d: params.f2Drive[0],
      f2m: params.f2Model[0], f2t: params.f2Type[0], f2s: params.f2Slope[0],
      f2mix: params.f2Mix[0], routing: params.routing[0], f2on: params.f2On[0],
    };
    const spread = params.spread[0];
    const ratio = Math.pow(2, spread / 1200);
    for (let i = 0; i < n; i++) {
      p.f1c = f1c.length > 1 ? f1c[i] : f1c[0];
      p.f2c = f2c.length > 1 ? f2c[i] : f2c[0];
      output[0][i] = this.L.process(input[0][i], p, sampleRate);
      if (chs > 1) {
        const xinR = input[1] ? input[1][i] : input[0][i];
        if (spread > 0.01) {
          this.pR.f1c = p.f1c * ratio;
          this.pR.f2c = p.f2c * ratio;
          this.pR.f1r = p.f1r; this.pR.f1d = p.f1d; this.pR.f1m = p.f1m; this.pR.f1t = p.f1t; this.pR.f1s = p.f1s;
          this.pR.f2r = p.f2r; this.pR.f2d = p.f2d; this.pR.f2m = p.f2m; this.pR.f2t = p.f2t; this.pR.f2s = p.f2s;
          this.pR.f2mix = p.f2mix; this.pR.routing = p.routing; this.pR.f2on = p.f2on;
          output[1][i] = this.R.process(xinR, this.pR, sampleRate);
        } else {
          output[1][i] = this.R.process(xinR, p, sampleRate);
        }
      }
    }
    return true;
  }
}

registerProcessor('nexus-filter-processor', NexusFilterProcessor);

class NexusCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.port.onmessage = (e) => {
      this.recording = e.data === 'start';
    };
  }
  process(inputs) {
    if (!this.recording) return true;
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) {
      const copy = new Float32Array(ch.length);
      copy.set(ch);
      this.port.postMessage(copy, [copy.buffer]);
    }
    return true;
  }
}

registerProcessor('nexus-capture-processor', NexusCaptureProcessor);
