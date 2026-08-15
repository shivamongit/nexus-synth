import type { StemAudio, StemKind } from './stemTypes';

function lowpass(samples: Float32Array, sr: number, hz: number): Float32Array {
  const out = new Float32Array(samples.length);
  const rc = 1 / (2 * Math.PI * hz);
  const dt = 1 / sr;
  const a = dt / (rc + dt);
  let y = 0;
  for (let i = 0; i < samples.length; i++) {
    y += a * (samples[i] - y);
    out[i] = y;
  }
  return out;
}

function highpass(samples: Float32Array, sr: number, hz: number): Float32Array {
  const lp = lowpass(samples, sr, hz);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] - lp[i];
  return out;
}

function peakNormalize(samples: Float32Array, target = 0.92): Float32Array {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak < 1e-5) return samples;
  const g = Math.min(target / peak, 4);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * g;
  return out;
}

/** Isolate frequency content per stem before MIDI trace — reduces bleed in notation. */
export function prepareStemAudio(stem: StemAudio): StemAudio {
  const { kind, sampleRate } = stem;
  let samples = stem.samples;

  switch (kind) {
    case 'vocals':
      // HQ Demucs vocal stem — trace as-is (playback/download use raw samples on StemTrack)
      return { ...stem, samples: peakNormalize(stem.samples) };
    case 'bass':
      samples = lowpass(samples, sampleRate, 280);
      break;
    case 'drums':
      samples = highpass(samples, sampleRate, 80);
      break;
    case 'other':
      samples = highpass(samples, sampleRate, 180);
      samples = lowpass(samples, sampleRate, 8000);
      break;
  }

  return {
    ...stem,
    samples: peakNormalize(samples),
  };
}

export interface StemTraceConfig {
  melodia: boolean;
  minFreqHz: number | null;
  maxFreqHz: number | null;
  postProcess: 'voice' | 'poly';
}

export function traceConfigForStem(kind: StemKind): StemTraceConfig {
  switch (kind) {
    case 'vocals':
      return { melodia: true, minFreqHz: 65, maxFreqHz: 1400, postProcess: 'voice' };
    case 'bass':
      return { melodia: true, minFreqHz: 38, maxFreqHz: 420, postProcess: 'voice' };
    case 'drums':
      return { melodia: false, minFreqHz: null, maxFreqHz: null, postProcess: 'poly' };
    case 'other':
      return { melodia: false, minFreqHz: 120, maxFreqHz: 5000, postProcess: 'poly' };
  }
}
