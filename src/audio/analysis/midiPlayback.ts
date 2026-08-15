import type { AudioEngine } from '../AudioEngine';
import type { MidiNote } from './voiceToMidi';

type PlayEvent = { t: number; type: 'on' | 'off'; slot: number; midi: number; vel: number };

/**
 * Real-time MIDI playback on the synth clock.
 * Each note instance gets a unique slot so repeated pitches don't cancel.
 */
export function scheduleMidiPlayback(
  engine: AudioEngine,
  notes: MidiNote[],
  handlers: {
    onHead: (sec: number) => void;
    onDone: () => void;
    isAborted: () => boolean;
  },
): () => void {
  if (!notes.length) {
    handlers.onDone();
    return () => {};
  }

  const ctx = engine.ctx;
  const origin = ctx.currentTime + 0.1;
  const events: PlayEvent[] = [];
  let slot = 0;

  for (const n of notes) {
    const dur = Math.max(0.08, n.duration);
    const vel = Math.max(0.5, Math.min(1, n.velocity));
    const id = slot++;
    events.push({ t: origin + n.start, type: 'on', slot: id, midi: n.midi, vel });
    events.push({ t: origin + n.start + dur, type: 'off', slot: id, midi: n.midi, vel: 0 });
  }
  events.sort((a, b) => a.t - b.t || (a.type === 'off' ? -1 : 1));

  const end = origin + notes.reduce(
    (m, n) => Math.max(m, n.start + Math.max(0.08, n.duration)),
    0,
  );
  let idx = 0;
  let raf = 0;

  const tick = () => {
    if (handlers.isAborted()) return;
    const now = ctx.currentTime;
    const horizon = now + 0.12;
    while (idx < events.length && events[idx].t <= horizon) {
      const e = events[idx++];
      if (e.type === 'on') {
        if (e.t >= now - 0.2) {
          engine.seqNoteOn(e.slot, e.midi, e.vel, e.t, { speak: true });
        }
      } else {
        engine.seqNoteOff(e.slot, e.t);
      }
    }
    handlers.onHead(Math.max(0, now - origin));
    if (now >= end + 0.08 && idx >= events.length) {
      handlers.onDone();
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
