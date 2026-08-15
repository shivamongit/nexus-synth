import { transcribeBasicPitch } from './basicPitchTranscribe';
import { transcribeDrums } from './drumTranscribe';
import { prepareStemAudio, traceConfigForStem } from './stemPrep';
import type { StemAudio } from './stemTypes';
import type { MidiNote } from './voiceToMidi';

/** Neural-only stem trace — skips slow contour fallback. */
export async function transcribeStemFast(
  stem: StemAudio,
  onProgress?: (pct: number) => void,
): Promise<{ notes: MidiNote[]; method: string }> {
  const prepared = prepareStemAudio(stem);

  if (stem.kind === 'drums') {
    return {
      notes: transcribeDrums(prepared.samples, prepared.sampleRate),
      method: 'onsets',
    };
  }

  const cfg = traceConfigForStem(stem.kind);
  const notes = await transcribeBasicPitch(
    prepared.samples,
    prepared.sampleRate,
    onProgress,
    {
      melodia: cfg.melodia,
      minFreqHz: cfg.minFreqHz,
      maxFreqHz: cfg.maxFreqHz,
      postProcess: cfg.postProcess,
    },
  );

  return { notes, method: 'basic pitch' };
}
