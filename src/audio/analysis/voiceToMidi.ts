/** Professional monophonic voice → MIDI (McLeod Pitch Method + note tracker). */

export type ScaleSnap = 'chromatic' | 'major' | 'minor' | 'pentatonic';

export interface MidiNote {
  midi: number;
  start: number;
  duration: number;
  velocity: number;
}

export interface VoiceToMidiOptions {
  sampleRate: number;
  snap?: ScaleSnap;
  gate?: number;
  bpm?: number;
  quantize?: boolean;
  minNoteMs?: number;
}

export interface VoiceToMidiResult {
  notes: MidiNote[];
  bpm: number;
  rootMidi: number;
  voicedRatio: number;
  contour: { t: number; midi: number; conf: number }[];
  duration: number;
}

const SCALE: Record<Exclude<ScaleSnap, 'chromatic'>, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
};

export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

export function midiToName(m: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const n = Math.round(m);
  return `${names[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}

export function snapMidi(midi: number, snap: ScaleSnap, root = 0): number {
  if (snap === 'chromatic') return Math.round(midi);
  const rounded = Math.round(midi);
  const pc = ((rounded - root) % 12 + 12) % 12;
  const scale = SCALE[snap];
  let best = scale[0];
  let dist = 99;
  for (const d of scale) {
    const a = Math.abs(d - pc);
    const dd = Math.min(a, 12 - a);
    if (dd < dist) {
      dist = dd;
      best = d;
    }
  }
  const oct = Math.round((midi - root - pc) / 12);
  return root + oct * 12 + best;
}

function highpass(samples: Float32Array, sr: number, hz = 70): Float32Array {
  const out = new Float32Array(samples.length);
  const rc = 1 / (2 * Math.PI * hz);
  const dt = 1 / sr;
  const a = rc / (rc + dt);
  let prevX = 0;
  let prevY = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const y = a * (prevY + x - prevX);
    out[i] = y;
    prevX = x;
    prevY = y;
  }
  return out;
}

/** McLeod Pitch Method (NSDF) — more robust on sung vowels than plain YIN. */
export function mpmPitch(frame: Float32Array, sampleRate: number): { hz: number; conf: number } {
  const n = frame.length;
  const tauMin = Math.max(2, Math.floor(sampleRate / 900));
  const tauMax = Math.min(Math.floor(n * 0.45), Math.floor(sampleRate / 70));
  const nsdf = new Float32Array(tauMax + 1);

  for (let tau = tauMin; tau <= tauMax; tau++) {
    let ac = 0;
    let m = 0;
    const lim = n - tau;
    for (let j = 0; j < lim; j++) {
      const a = frame[j];
      const b = frame[j + tau];
      ac += a * b;
      m += a * a + b * b;
    }
    nsdf[tau] = m > 1e-12 ? (2 * ac) / m : 0;
  }

  const peaks: { tau: number; val: number }[] = [];
  for (let tau = tauMin + 1; tau < tauMax; tau++) {
    if (nsdf[tau] > nsdf[tau - 1] && nsdf[tau] >= nsdf[tau + 1] && nsdf[tau] > 0.48) {
      const y0 = nsdf[tau - 1];
      const y1 = nsdf[tau];
      const y2 = nsdf[tau + 1];
      const den = 2 * (2 * y1 - y2 - y0);
      const shift = den !== 0 ? (y2 - y0) / den : 0;
      peaks.push({ tau: tau + shift, val: y1 });
    }
  }
  if (!peaks.length) return { hz: 0, conf: 0 };
  peaks.sort((a, b) => b.val - a.val);
  const best = peaks[0];
  const hz = sampleRate / best.tau;
  if (hz < 70 || hz > 900) return { hz: 0, conf: 0 };
  return { hz, conf: Math.min(1, best.val) };
}

function rms(frame: Float32Array): number {
  let s = 0;
  for (let i = 0; i < frame.length; i++) s += frame[i] * frame[i];
  return Math.sqrt(s / frame.length);
}

function median(arr: number[]): number {
  const a = arr.filter((x) => x > 0).sort((x, y) => x - y);
  if (!a.length) return 0;
  return a[Math.floor(a.length / 2)];
}

function estimateBpm(notes: MidiNote[], duration: number): number {
  if (notes.length < 3) return 120;
  const iv: number[] = [];
  for (let i = 1; i < notes.length; i++) {
    const dt = notes[i].start - notes[i - 1].start;
    if (dt > 0.12 && dt < 1.1) iv.push(dt);
  }
  if (!iv.length) return Math.max(80, Math.min(140, Math.round(60 / (duration / 8))));
  iv.sort((a, b) => a - b);
  let bpm = 60 / iv[Math.floor(iv.length / 2)];
  while (bpm < 75) bpm *= 2;
  while (bpm > 165) bpm /= 2;
  return Math.round(bpm);
}

export function voiceToMidi(samples: Float32Array, opts: VoiceToMidiOptions): VoiceToMidiResult {
  const sr = opts.sampleRate;
  const snap = opts.snap ?? 'chromatic';
  const minDur = (opts.minNoteMs ?? 80) / 1000;
  const cleaned = highpass(samples, sr, 65);

  let peak = 0;
  for (let i = 0; i < cleaned.length; i++) peak = Math.max(peak, Math.abs(cleaned[i]));
  const gate = opts.gate ?? Math.max(0.006, peak * 0.045);

  const hop = Math.max(128, Math.floor(sr * 0.008));
  const win = Math.floor(sr * 0.064);
  const nFrames = Math.max(1, Math.floor((cleaned.length - win) / hop));
  const frame = new Float32Array(win);
  const contour: { t: number; midi: number; conf: number }[] = [];
  const midiSeries: number[] = [];
  const confSeries: number[] = [];
  const eSeries: number[] = [];

  for (let f = 0; f < nFrames; f++) {
    const off = f * hop;
    for (let i = 0; i < win; i++) {
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (win - 1)));
      frame[i] = (cleaned[off + i] || 0) * w;
    }
    const e = rms(frame);
    eSeries.push(e);
    const t = off / sr;
    if (e < gate) {
      midiSeries.push(0);
      confSeries.push(0);
      contour.push({ t, midi: 0, conf: 0 });
      continue;
    }
    const { hz, conf } = mpmPitch(frame, sr);
    const midi = hz > 0 && conf > 0.42 ? hzToMidi(hz) : 0;
    midiSeries.push(midi);
    confSeries.push(conf);
    contour.push({ t, midi, conf });
  }

  const smoothed: number[] = midiSeries.slice();
  for (let i = 2; i < midiSeries.length - 2; i++) {
    const w = midiSeries.slice(i - 2, i + 3).filter((x) => x > 0);
    if (w.length >= 2) smoothed[i] = median(w);
  }

  const fixOctave = (prev: number, next: number): number => {
    if (prev <= 0 || next <= 0) return next;
    let best = next;
    let bestDist = Math.abs(next - prev);
    for (const shift of [-24, -12, 12, 24]) {
      const cand = next + shift;
      const d = Math.abs(cand - prev);
      if (d < bestDist && cand >= 48 && cand <= 88) {
        bestDist = d;
        best = cand;
      }
    }
    return bestDist <= 8 ? best : next;
  };

  const raw: MidiNote[] = [];
  let cur: { midi: number; start: number; peak: number } | null = null;
  const hopT = hop / sr;
  const splitSemis = 1.0;
  let pendingMidi = 0;
  let pendingFrames = 0;

  const flush = (end: number) => {
    if (!cur) return;
    const dur = end - cur.start;
    if (dur >= minDur) {
      raw.push({
        midi: snapMidi(Math.round(cur.midi), snap),
        start: cur.start,
        duration: dur,
        velocity: Math.max(0.35, Math.min(1, 0.2 + cur.peak * 3.5)),
      });
    }
    cur = null;
    pendingMidi = 0;
    pendingFrames = 0;
  };

  for (let i = 0; i < smoothed.length; i++) {
    const t = i * hopT;
    let m = smoothed[i];
    const voiced = m > 0 && confSeries[i] > 0.38 && eSeries[i] > gate;
    if (!voiced) {
      flush(t);
      continue;
    }
    if (cur) m = fixOctave(cur.midi, m);

    if (!cur) {
      cur = { midi: m, start: t, peak: eSeries[i] };
      pendingMidi = m;
      pendingFrames = 1;
      continue;
    }

    const delta = Math.abs(m - cur.midi);
    if (delta < splitSemis) {
      cur.midi = cur.midi * 0.65 + m * 0.35;
      cur.peak = Math.max(cur.peak, eSeries[i]);
      pendingFrames = 0;
      continue;
    }

    if (Math.abs(m - pendingMidi) < splitSemis) pendingFrames++;
    else {
      pendingMidi = m;
      pendingFrames = 1;
    }

    if (pendingFrames >= 3) {
      flush(t);
      cur = { midi: m, start: t, peak: eSeries[i] };
      pendingMidi = m;
      pendingFrames = 1;
    }
  }
  flush(samples.length / sr);

  const duration = samples.length / sr;
  const bpm = opts.bpm && opts.bpm > 0 ? opts.bpm : estimateBpm(raw, duration);

  let notes = raw;
  if (opts.quantize) {
    const grid = 60 / bpm / 4;
    notes = raw.map((n) => {
      const start = Math.max(0, Math.round(n.start / grid) * grid);
      const durationQ = Math.max(grid, Math.round(n.duration / grid) * grid);
      return { ...n, start, duration: durationQ };
    });
  }

  const voicedMidi = notes.map((n) => n.midi);
  const rootMidi = voicedMidi.length
    ? Math.round(voicedMidi.reduce((a, b) => a + b, 0) / voicedMidi.length)
    : 60;
  const voicedFrames = confSeries.filter((c, i) => c > 0.62 && midiSeries[i] > 0).length;

  return {
    notes,
    bpm,
    rootMidi,
    voicedRatio: voicedFrames / Math.max(1, nFrames),
    contour,
    duration,
  };
}

export function midiToPatternGrid(
  notes: MidiNote[],
  steps: number,
  rows: number,
  baseMidi: number,
  loopDur: number,
): { active: boolean; midi: number; velocity: number }[][] {
  const grid = Array.from({ length: steps }, () =>
    Array.from({ length: rows }, (_, row) => ({
      active: false,
      midi: baseMidi + (rows - 1 - row),
      velocity: 0.8,
    })),
  );
  const stepDur = loopDur / steps;
  for (const n of notes) {
    const c = Math.max(0, Math.min(steps - 1, Math.round(n.start / stepDur)));
    let row = rows - 1 - (n.midi - baseMidi);
    row = Math.max(0, Math.min(rows - 1, row));
    for (let r = 0; r < rows; r++) grid[c][r].active = r === row;
    grid[c][row] = { active: true, midi: n.midi, velocity: n.velocity };
  }
  return grid;
}

function vlq(n: number): number[] {
  const bytes: number[] = [];
  let v = n >>> 0;
  bytes.unshift(v & 0x7f);
  v >>= 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return bytes;
}

export function notesToMidiFile(notes: MidiNote[], bpm: number): Blob {
  const tpb = 480;
  const usq = Math.round(60_000_000 / bpm);
  const events: { tick: number; data: number[] }[] = [];
  events.push({ tick: 0, data: [0xff, 0x51, 0x03, (usq >> 16) & 0xff, (usq >> 8) & 0xff, usq & 0xff] });
  for (const n of notes) {
    const on = Math.round(n.start * bpm / 60 * tpb);
    const off = Math.round((n.start + n.duration) * bpm / 60 * tpb);
    const vel = Math.max(1, Math.min(127, Math.round(n.velocity * 127)));
    events.push({ tick: on, data: [0x90, n.midi, vel] });
    events.push({ tick: off, data: [0x80, n.midi, 0] });
  }
  events.sort((a, b) => a.tick - b.tick || a.data[0] - b.data[0]);
  const body: number[] = [];
  let last = 0;
  for (const e of events) {
    body.push(...vlq(e.tick - last), ...e.data);
    last = e.tick;
  }
  body.push(...vlq(0), 0xff, 0x2f, 0x00);
  const trackLen = body.length;
  const bytes = [
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (tpb >> 8) & 0xff, tpb & 0xff,
    0x4d, 0x54, 0x72, 0x6b,
    (trackLen >> 24) & 0xff, (trackLen >> 16) & 0xff, (trackLen >> 8) & 0xff, trackLen & 0xff,
    ...body,
  ];
  return new Blob([new Uint8Array(bytes)], { type: 'audio/midi' });
}

/** Real-time monophonic tracker for live singing. */
export class LiveVoiceTracker {
  private note: number | null = null;
  private hold = 0;
  private pending: number | null = null;
  private pendingCount = 0;

  constructor(
    private onNoteOn: (midi: number, vel: number) => void,
    private onNoteOff: (midi: number) => void,
  ) {}

  push(midi: number, conf: number, rmsVal: number, gate: number, snap: ScaleSnap) {
    const voiced = midi > 0 && conf > 0.68 && rmsVal > gate;
    if (!voiced) {
      this.hold++;
      if (this.hold > 3 && this.note !== null) {
        this.onNoteOff(this.note);
        this.note = null;
      }
      this.pending = null;
      this.pendingCount = 0;
      return;
    }
    this.hold = 0;
    const snapped = snapMidi(midi, snap);
    if (this.note === null) {
      this.note = snapped;
      this.onNoteOn(snapped, Math.max(0.2, Math.min(1, rmsVal * 5)));
      return;
    }
    if (snapped === this.note) {
      this.pending = null;
      this.pendingCount = 0;
      return;
    }
    if (this.pending === snapped) this.pendingCount++;
    else {
      this.pending = snapped;
      this.pendingCount = 1;
    }
    if (this.pendingCount >= 2) {
      this.onNoteOff(this.note);
      this.note = snapped;
      this.onNoteOn(snapped, Math.max(0.2, Math.min(1, rmsVal * 5)));
      this.pending = null;
      this.pendingCount = 0;
    }
  }

  reset() {
    if (this.note !== null) this.onNoteOff(this.note);
    this.note = null;
    this.hold = 0;
  }
}
