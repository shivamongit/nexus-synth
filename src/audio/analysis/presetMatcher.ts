import type { Preset } from '../presets';
import type { StemKind } from './stemTypes';
import type { MidiNote } from './voiceToMidi';

const KIND_CATEGORY: Record<StemKind, string[]> = {
  vocals: ['Lead', 'Keys'],
  drums: ['FX', 'Pluck'],
  bass: ['Bass'],
  other: ['Keys', 'Pad', 'Pluck', 'Lead'],
};

function spectralCentroid(samples: Float32Array, sampleRate: number): number {
  const n = Math.min(4096, samples.length);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const m = Math.abs(samples[i]);
    num += m * i;
    den += m;
  }
  return den > 0 ? (num / den) * (sampleRate / n) : 1000;
}

export function matchPresetForStem(
  kind: StemKind,
  samples: Float32Array,
  sampleRate: number,
  notes: MidiNote[],
  presets: Preset[],
): { idx: number; name: string } {
  const cats = KIND_CATEGORY[kind];
  const candidates = presets
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => cats.includes(p.category));

  if (!candidates.length) {
    return { idx: 0, name: presets[0]?.name ?? 'INIT' };
  }

  const centroid = spectralCentroid(samples, sampleRate);
  const avgMidi = notes.length
    ? notes.reduce((s, n) => s + n.midi, 0) / notes.length
    : 60;

  let best = candidates[0];
  let bestScore = -Infinity;

  for (const c of candidates) {
    let score = 0;
    const par = c.p.params;
    const f = par.filter.frequency;
    const cat = c.p.category;

    if (kind === 'bass') {
      score += avgMidi < 48 ? 3 : 0;
      score += f < 800 ? 4 : 0;
      score += cat === 'Bass' ? 5 : 0;
    } else if (kind === 'vocals') {
      score += cat === 'Lead' ? 4 : 0;
      score += f > 2000 ? 2 : 0;
      score += par.osc1.waveform === 'sawtooth' ? 1 : 0;
    } else if (kind === 'drums') {
      score += par.noiseLevel > 0.1 ? 5 : 0;
      score += cat === 'FX' ? 3 : 0;
    } else {
      score += cat === 'Keys' ? 3 : cat === 'Pad' ? 2 : 1;
      score += centroid > 1500 && centroid < 6000 ? 2 : 0;
    }

    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  return { idx: best.idx, name: best.p.name };
}
