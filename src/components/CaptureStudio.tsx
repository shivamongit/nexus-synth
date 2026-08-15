import React, { useEffect, useRef, useState } from 'react';
import { AudioEngine } from '../audio/AudioEngine';
import { audioToPattern, type PatternStep, type ScaleSnap } from '../audio/analysis/audioToPattern';
import { GRID_BASE, NUM_ROWS, NUM_STEPS, type SeqCell } from './Sequencer';
import Knob from './Knob';

interface CaptureStudioProps {
  engine: AudioEngine | null;
  initAudio: () => AudioEngine;
  onPattern: (grid: SeqCell[][], bpm: number, rootMidi: number) => void;
  sampleMix: number;
  onSampleMix: (v: number) => void;
  followFilter: boolean;
  onFollowFilter: (v: boolean) => void;
}

const CaptureStudio: React.FC<CaptureStudioProps> = ({
  engine, initAudio, onPattern, sampleMix, onSampleMix, followFilter, onFollowFilter,
}) => {
  const [status, setStatus] = useState<'idle' | 'arming' | 'recording' | 'ready'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [snap, setSnap] = useState<ScaleSnap>('chromatic');
  const [gate, setGate] = useState(0.04);
  const [seconds, setSeconds] = useState(4);
  const [voiced, setVoiced] = useState(0);
  const [bpmGuess, setBpmGuess] = useState(120);
  const [level, setLevel] = useState(0);
  const chunksRef = useRef<Float32Array[]>([]);
  const recNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const silentRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);
  const resultRef = useRef<PatternStep[] | null>(null);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  const meterLoop = (eng: AudioEngine) => {
    const an = analyserRef.current;
    if (!an) return;
    const buf = new Float32Array(an.fftSize);
    const tick = () => {
      an.getFloatTimeDomainData(buf);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
      setLevel(peak);
      if (followFilter) eng.setFollower(peak);
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  };

  const startRecord = async () => {
    setError(null);
    const eng = engine || initAudio();
    await eng.resume();
    await eng.attachWorklet();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
      streamRef.current = stream;
      const src = eng.ctx.createMediaStreamSource(stream);
      const rec = new AudioWorkletNode(eng.ctx, 'nexus-capture-processor');
      recNodeRef.current = rec;
      chunksRef.current = [];
      rec.port.onmessage = (e) => {
        if (e.data instanceof Float32Array) chunksRef.current.push(e.data);
      };
      const silent = eng.ctx.createGain();
      silent.gain.value = 0;
      silentRef.current = silent;
      const an = eng.ctx.createAnalyser();
      an.fftSize = 1024;
      analyserRef.current = an;
      src.connect(rec);
      src.connect(an);
      rec.connect(silent);
      silent.connect(eng.ctx.destination);

      setStatus('arming');
      await new Promise((r) => setTimeout(r, 250));
      rec.port.postMessage('start');
      setStatus('recording');
      meterLoop(eng);
      window.setTimeout(() => void stopRecord(eng), seconds * 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Microphone permission denied');
      setStatus('idle');
    }
  };

  const stopRecord = async (eng: AudioEngine) => {
    recNodeRef.current?.port.postMessage('stop');
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    recNodeRef.current?.disconnect();
    silentRef.current?.disconnect();
    analyserRef.current?.disconnect();

    const chunks = chunksRef.current;
    const total = chunks.reduce((n, c) => n + c.length, 0);
    if (total < 2048) {
      setError('Take too short — try again');
      setStatus('idle');
      return;
    }
    const samples = new Float32Array(total);
    let o = 0;
    for (const c of chunks) {
      samples.set(c, o);
      o += c.length;
    }

    const result = audioToPattern(samples, {
      sampleRate: eng.ctx.sampleRate,
      steps: NUM_STEPS,
      snap,
      gate,
    });
    resultRef.current = result.steps;
    setVoiced(result.voicedRatio);
    setBpmGuess(result.bpm);

    const buffer = eng.ctx.createBuffer(1, samples.length, eng.ctx.sampleRate);
    buffer.copyToChannel(samples, 0);
    eng.setSampleBuffer(buffer, result.rootMidi);

    const grid: SeqCell[][] = Array.from({ length: NUM_STEPS }, (_, c) =>
      Array.from({ length: NUM_ROWS }, (_, row) => {
        const midi = GRID_BASE + (NUM_ROWS - 1 - row);
        const st = result.steps[c];
        const match = st?.active && st.midi === midi;
        const near = st?.active && Math.abs(st.midi - midi) === 0;
        return {
          active: Boolean(match || near),
          midi: st?.active ? st.midi : midi,
          velocity: st?.velocity ?? 0.8,
        };
      }),
    );
    for (let c = 0; c < NUM_STEPS; c++) {
      const st = result.steps[c];
      if (!st?.active) continue;
      let row = NUM_ROWS - 1 - (st.midi - GRID_BASE);
      row = Math.max(0, Math.min(NUM_ROWS - 1, row));
      for (let r = 0; r < NUM_ROWS; r++) grid[c][r].active = r === row;
      grid[c][row].midi = st.midi;
      grid[c][row].velocity = st.velocity;
    }

    onPattern(grid, result.bpm, result.rootMidi);
    setStatus('ready');
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <p className="text-[10px] text-nexus-text-dim leading-relaxed">
        Sing a rhyme, hum a hook, or beatbox. NEXUS tracks pitch (YIN) and onsets,
        quantizes a 16-step pattern, and loads your take as a looped sample oscillator
        through the dual ZDF filters.
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => void startRecord()}
          disabled={status === 'recording' || status === 'arming'}
          className="text-[10px] uppercase tracking-wider px-3 py-1.5 rounded bg-nexus-pink/20 text-nexus-pink border border-nexus-pink/40 hover:bg-nexus-pink/30 disabled:opacity-40"
        >
          {status === 'recording' ? 'Recording…' : status === 'arming' ? 'Arming…' : 'Record take'}
        </button>
        <label className="text-[9px] uppercase text-nexus-text-muted flex items-center gap-1">
          Length
          <select
            value={seconds}
            onChange={(e) => setSeconds(Number(e.target.value))}
            className="bg-nexus-surface border border-nexus-border rounded px-1 py-0.5 text-nexus-text"
          >
            {[2, 4, 6, 8].map((s) => <option key={s} value={s}>{s}s</option>)}
          </select>
        </label>
        <label className="text-[9px] uppercase text-nexus-text-muted flex items-center gap-1">
          Snap
          <select
            value={snap}
            onChange={(e) => setSnap(e.target.value as ScaleSnap)}
            className="bg-nexus-surface border border-nexus-border rounded px-1 py-0.5 text-nexus-text"
          >
            <option value="chromatic">Chromatic</option>
            <option value="major">Major</option>
            <option value="minor">Minor</option>
            <option value="pentatonic">Pentatonic</option>
          </select>
        </label>
        <label className="text-[9px] uppercase text-nexus-text-muted flex items-center gap-1">
          Follow filter
          <input type="checkbox" checked={followFilter} onChange={(e) => onFollowFilter(e.target.checked)} />
        </label>
      </div>
      <div className="h-2 rounded bg-nexus-surface overflow-hidden border border-nexus-border">
        <div className="h-full bg-nexus-accent transition-[width] duration-75" style={{ width: `${Math.min(100, level * 180)}%` }} />
      </div>
      {error && <p className="text-[10px] text-nexus-pink">{error}</p>}
      {status === 'ready' && (
        <p className="text-[10px] text-nexus-text-dim">
          Pattern loaded · voiced {(voiced * 100).toFixed(0)}% · {bpmGuess} BPM · sample osc armed.
          Open SEQ to play it; raise SAMPLE mix to hear your voice through the filters.
        </p>
      )}
      <div className="flex gap-2 items-start">
        <Knob label="SAMPLE" value={sampleMix} min={0} max={1} onChange={onSampleMix} />
        <Knob label="GATE" value={gate} min={0.01} max={0.15} onChange={setGate} />
      </div>
    </div>
  );
};

export default CaptureStudio;
