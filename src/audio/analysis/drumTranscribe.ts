import type { MidiNote } from './voiceToMidi';

/** GM drum map for playback */
const KICK = 36;
const SNARE = 38;
const HAT = 42;

/**
 * Onset-based drum MIDI from percussive stem.
 * Classifies hits by spectral centroid into kick / snare / hat.
 */
export function transcribeDrums(samples: Float32Array, sampleRate: number): MidiNote[] {
  const hop = Math.floor(sampleRate * 0.01);
  const win = Math.floor(sampleRate * 0.04);
  const nFrames = Math.max(1, Math.floor((samples.length - win) / hop));
  const flux: number[] = [];
  let prevE = 0;

  for (let f = 0; f < nFrames; f++) {
    const off = f * hop;
    let e = 0;
    let weighted = 0;
    for (let i = 0; i < win && off + i < samples.length; i++) {
      const x = samples[off + i];
      e += x * x;
      weighted += Math.abs(x) * i;
    }
    const rms = Math.sqrt(e / win);
    flux.push(Math.max(0, rms - prevE));
    prevE = rms * 0.92;
  }

  const thresh = Math.max(0.008, percentile(flux, 0.72));
  const notes: MidiNote[] = [];
  let lastT = -1;

  for (let f = 0; f < nFrames; f++) {
    if (flux[f] < thresh) continue;
    const t = (f * hop) / sampleRate;
    if (t - lastT < 0.06) continue;
    lastT = t;

    const off = f * hop;
    let lowE = 0;
    let midE = 0;
    let hiE = 0;
    const seg = Math.min(win, samples.length - off);
    for (let i = 0; i < seg; i++) {
      const x = samples[off + i] ** 2;
      if (i < seg * 0.15) lowE += x;
      else if (i < seg * 0.5) midE += x;
      else hiE += x;
    }
    const total = lowE + midE + hiE + 1e-12;
    let midi = SNARE;
    if (lowE / total > 0.45) midi = KICK;
    else if (hiE / total > 0.4) midi = HAT;

    notes.push({
      midi,
      start: t,
      duration: 0.08,
      velocity: Math.min(1, 0.45 + flux[f] * 8),
    });
  }
  return notes;
}

function percentile(arr: number[], p: number): number {
  const a = arr.filter((x) => x > 0).sort((x, y) => x - y);
  if (!a.length) return 0;
  return a[Math.floor(p * (a.length - 1))];
}
