/** Audio prep for Pitchline — matches official Basic Pitch (resample only, no trim). */

export function highpass(samples: Float32Array, sampleRate: number, hz = 65): Float32Array {
  const out = new Float32Array(samples.length);
  const rc = 1 / (2 * Math.PI * hz);
  const dt = 1 / sampleRate;
  const a = rc / (rc + dt);
  let prevX = 0;
  let prevY = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const y = a * (prevY + x - prevX);
    out[i] = y;
    prevX = x;
    prevY = y;
  }
  return out;
}

export function peakNormalize(samples: Float32Array, target = 0.92): Float32Array {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak < 1e-5 || peak >= target) return samples;
  const g = target / peak;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * g;
  return out;
}

/** Trim only leading/trailing silence — returns offset so note times stay aligned with raw take. */
export function trimSilence(
  samples: Float32Array,
  sampleRate: number,
  gate = 0.006,
  padMs = 40,
): { samples: Float32Array; offsetSec: number } {
  if (samples.length < sampleRate * 0.1) {
    return { samples, offsetSec: 0 };
  }
  const hop = Math.max(256, Math.floor(sampleRate * 0.012));
  const pad = Math.floor((sampleRate * padMs) / 1000);

  const frameRms = (from: number): number => {
    const to = Math.min(samples.length, from + hop);
    let s = 0;
    for (let i = from; i < to; i++) s += samples[i] * samples[i];
    return Math.sqrt(s / Math.max(1, to - from));
  };

  let start = 0;
  for (let i = 0; i < samples.length; i += hop) {
    if (frameRms(i) > gate) {
      start = Math.max(0, i - pad);
      break;
    }
  }

  let end = samples.length;
  for (let i = samples.length - hop; i >= 0; i -= hop) {
    if (frameRms(i) > gate) {
      end = Math.min(samples.length, i + hop + pad);
      break;
    }
  }

  if (end <= start + sampleRate * 0.12) {
    return { samples, offsetSec: 0 };
  }
  return {
    samples: samples.slice(start, end),
    offsetSec: start / sampleRate,
  };
}

/**
 * Prep for Basic Pitch: high-pass rumble, peak-normalize, optional trim with time offset.
 * Official BP does not trim — trimming is optional and offset is added back to note times.
 */
export function prepareForTranscription(
  samples: Float32Array,
  sampleRate: number,
  opts: { trim?: boolean } = {},
): { samples: Float32Array; offsetSec: number } {
  let out = highpass(samples, sampleRate, 65);
  out = peakNormalize(out, 0.92);
  if (opts.trim) {
    const trimmed = trimSilence(out, sampleRate);
    return trimmed;
  }
  return { samples: out, offsetSec: 0 };
}
