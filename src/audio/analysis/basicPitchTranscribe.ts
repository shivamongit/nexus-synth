import * as tf from '@tensorflow/tfjs';
import {
  addPitchBendsToNoteEvents,
  BasicPitch,
  noteFramesToTime,
  outputToNotesPoly,
} from '@spotify/basic-pitch';
import type { MidiNote } from './voiceToMidi';
import { cleanVoiceNotes, enforceMonophonic } from './noteCleanup';

const TARGET_SR = 22050;

/** Matches Python: round(127.7 / 1000 * (AUDIO_SAMPLE_RATE / FFT_HOP)) */
const MIN_NOTE_LEN_FRAMES = Math.round((127.7 / 1000) * (TARGET_SR / 256));

/** Official Python defaults from basic_pitch/inference.py */
export const BP_DEFAULTS = {
  onset: 0.5,
  frame: 0.3,
  minNoteLen: MIN_NOTE_LEN_FRAMES,
  melodia: true,
  inferOnsets: true,
} as const;

export interface BasicPitchOptions {
  onset?: number;
  frame?: number;
  minNoteLen?: number;
  minFreqHz?: number | null;
  maxFreqHz?: number | null;
  melodia?: boolean;
  /** voice = monophonic cleanup; poly = full Basic Pitch output (uploads) */
  postProcess?: 'voice' | 'poly';
}

let pitch: BasicPitch | null = null;
let loading: Promise<BasicPitch> | null = null;
let loadError: string | null = null;

export function pitchlineModelError(): string | null {
  return loadError;
}

async function getPitch(): Promise<BasicPitch> {
  if (pitch) return pitch;
  if (loadError) throw new Error(loadError);
  if (!loading) {
    loading = (async () => {
      await tf.ready();
      try {
        await tf.setBackend('webgl');
        await tf.ready();
      } catch { /* CPU fallback */ }
      const url = `${import.meta.env.BASE_URL}basic-pitch/model.json`;
      const model = new BasicPitch(url);
      await model.model;
      pitch = model;
      loadError = null;
      return model;
    })().catch((err) => {
      loading = null;
      loadError = err instanceof Error ? err.message : 'Model load failed';
      throw err;
    });
  }
  return loading;
}

export function warmupPitchline(): Promise<BasicPitch> {
  return getPitch();
}

export function isPitchlineModelReady(): boolean {
  return pitch !== null;
}

/** Wait for TF.js model — call before first transcribe (uploads). */
export async function ensurePitchlineModel(timeoutMs = 120_000): Promise<void> {
  await Promise.race([
    getPitch(),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Model load timed out — hard-refresh and try again')), timeoutMs);
    }),
  ]);
}

export async function resampleTo22050(samples: Float32Array, fromSr: number): Promise<Float32Array> {
  if (Math.abs(fromSr - TARGET_SR) < 1) return samples;
  const Offline = window.OfflineAudioContext
    || (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (Offline) {
    const frames = Math.max(1, Math.ceil((samples.length / fromSr) * TARGET_SR));
    const ctx = new Offline(1, frames, TARGET_SR);
    const buf = ctx.createBuffer(1, samples.length, fromSr);
    buf.getChannelData(0).set(samples);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
    const rendered = await ctx.startRendering();
    return rendered.getChannelData(0).slice();
  }
  const ratio = fromSr / TARGET_SR;
  const outLen = Math.max(1, Math.round(samples.length / ratio));
  const out = new Float32Array(outLen);
  const last = samples.length - 1;
  for (let i = 0; i < outLen; i++) {
    const x = i * ratio;
    const i0 = Math.min(last, Math.floor(x));
    const i1 = Math.min(last, i0 + 1);
    const f = x - i0;
    out[i] = samples[i0] * (1 - f) + samples[i1] * f;
  }
  return out;
}

function eventsToMidi(
  events: ReturnType<typeof noteFramesToTime>,
  polyphonic: boolean,
): MidiNote[] {
  const lo = polyphonic ? 21 : 36;
  const hi = polyphonic ? 108 : 96;
  return events
    .filter((n) => n.pitchMidi >= lo && n.pitchMidi <= hi && n.durationSeconds >= 0.05)
    .map((n) => ({
      midi: Math.round(n.pitchMidi),
      start: Math.max(0, n.startTimeSeconds),
      duration: Math.max(polyphonic ? 0.05 : 0.08, n.durationSeconds),
      velocity: Math.max(0.4, Math.min(1, n.amplitude)),
    }))
    .sort((a, b) => a.start - b.start);
}

/**
 * Official Basic Pitch pipeline — matches spotify/basic-pitch Python predict().
 */
export async function transcribeBasicPitch(
  samples: Float32Array,
  sampleRate: number,
  onProgress?: (pct: number) => void,
  opts: BasicPitchOptions = {},
): Promise<MidiNote[]> {
  const bp = await getPitch();
  const resampled = await resampleTo22050(samples, sampleRate);
  onProgress?.(0.08);

  const onset = opts.onset ?? BP_DEFAULTS.onset;
  const frame = opts.frame ?? BP_DEFAULTS.frame;
  const minNoteLen = opts.minNoteLen ?? BP_DEFAULTS.minNoteLen;
  const minFreq = opts.minFreqHz ?? null;
  const maxFreq = opts.maxFreqHz ?? null;
  const melodia = opts.melodia ?? BP_DEFAULTS.melodia;

  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];

  await bp.evaluateModel(
    resampled,
    (f, o, c) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    (p) => {
      onProgress?.(0.08 + p * 0.84);
    },
  );

  if (!frames.length || !onsets.length) return [];

  const noteEvents = outputToNotesPoly(
    frames,
    onsets,
    onset,
    frame,
    minNoteLen,
    BP_DEFAULTS.inferOnsets,
    maxFreq,
    minFreq,
    melodia,
  );

  const timed = noteFramesToTime(
    addPitchBendsToNoteEvents(contours, noteEvents),
  );

  onProgress?.(0.98);
  const polyphonic = (opts.postProcess ?? 'voice') === 'poly';
  const raw = eventsToMidi(timed, polyphonic);
  return polyphonic ? raw : cleanVoiceNotes(enforceMonophonic(raw));
}
