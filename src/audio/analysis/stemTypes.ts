import type { MidiNote } from './voiceToMidi';

export type StemKind = 'vocals' | 'drums' | 'bass' | 'other';

export const STEM_ORDER: StemKind[] = ['vocals', 'drums', 'bass', 'other'];

export const STEM_LABELS: Record<StemKind, string> = {
  vocals: 'Vocals',
  drums: 'Drums',
  bass: 'Bass',
  other: 'Other',
};

export const STEM_COLORS: Record<StemKind, string> = {
  vocals: '#00d4ff',
  drums: '#ff4d8d',
  bass: '#a78bfa',
  other: '#fbbf24',
};

export interface StemAudio {
  kind: StemKind;
  samples: Float32Array;
  sampleRate: number;
  duration: number;
}

export interface StemTrack {
  kind: StemKind;
  label: string;
  samples: Float32Array;
  sampleRate: number;
  duration: number;
  notes: MidiNote[];
  presetIdx: number;
  presetName: string;
  method: string;
  muted: boolean;
  solo: boolean;
}

export interface StemForgeResult {
  stems: StemTrack[];
  duration: number;
  sampleRate: number;
  separator: 'demucs' | 'demucs-fast' | 'demucs-quality' | 'browser';
}

export type StemForgePhase =
  | 'decoding'
  | 'separating'
  | 'loading-model'
  | 'transcribing'
  | 'matching'
  | 'done';
