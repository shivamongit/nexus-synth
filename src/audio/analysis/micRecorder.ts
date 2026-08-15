export interface CaptureTake {
  samples: Float32Array;
  sampleRate: number;
  duration: number;
  peak: number;
  source?: 'mic' | 'file';
  sourceName?: string;
}

function peakOf(buf: Float32Array): number {
  let p = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > p) p = a;
  }
  return p;
}

function rmsOf(buf: Float32Array): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / Math.max(1, buf.length));
}

/** Drop leading mic-warmup silence so the take starts near the first sung note. */
function trimLeadingSilence(samples: Float32Array, sampleRate: number): Float32Array {
  const hop = Math.max(512, Math.floor(sampleRate * 0.01));
  const gate = 0.004;
  let start = 0;
  for (let i = 0; i < samples.length; i += hop) {
    const to = Math.min(samples.length, i + hop);
    let s = 0;
    for (let j = i; j < to; j++) s += samples[j] * samples[j];
    if (Math.sqrt(s / Math.max(1, to - i)) > gate) {
      start = Math.max(0, i - Math.floor(sampleRate * 0.03));
      break;
    }
  }
  return start > 0 ? samples.slice(start) : samples;
}

/** Dedicated recording graph — isolated from synth worklet. */
export class MicRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private nodes: AudioNode[] = [];
  private chunks: Float32Array[] = [];
  private processor: ScriptProcessorNode | null = null;
  private levelCb: ((rms: number) => void) | null = null;

  get active(): boolean {
    return this.stream != null;
  }

  async start(onLevel?: (rms: number) => void): Promise<void> {
    await this.dispose();
    this.levelCb = onLevel ?? null;
    this.chunks = [];

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
        sampleRate: { ideal: 48000 },
      },
    });

    this.ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    const src = this.ctx.createMediaStreamSource(this.stream);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 70;
    hp.Q.value = 0.7;

    const mute = this.ctx.createGain();
    mute.gain.value = 0.0001;

    const proc = this.ctx.createScriptProcessor(4096, 1, 1);
    this.processor = proc;
    proc.onaudioprocess = (e) => {
      const ch = e.inputBuffer.getChannelData(0);
      const copy = new Float32Array(ch.length);
      copy.set(ch);
      this.chunks.push(copy);
      this.levelCb?.(rmsOf(copy));
    };

    src.connect(hp);
    hp.connect(proc);
    proc.connect(mute);
    mute.connect(this.ctx.destination);
    this.nodes.push(src, hp, proc, mute);
  }

  async stop(): Promise<CaptureTake | null> {
    const ctx = this.ctx;
    const sr = ctx?.sampleRate ?? 48000;
    const chunks = this.chunks.slice();
    await this.dispose();
    const total = chunks.reduce((n, c) => n + c.length, 0);
    if (!total) return null;
    const raw = new Float32Array(total);
    let o = 0;
    for (const c of chunks) {
      raw.set(c, o);
      o += c.length;
    }
    const samples = trimLeadingSilence(raw, sr);
    return {
      samples,
      sampleRate: sr,
      duration: samples.length / sr,
      peak: peakOf(samples),
      source: 'mic',
    };
  }

  async dispose(): Promise<void> {
    this.processor?.disconnect();
    this.nodes.forEach((n) => n.disconnect());
    this.stream?.getTracks().forEach((t) => t.stop());
    this.processor = null;
    this.nodes = [];
    this.stream = null;
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx && ctx.state !== 'closed') {
      try { await ctx.close(); } catch { /* */ }
    }
  }
}
