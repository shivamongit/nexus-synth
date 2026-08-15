export interface CaptureTake {
  samples: Float32Array;
  sampleRate: number;
  duration: number;
  peak: number;
  source?: 'mic' | 'file';
  sourceName?: string;
}

/** Formats supported by Web Audio decodeAudioData / Basic Pitch. */
export const AUDIO_UPLOAD_ACCEPT = 'audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aac,.webm,.aiff,.aif';

const MAX_DURATION_SEC = 600;

function peakOf(buf: Float32Array): number {
  let p = 0;
  for (let i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i]));
  return p;
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  const n = buffer.length;
  const out = new Float32Array(n);
  const chans = buffer.numberOfChannels;
  for (let c = 0; c < chans; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += ch[i] / chans;
  }
  return out;
}

function decodeWithContext(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
  const ctx = new AudioContext();
  const copy = arrayBuffer.slice(0);
  return ctx.decodeAudioData(copy).finally(() => {
    void ctx.close().catch(() => {});
  });
}

/**
 * Decode an uploaded audio file to mono samples.
 * Uses a dedicated AudioContext so decode never blocks the synth graph.
 */
export async function decodeAudioFile(
  file: File,
  onPhase?: (msg: string) => void,
): Promise<CaptureTake> {
  if (!file.type.startsWith('audio/') && !/\.(wav|mp3|ogg|flac|m4a|aac|webm|aiff?)$/i.test(file.name)) {
    throw new Error('Unsupported file — use WAV, MP3, OGG, FLAC, or M4A.');
  }
  if (file.size > 80 * 1024 * 1024) {
    throw new Error('File too large — max 80 MB.');
  }

  onPhase?.('Reading file…');
  const arrayBuffer = await file.arrayBuffer();

  onPhase?.('Decoding audio…');
  let buffer: AudioBuffer;
  try {
    buffer = await decodeWithContext(arrayBuffer);
  } catch {
    throw new Error('Could not decode audio — try WAV or MP3.');
  }

  onPhase?.('Preparing waveform…');
  await new Promise<void>((r) => requestAnimationFrame(() => r()));

  const samples = mixToMono(buffer);
  const duration = samples.length / buffer.sampleRate;
  if (duration < 0.2) {
    throw new Error('Audio too short — need at least 0.2 seconds.');
  }
  if (duration > MAX_DURATION_SEC) {
    throw new Error(`Audio too long — max ${MAX_DURATION_SEC / 60} minutes.`);
  }

  return {
    samples,
    sampleRate: buffer.sampleRate,
    duration,
    peak: peakOf(samples),
    source: 'file',
    sourceName: file.name,
  };
}
