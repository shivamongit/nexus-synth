import type { MidiNote } from './voiceToMidi';
import { voiceToMidi } from './voiceToMidi';
import { BP_DEFAULTS, transcribeBasicPitch, type BasicPitchOptions } from './basicPitchTranscribe';
import { cleanVoiceNotes, enforceMonophonic, scoreVoiceNotes } from './noteCleanup';
import { prepareForTranscription } from './audioPrep';

export type TranscribeMethod = 'neural' | 'contour';

export interface PitchlineOptions {
  /** Mic capture vs uploaded file — file uses polyphonic Basic Pitch (like basicpitch.io). */
  sourceKind?: 'mic' | 'file';
  /** 0 = strict (fewer notes), 100 = sensitive (more notes). 50 = official onset 0.5 */
  onsetSens?: number;
  /** 0 = strict, 100 = sensitive. 50 = official frame 0.3 */
  frameSens?: number;
  minFreqHz?: number | null;
  maxFreqHz?: number | null;
  trimSilence?: boolean;
  melodia?: boolean;
}

export interface TranscribeResult {
  notes: MidiNote[];
  method: TranscribeMethod;
  modelReady: boolean;
  offsetSec: number;
}

function mapOnset(sens: number): number {
  const t = Math.max(0, Math.min(100, sens)) / 100;
  return BP_DEFAULTS.onset + (0.5 - t) * 0.35;
}

function mapFrame(sens: number): number {
  const t = Math.max(0, Math.min(100, sens)) / 100;
  return BP_DEFAULTS.frame + (0.5 - t) * 0.22;
}

function toBasicPitchOpts(opts: PitchlineOptions): BasicPitchOptions {
  const isFile = opts.sourceKind === 'file';
  return {
    onset: mapOnset(opts.onsetSens ?? 50),
    frame: mapFrame(opts.frameSens ?? 50),
    minFreqHz: opts.minFreqHz ?? null,
    maxFreqHz: opts.maxFreqHz ?? null,
    melodia: opts.melodia ?? !isFile,
    postProcess: isFile ? 'poly' : 'voice',
  };
}

function shiftNotes(notes: MidiNote[], offsetSec: number): MidiNote[] {
  if (offsetSec <= 0) return notes;
  return notes.map((n) => ({ ...n, start: n.start + offsetSec }));
}

function pickBest(
  neural: MidiNote[],
  contour: MidiNote[],
  duration: number,
): { notes: MidiNote[]; method: TranscribeMethod } {
  const neuralScore = scoreVoiceNotes(neural, duration);
  const contourScore = scoreVoiceNotes(contour, duration);
  if (neural.length >= 2 && neuralScore >= contourScore - 5) {
    return { notes: neural, method: 'neural' };
  }
  if (contour.length && contourScore > neuralScore) {
    return { notes: contour, method: 'contour' };
  }
  if (neural.length) return { notes: neural, method: 'neural' };
  return { notes: contour, method: 'contour' };
}

/**
 * Pitchline voice transcription.
 * Primary: official Basic Pitch decoder (melodia monophonic mode).
 * Fallback: MPM pitch contour when neural quality is poor.
 */
export async function transcribeVoice(
  samples: Float32Array,
  sampleRate: number,
  onProgress?: (pct: number) => void,
  opts: PitchlineOptions = {},
): Promise<TranscribeResult> {
  const { samples: prepared, offsetSec } = prepareForTranscription(samples, sampleRate, {
    trim: opts.trimSilence ?? false,
  });
  const duration = prepared.length / sampleRate;

  let neural: MidiNote[] = [];
  let modelReady = false;
  try {
    neural = shiftNotes(
      await transcribeBasicPitch(
        prepared,
        sampleRate,
        onProgress,
        toBasicPitchOpts(opts),
      ),
      offsetSec,
    );
    modelReady = true;
  } catch (e) {
    console.warn('[Pitchline] Basic Pitch failed', e);
  }

  onProgress?.(0.92);
  const contour = shiftNotes(
    cleanVoiceNotes(
      voiceToMidi(prepared, {
        sampleRate,
        snap: 'chromatic',
        quantize: false,
        minNoteMs: 90,
      }).notes,
    ),
    offsetSec,
  );
  onProgress?.(1);

  const picked = opts.sourceKind === 'file'
    ? { notes: neural, method: 'neural' as TranscribeMethod }
    : pickBest(neural, contour, duration);
  return { ...picked, modelReady, offsetSec };
}
