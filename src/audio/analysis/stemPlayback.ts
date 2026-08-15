import type { AudioEngine } from '../AudioEngine';
import { audibleStems } from './stemPipeline';
import type { StemTrack } from './stemTypes';
import type { MidiNote } from './voiceToMidi';
import { scheduleMidiPlayback } from './midiPlayback';

type PlayEvent = { t: number; type: 'on' | 'off'; slot: number; midi: number; vel: number };

export interface StemAudioPlayer {
  play: (offsetSec?: number) => void;
  pause: () => void;
  stop: () => void;
  seek: (sec: number) => void;
  isPlaying: () => boolean;
  getHead: () => number;
}

export function playStemAudio(
  engine: AudioEngine,
  stem: StemTrack,
  previewRef: { current: AudioBufferSourceNode | null },
): void {
  try { previewRef.current?.stop(); } catch { /* */ }
  const player = createStemAudioPlayer(engine, stem, () => {}, () => {});
  previewRef.current = null;
  player.play(0);
  // hold reference via closure — one-shot preview
  const ctx = engine.ctx;
  const buffer = ctx.createBuffer(1, stem.samples.length, stem.sampleRate);
  buffer.getChannelData(0).set(stem.samples);
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  g.gain.value = 0.92;
  src.buffer = buffer;
  src.connect(g);
  g.connect(ctx.destination);
  previewRef.current = src;
  src.onended = () => {
    if (previewRef.current === src) previewRef.current = null;
  };
  src.start();
}

export function createStemAudioPlayer(
  engine: AudioEngine,
  stem: StemTrack,
  onHead: (sec: number) => void,
  onEnded: () => void,
): StemAudioPlayer {
  let source: AudioBufferSourceNode | null = null;
  let gain: GainNode | null = null;
  let startedAt = 0;
  let offset = 0;
  let playing = false;
  let raf = 0;

  const buffer = engine.ctx.createBuffer(1, stem.samples.length, stem.sampleRate);
  buffer.getChannelData(0).set(stem.samples);

  const tick = () => {
    if (!playing) return;
    const head = Math.min(stem.duration, offset + (engine.ctx.currentTime - startedAt));
    onHead(head);
    if (head >= stem.duration - 0.02) {
      stop();
      onEnded();
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  const stopSource = () => {
    try { source?.stop(); } catch { /* */ }
    source = null;
    gain = null;
    cancelAnimationFrame(raf);
  };

  const play = (offsetSec = offset) => {
    stopSource();
    offset = Math.max(0, Math.min(stem.duration, offsetSec));
    source = engine.ctx.createBufferSource();
    gain = engine.ctx.createGain();
    gain.gain.value = 0.92;
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(engine.ctx.destination);
    source.onended = () => {
      if (playing) {
        playing = false;
        onHead(stem.duration);
        onEnded();
      }
      stopSource();
    };
    startedAt = engine.ctx.currentTime;
    playing = true;
    source.start(0, offset);
    raf = requestAnimationFrame(tick);
  };

  const pause = () => {
    if (!playing) return;
    offset = Math.min(stem.duration, offset + (engine.ctx.currentTime - startedAt));
    playing = false;
    stopSource();
    onHead(offset);
  };

  const stop = () => {
    playing = false;
    offset = 0;
    stopSource();
    onHead(0);
  };

  const seek = (sec: number) => {
    const wasPlaying = playing;
    pause();
    offset = Math.max(0, Math.min(stem.duration, sec));
    onHead(offset);
    if (wasPlaying) play(offset);
  };

  return {
    play,
    pause,
    stop,
    seek,
    isPlaying: () => playing,
    getHead: () => (playing ? offset + (engine.ctx.currentTime - startedAt) : offset),
  };
}

export function scheduleSingleStemMidi(
  engine: AudioEngine,
  stem: StemTrack,
  handlers: {
    onHead: (sec: number) => void;
    onDone: () => void;
    isAborted: () => boolean;
  },
  offsetSec = 0,
): () => void {
  const shifted = offsetSec > 0
    ? stem.notes
      .filter((n) => n.start + n.duration > offsetSec)
      .map((n) => ({ ...n, start: Math.max(0, n.start - offsetSec) }))
    : stem.notes;
  return scheduleMidiPlayback(engine, shifted, handlers);
}

/** Schedule all audible stem MIDI lanes on the synth clock. */
export function scheduleStemPlayback(
  engine: AudioEngine,
  stems: StemTrack[],
  handlers: {
    onHead: (sec: number) => void;
    onDone: () => void;
    isAborted: () => boolean;
  },
): () => void {
  const active = audibleStems(stems);
  const flat: MidiNote[] = active.flatMap((s) => s.notes);

  if (!flat.length) {
    handlers.onDone();
    return () => {};
  }

  const ctx = engine.ctx;
  const origin = ctx.currentTime + 0.1;
  const events: PlayEvent[] = [];
  let slot = 0;

  for (const stem of active) {
    for (const n of stem.notes) {
      const dur = Math.max(0.08, n.duration);
      const vel = Math.max(0.5, Math.min(1, n.velocity));
      const id = slot++;
      events.push({ t: origin + n.start, type: 'on', slot: id, midi: n.midi, vel });
      events.push({ t: origin + n.start + dur, type: 'off', slot: id, midi: n.midi, vel: 0 });
    }
  }
  events.sort((a, b) => a.t - b.t || (a.type === 'off' ? -1 : 1));

  const end = origin + flat.reduce(
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
