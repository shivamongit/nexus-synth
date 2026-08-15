import type { MidiNote } from './voiceToMidi';

/** Merge same-pitch notes separated by tiny gaps (vibrato / segmentation noise). */
export function mergeAdjacentNotes(notes: MidiNote[], gapSec = 0.12): MidiNote[] {
  if (!notes.length) return [];
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const out: MidiNote[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const prev = out[out.length - 1];
    const cur = sorted[i];
    if (Math.abs(cur.midi - prev.midi) <= 1 && cur.start - (prev.start + prev.duration) <= gapSec) {
      prev.duration = cur.start + cur.duration - prev.start;
      prev.velocity = Math.max(prev.velocity, cur.velocity);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

/** Keep only the loudest note when multiple overlap (monophonic voice). */
export function enforceMonophonic(notes: MidiNote[]): MidiNote[] {
  if (notes.length < 2) return notes;
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const out: MidiNote[] = [];
  for (const n of sorted) {
    let kept = true;
    for (let i = 0; i < out.length; i++) {
      const o = out[i];
      const oEnd = o.start + o.duration;
      const nEnd = n.start + n.duration;
      const overlap = Math.min(oEnd, nEnd) - Math.max(o.start, n.start);
      if (overlap <= 0) continue;
      if (n.velocity > o.velocity) out.splice(i, 1, n);
      kept = false;
      break;
    }
    if (kept) out.push({ ...n });
  }
  return mergeAdjacentNotes(out);
}

export function dropShortNotes(notes: MidiNote[], minSec = 0.07): MidiNote[] {
  return notes.filter((n) => n.duration >= minSec);
}

export function clampVoiceRange(notes: MidiNote[], lo = 48, hi = 84): MidiNote[] {
  return notes
    .map((n) => ({ ...n, midi: Math.max(lo, Math.min(hi, Math.round(n.midi))) }))
    .filter((n) => n.midi >= lo && n.midi <= hi);
}

function overlapAmount(notes: MidiNote[]): number {
  if (notes.length < 2) return 0;
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  let total = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const ov = Math.min(a.start + a.duration, b.start + b.duration) - b.start;
    if (ov > 0) total += ov;
  }
  return total;
}

/** Higher = better fit for monophonic sung melody. */
export function scoreVoiceNotes(notes: MidiNote[], duration: number): number {
  if (!notes.length || duration < 0.1) return 0;
  const voiced = notes.reduce((s, n) => s + n.duration, 0);
  const coverage = Math.min(1, voiced / (duration * 0.85));
  const density = notes.length / duration;
  const overlap = overlapAmount(notes);
  const shorties = notes.filter((n) => n.duration < 0.06).length;
  const inRange = notes.filter((n) => n.midi >= 50 && n.midi <= 84).length / notes.length;

  let score = coverage * 50;
  score += Math.min(20, notes.length * 1.5);
  score += inRange * 15;
  score -= overlap * 80;
  score -= Math.max(0, density - 7) * 12;
  score -= shorties * 4;
  if (notes.length > duration * 12) score -= 30;
  return score;
}

export function cleanVoiceNotes(notes: MidiNote[]): MidiNote[] {
  return mergeAdjacentNotes(dropShortNotes(notes, 0.08), 0.1);
}
