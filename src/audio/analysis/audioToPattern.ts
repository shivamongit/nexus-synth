/** YIN pitch + energy onsets → 16-step sequencer pattern. */

export interface PatternStep {
  active: boolean;
  midi: number;
  velocity: number;
}

export type ScaleSnap = 'chromatic' | 'major' | 'minor' | 'pentatonic';

export interface AudioToPatternOptions {
  sampleRate: number;
  steps?: number;
  snap?: ScaleSnap;
  gate?: number;
  bpm?: number;
}

export interface PatternResult {
  steps: PatternStep[];
  bpm: number;
  rootMidi: number;
  voicedRatio: number;
  rmsEnvelope: number[];
}

const SCALE: Record<Exclude<ScaleSnap, 'chromatic'>, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
};

function snapMidi(midi: number, snap: ScaleSnap, root = 0): number {
  if (snap === 'chromatic') return Math.round(midi);
  const pc = ((Math.round(midi) - root) % 12 + 12) % 12;
  const scale = SCALE[snap];
  let best = scale[0];
  let dist = 99;
  for (const d of scale) {
    const a = Math.abs(d - pc);
    const b = 12 - a;
    const dd = Math.min(a, b);
    if (dd < dist) {
      dist = dd;
      best = d;
    }
  }
  const oct = Math.round((midi - root - pc) / 12);
  return root + oct * 12 + best;
}

function yinPitch(frame: Float32Array, sampleRate: number, threshold = 0.12): { hz: number; conf: number } {
  const n = frame.length;
  const tauMin = Math.max(2, Math.floor(sampleRate / 1000));
  const tauMax = Math.min(Math.floor(n / 2), Math.floor(sampleRate / 60));
  const d = new Float32Array(tauMax + 1);

  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let i = 0; i < n - tau; i++) {
      const delta = frame[i] - frame[i + tau];
      sum += delta * delta;
    }
    d[tau] = sum;
  }

  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau];
    cmnd[tau] = (d[tau] * tau) / (running || 1);
  }

  let tauEst = 0;
  for (let tau = tauMin; tau < tauMax; tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 < tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
      tauEst = tau;
      break;
    }
  }
  if (!tauEst) {
    let min = 1;
    for (let tau = tauMin; tau < tauMax; tau++) {
      if (cmnd[tau] < min) {
        min = cmnd[tau];
        tauEst = tau;
      }
    }
    if (min > 0.45) return { hz: 0, conf: 0 };
  }

  const x0 = tauEst > 0 ? cmnd[tauEst - 1] : cmnd[tauEst];
  const x1 = cmnd[tauEst];
  const x2 = tauEst + 1 <= tauMax ? cmnd[tauEst + 1] : cmnd[tauEst];
  const denom = 2 * (2 * x1 - x2 - x0);
  const shift = denom !== 0 ? (x2 - x0) / denom : 0;
  const tau = tauEst + shift;
  const hz = sampleRate / tau;
  const conf = 1 - Math.min(1, cmnd[tauEst]);
  if (hz < 60 || hz > 1200) return { hz: 0, conf: 0 };
  return { hz, conf };
}

function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

function rms(frame: Float32Array): number {
  let s = 0;
  for (let i = 0; i < frame.length; i++) s += frame[i] * frame[i];
  return Math.sqrt(s / frame.length);
}

function estimateBpm(onsets: number[], duration: number): number {
  if (onsets.length < 4) return 120;
  const iv: number[] = [];
  for (let i = 1; i < onsets.length; i++) {
    const dt = onsets[i] - onsets[i - 1];
    if (dt > 0.12 && dt < 1.2) iv.push(dt);
  }
  if (!iv.length) {
    const guess = 60 / (duration / 8);
    return Math.max(70, Math.min(160, Math.round(guess)));
  }
  iv.sort((a, b) => a - b);
  const med = iv[Math.floor(iv.length / 2)];
  let bpm = 60 / med;
  while (bpm < 80) bpm *= 2;
  while (bpm > 170) bpm /= 2;
  return Math.round(bpm);
}

export function audioToPattern(
  samples: Float32Array,
  opts: AudioToPatternOptions,
): PatternResult {
  const sr = opts.sampleRate;
  const stepsN = opts.steps ?? 16;
  const snap = opts.snap ?? 'chromatic';
  const gate = opts.gate ?? 0.04;
  const hop = Math.floor(sr * 0.01);
  const win = Math.floor(sr * 0.04);
  const nFrames = Math.max(1, Math.floor((samples.length - win) / hop));

  const pitches: number[] = [];
  const confs: number[] = [];
  const energies: number[] = [];

  const frame = new Float32Array(win);
  for (let f = 0; f < nFrames; f++) {
    const off = f * hop;
    for (let i = 0; i < win; i++) frame[i] = samples[off + i] || 0;
    const e = rms(frame);
    energies.push(e);
    if (e < gate * 0.5) {
      pitches.push(0);
      confs.push(0);
      continue;
    }
    const { hz, conf } = yinPitch(frame, sr);
    pitches.push(hz > 0 && conf > 0.25 ? hzToMidi(hz) : 0);
    confs.push(conf);
  }

  const onsets: number[] = [];
  let prev = 0;
  for (let i = 1; i < energies.length; i++) {
    const flux = energies[i] - prev;
    prev = energies[i] * 0.7 + prev * 0.3;
    if (flux > gate * 0.8 && energies[i] > gate) {
      const t = (i * hop) / sr;
      if (!onsets.length || t - onsets[onsets.length - 1] > 0.08) onsets.push(t);
    }
  }

  const duration = samples.length / sr;
  const bpm = opts.bpm && opts.bpm > 0 ? opts.bpm : estimateBpm(onsets, duration);

  const stepDur = duration / stepsN;
  const steps: PatternStep[] = [];
  const rmsEnvelope: number[] = [];
  const voicedMidi: number[] = [];

  for (let s = 0; s < stepsN; s++) {
    const t0 = s * stepDur;
    const t1 = (s + 1) * stepDur;
    const i0 = Math.floor((t0 * sr) / hop);
    const i1 = Math.min(nFrames, Math.ceil((t1 * sr) / hop));
    let eMax = 0;
    const voiced: number[] = [];
    for (let i = i0; i < i1; i++) {
      eMax = Math.max(eMax, energies[i] || 0);
      if (pitches[i] > 0 && (confs[i] || 0) > 0.3) voiced.push(pitches[i]);
    }
    rmsEnvelope.push(eMax);
    if (voiced.length < 2 || eMax < gate) {
      steps.push({ active: false, midi: 60, velocity: 0 });
      continue;
    }
    voiced.sort((a, b) => a - b);
    const mid = voiced[Math.floor(voiced.length / 2)];
    const midi = snapMidi(mid, snap);
    voicedMidi.push(midi);
    const vel = Math.max(0.15, Math.min(1, eMax / 0.25));
    steps.push({ active: true, midi, velocity: vel });
  }

  const rootMidi = voicedMidi.length
    ? Math.round(voicedMidi.reduce((a, b) => a + b, 0) / voicedMidi.length)
    : 60;
  const voicedRatio = steps.filter((s) => s.active).length / stepsN;

  return { steps, bpm, rootMidi, voicedRatio, rmsEnvelope };
}

export function patternToGrid(
  steps: PatternStep[],
  rows: number,
  baseMidi: number,
): boolean[][] {
  const cols = steps.length;
  const grid = Array.from({ length: cols }, () => Array(rows).fill(false));
  for (let c = 0; c < cols; c++) {
    if (!steps[c].active) continue;
    const row = rows - 1 - (steps[c].midi - baseMidi);
    if (row >= 0 && row < rows) grid[c][row] = true;
  }
  return grid;
}
