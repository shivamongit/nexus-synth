import type { StemTrack } from './stemTypes';
import { notesToMidiFile } from './voiceToMidi';

function downloadBlob(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)));
  }
  const buf = new ArrayBuffer(44 + pcm.byteLength);
  const view = new DataView(buf);
  const write = (off: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, pcm.byteLength, true);
  new Int16Array(buf, 44).set(pcm);
  return new Blob([buf], { type: 'audio/wav' });
}

export function exportStemWav(stem: StemTrack): void {
  if (!stem.samples.length) return;
  const blob = encodeWav(stem.samples, stem.sampleRate);
  downloadBlob(blob, `nexus-${stem.kind}.wav`);
}

export function exportStemMidi(stem: StemTrack, bpm = 120): void {
  if (!stem.notes.length) return;
  const blob = notesToMidiFile(stem.notes, bpm);
  downloadBlob(blob, `nexus-${stem.kind}.mid`);
}

/** Export one MIDI file per stem (downloads sequentially). */
export function exportStemMidis(stems: StemTrack[], bpm = 120): void {
  for (const stem of stems) {
    exportStemMidi(stem, bpm);
  }
}
