import { PRESETS } from '../presets';
import { ensurePitchlineModel } from './basicPitchTranscribe';
import { matchPresetForStem } from './presetMatcher';
import { separateStems, type StemSeparationMode } from './stemSeparate';
import { transcribeStemFast } from './stemTranscribe';
import type { StemForgeResult, StemKind, StemTrack } from './stemTypes';
import { STEM_LABELS, STEM_ORDER } from './stemTypes';

export interface TrackRackProgressUpdate {
  label: string;
  pct: number;
  detail?: string;
  stemTrace?: Partial<Record<StemKind, number>>;
}

export interface TrackRackOptions {
  separationMode?: StemSeparationMode;
  signal?: AbortSignal;
  onJobId?: (id: string) => void;
  onsetSens?: number;
  frameSens?: number;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

export async function processTrackRack(
  file: File,
  onPhase: (update: TrackRackProgressUpdate) => void,
  opts: TrackRackOptions = {},
): Promise<StemForgeResult> {
  const mode = opts.separationMode ?? 'fast';
  const { signal, onJobId } = opts;
  throwIfAborted(signal);
  const sepLabel = mode === 'quality' ? 'Separating stems (quality)…' : 'Separating stems…';
  onPhase({ label: sepLabel, pct: 0.05 });
  const stemAudio = await separateStems(
    file,
    (p, detail) => onPhase({ label: sepLabel, pct: p * 0.4, detail }),
    mode,
    { signal, onJobId },
  );

  throwIfAborted(signal);
  onPhase({ label: 'Loading trace model…', pct: 0.42 });
  await ensurePitchlineModel();

  throwIfAborted(signal);
  const stemTrace: Partial<Record<StemKind, number>> = {};
  onPhase({ label: 'Tracing stems to MIDI…', pct: 0.45, stemTrace });

  const progress = new Map<string, number>();
  const updateParallel = () => {
    const vals = [...progress.values()];
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    for (const [k, v] of progress) stemTrace[k as StemKind] = v;
    onPhase({
      label: 'Tracing stems to MIDI…',
      pct: 0.45 + avg * 0.5,
      stemTrace: { ...stemTrace },
    });
  };

  const traced = await Promise.all(
    stemAudio.map(async (stem) => {
      throwIfAborted(signal);
      const { notes, method } = await transcribeStemFast(stem, (p) => {
        progress.set(stem.kind, p);
        updateParallel();
      });
      const { idx, name } = matchPresetForStem(
        stem.kind,
        stem.samples,
        stem.sampleRate,
        notes,
        PRESETS,
      );
      const track: StemTrack = {
        kind: stem.kind,
        label: STEM_LABELS[stem.kind],
        samples: stem.samples,
        sampleRate: stem.sampleRate,
        duration: stem.duration,
        notes,
        presetIdx: idx,
        presetName: name,
        method,
        muted: false,
        solo: false,
      };
      progress.set(stem.kind, 1);
      updateParallel();
      return track;
    }),
  );

  const order = new Map(STEM_ORDER.map((k, i) => [k, i]));
  traced.sort((a, b) => (order.get(a.kind) ?? 0) - (order.get(b.kind) ?? 0));

  onPhase({ label: 'Ready', pct: 1, stemTrace: Object.fromEntries(STEM_ORDER.map((k) => [k, 1])) as Record<StemKind, number> });
  const duration = Math.max(...traced.map((t) => t.duration), 0);
  return {
    stems: traced,
    duration,
    sampleRate: traced[0]?.sampleRate ?? 44100,
    separator: mode === 'quality' ? 'demucs-quality' : 'demucs-fast',
  };
}

export function applyStemMuteSolo(stems: StemTrack[]): StemTrack[] {
  const anySolo = stems.some((s) => s.solo);
  return stems.map((s) => ({
    ...s,
    muted: anySolo ? !s.solo : s.muted,
  }));
}

export function audibleStems(stems: StemTrack[]): StemTrack[] {
  return applyStemMuteSolo(stems).filter((s) => !s.muted);
}

/** @deprecated use processTrackRack */
export const processStemForge = processTrackRack;
