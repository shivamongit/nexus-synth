import type { StemAudio, StemKind } from './stemTypes';
import { STEM_ORDER } from './stemTypes';

const STEM_API = import.meta.env.VITE_STEM_API_URL as string | undefined;

/** Max song length for Track Rack (keeps trace time reasonable). */
export const TRACK_RACK_MAX_SEC = 360;

export type StemSeparationMode = 'fast' | 'quality';

const POLL_MS = 2000;

async function decodeStemWav(buf: ArrayBuffer): Promise<{ samples: Float32Array; sampleRate: number }> {
  const ctx = new AudioContext();
  try {
    const audio = await ctx.decodeAudioData(buf.slice(0));
    const n = audio.length;
    const out = new Float32Array(n);
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const ch = audio.getChannelData(c);
      for (let i = 0; i < n; i++) out[i] += ch[i] / audio.numberOfChannels;
    }
    return { samples: out, sampleRate: audio.sampleRate };
  } finally {
    await ctx.close().catch(() => {});
  }
}

function mapDemucsName(name: string): StemKind | null {
  const n = name.toLowerCase();
  if (n === 'vocals' || n === 'vocal') return 'vocals';
  if (n === 'drums' || n === 'drum') return 'drums';
  if (n === 'bass') return 'bass';
  if (n === 'other' || n === 'guitar' || n === 'piano') return 'other';
  return null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

export async function cancelSeparationJob(jobId: string): Promise<void> {
  const base = STEM_API?.replace(/\/$/, '');
  if (!base) return;
  try {
    await fetch(`${base}/jobs/${jobId}`, { method: 'DELETE' });
  } catch { /* best effort */ }
}

async function pollSeparationJob(
  base: string,
  jobId: string,
  onProgress?: (pct: number, detail?: string) => void,
  signal?: AbortSignal,
): Promise<{ sample_rate: number; stems: Record<string, string> }> {
  while (true) {
    throwIfAborted(signal);
    let res: Response;
    try {
      res = await fetch(`${base}/jobs/${jobId}`, { signal });
    } catch (e) {
      if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
        throw new DOMException('Aborted', 'AbortError');
      }
      throw new Error('Lost connection to stem separator — is npm run stem-api still running?');
    }
    if (!res.ok) {
      throw new Error('Stem separator job not found');
    }

    const job = await res.json() as {
      status: string;
      phase?: string;
      progress?: number;
      error?: string;
    };

    onProgress?.(0.1 + (job.progress ?? 0) * 0.65, job.phase);

    if (job.status === 'done') {
      const resultRes = await fetch(`${base}/jobs/${jobId}/result`);
      if (!resultRes.ok) {
        const errBody = await resultRes.json().catch(() => null) as { detail?: string } | null;
        throw new Error(errBody?.detail ?? 'Could not fetch separation result');
      }
      return await resultRes.json() as { sample_rate: number; stems: Record<string, string> };
    }
    if (job.status === 'cancelled') {
      throw new DOMException('Aborted', 'AbortError');
    }
    if (job.status === 'error') {
      throw new Error(job.error ?? 'Separation failed');
    }

    await sleep(POLL_MS, signal);
  }
}

/**
 * Demucs htdemucs — state-of-the-art 4-stem separation (requires local API worker).
 */
export async function separateStemsDemucs(
  file: File,
  onProgress?: (pct: number, detail?: string) => void,
  mode: StemSeparationMode = 'fast',
  opts: { signal?: AbortSignal; onJobId?: (id: string) => void } = {},
): Promise<StemAudio[]> {
  const { signal, onJobId } = opts;
  throwIfAborted(signal);
  const base = STEM_API?.replace(/\/$/, '');
  if (!base) {
    throw new Error('Stem separator offline — start the Demucs worker (see Track Rack setup).');
  }

  onProgress?.(0.05);
  const body = new FormData();
  body.append('file', file);

  let res: Response;
  try {
    res = await fetch(`${base}/separate?mode=${mode}`, { method: 'POST', body, signal });
  } catch (e) {
    if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
      throw new DOMException('Aborted', 'AbortError');
    }
    throw new Error('Stem separator connection failed — run npm run stem-api in a terminal.');
  }
  if (!res.ok) {
    const errBody = await res.json().catch(() => null) as { detail?: string } | null;
    const err = errBody?.detail ?? await res.text().catch(() => res.statusText);
    throw new Error(`Separation failed: ${err}`);
  }

  const { job_id: jobId } = await res.json() as { job_id: string };
  onJobId?.(jobId);
  const json = await pollSeparationJob(base, jobId, onProgress, signal);
  throwIfAborted(signal);
  onProgress?.(0.75);

  const byKind = new Map<StemKind, StemAudio>();
  for (const [name, b64] of Object.entries(json.stems)) {
    throwIfAborted(signal);
    const kind = mapDemucsName(name);
    if (!kind || !b64) continue;
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const { samples, sampleRate } = await decodeStemWav(bytes.buffer);
    byKind.set(kind, {
      kind,
      samples,
      sampleRate,
      duration: samples.length / sampleRate,
    });
  }

  const out: StemAudio[] = [];
  for (const kind of STEM_ORDER) {
    const stem = byKind.get(kind);
    if (stem) out.push(stem);
  }
  if (!out.length) {
    throw new Error('Separator returned no stems — check Demucs worker logs.');
  }

  onProgress?.(1);
  return out;
}

export function getStemApiUrl(): string | undefined {
  return STEM_API;
}

export function isStemApiAvailable(): boolean {
  return Boolean(STEM_API);
}

export async function checkStemApiHealth(): Promise<boolean> {
  const base = STEM_API?.replace(/\/$/, '');
  if (!base) return false;
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(4000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function separateStems(
  file: File,
  onProgress?: (pct: number, detail?: string) => void,
  mode: StemSeparationMode = 'fast',
  opts: { signal?: AbortSignal; onJobId?: (id: string) => void } = {},
): Promise<StemAudio[]> {
  return separateStemsDemucs(file, onProgress, mode, opts);
}
