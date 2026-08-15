import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioEngine } from '../audio/AudioEngine';
import { MicRecorder, type CaptureTake } from '../audio/analysis/micRecorder';
import { AUDIO_UPLOAD_ACCEPT, decodeAudioFile } from '../audio/analysis/audioFileDecode';
import { scheduleMidiPlayback } from '../audio/analysis/midiPlayback';
import type { PitchlineOptions } from '../audio/analysis/pitchlineTranscribe';
import {
  midiToName,
  midiToPatternGrid,
  notesToMidiFile,
  snapMidi,
  voiceToMidi,
  type MidiNote,
  type ScaleSnap,
} from '../audio/analysis/voiceToMidi';
import { GRID_BASE, NUM_ROWS, NUM_STEPS, type SeqCell } from './Sequencer';

interface Props {
  engine: AudioEngine | null;
  initAudio: () => AudioEngine;
  onPattern: (grid: SeqCell[][], bpm: number, rootMidi: number) => void;
  onNotes: (notes: MidiNote[]) => void;
  onPreparePlay?: () => void;
}

type StudioStatus = 'idle' | 'recording' | 'decoding' | 'loading-model' | 'transcribing' | 'ready';

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function waveformBars(samples: Float32Array, bars = 120): number[] {
  const out: number[] = [];
  const step = Math.max(1, Math.floor(samples.length / bars));
  for (let i = 0; i < bars; i++) {
    const a = i * step;
    const b = Math.min(samples.length, a + step);
    let p = 0;
    for (let j = a; j < b; j++) p = Math.max(p, Math.abs(samples[j]));
    out.push(p);
  }
  return out;
}

function ProgressRing({ pct, label }: { pct: number; label: string }) {
  const r = 36;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(100, Math.max(0, pct)) / 100) * c;
  return (
    <div className="pl-ring-wrap">
      <svg width="88" height="88" viewBox="0 0 88 88" aria-hidden>
        <circle cx="44" cy="44" r={r} className="pl-ring-bg" />
        <circle
          cx="44"
          cy="44"
          r={r}
          className="pl-ring-fg"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="pl-ring-center">
        <span className="pl-ring-pct">{Math.round(pct)}%</span>
        <span className="pl-ring-label">{label}</span>
      </div>
    </div>
  );
}

const VoiceToMidiStudio: React.FC<Props> = ({
  engine, initAudio, onPattern, onNotes, onPreparePlay,
}) => {
  const [status, setStatus] = useState<StudioStatus>('idle');
  const [phaseLabel, setPhaseLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [snap, setSnap] = useState<ScaleSnap>('chromatic');
  const [quantize, setQuantize] = useState(false);
  const [useAutoStop, setUseAutoStop] = useState(false);
  const [autoStopSec, setAutoStopSec] = useState(8);
  const [onsetSens, setOnsetSens] = useState(50);
  const [frameSens, setFrameSens] = useState(50);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [progress, setProgress] = useState(0);
  const [notes, setNotes] = useState<MidiNote[]>([]);
  const [bpm, setBpm] = useState(120);
  const [engineName, setEngineName] = useState('');
  const [modelStatus, setModelStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [playing, setPlaying] = useState(false);
  const [playHead, setPlayHead] = useState(0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [take, setTake] = useState<CaptureTake | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const rec = useRef(new MicRecorder());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const recStartRef = useRef(0);
  const tickRef = useRef(0);
  const autoStopRef = useRef<number | null>(null);
  const playAbort = useRef(false);
  const cancelPlayRef = useRef<(() => void) | null>(null);
  const previewRef = useRef<AudioBufferSourceNode | null>(null);
  const engRef = useRef<AudioEngine | null>(null);
  const notesRef = useRef<MidiNote[]>([]);
  const takeRef = useRef<CaptureTake | null>(null);
  const traceOptsRef = useRef<PitchlineOptions>({});
  notesRef.current = notes;
  takeRef.current = take;
  engRef.current = engine;
  traceOptsRef.current = { onsetSens, frameSens };

  const getEngine = () => {
    const e = engine || initAudio();
    engRef.current = e;
    return e;
  };

  const stopPreview = () => {
    try { previewRef.current?.stop(); } catch { /* */ }
    previewRef.current = null;
  };

  const stopPlayback = useCallback((silent = false) => {
    playAbort.current = true;
    cancelPlayRef.current?.();
    cancelPlayRef.current = null;
    stopPreview();
    engRef.current?.panic();
    setPlayHead(0);
    if (!silent) setPlaying(false);
  }, []);

  const applyNotePost = useCallback((
    transcribed: MidiNote[],
    used: string,
    rawDuration: number,
    sourceKind: 'mic' | 'file' = 'mic',
  ) => {
    let out = transcribed;
    if (snap !== 'chromatic') {
      out = out.map((n) => ({ ...n, midi: snapMidi(n.midi, snap) }));
    }
    if (quantize && out.length) {
      const est = out.length >= 2
        ? Math.round(60 / Math.max(0.15, out[1].start - out[0].start))
        : 120;
      let qbpm = est;
      while (qbpm < 75) qbpm *= 2;
      while (qbpm > 165) qbpm /= 2;
      const grid = 60 / qbpm / 4;
      out = out.map((n) => ({
        ...n,
        start: Math.round(n.start / grid) * grid,
        duration: Math.max(grid, Math.round(n.duration / grid) * grid),
      }));
      setBpm(qbpm);
    } else {
      setBpm(120);
    }
    setNotes(out);
    setEngineName(used);
    onNotes(out);
    const loopDur = out.reduce((m, n) => Math.max(m, n.start + n.duration), rawDuration);
    const root = out.length
      ? Math.round(out.reduce((a, n) => a + n.midi, 0) / out.length)
      : 60;
    onPattern(midiToPatternGrid(out, NUM_STEPS, NUM_ROWS, GRID_BASE, loopDur) as SeqCell[][], 120, root);
    setStatus('ready');
    setProgress(100);
    setPhaseLabel('');
    if (!out.length) {
      setError(sourceKind === 'file'
        ? 'No notes found — raise sensitivity or use a clearer recording.'
        : 'No notes found — sing clearer single notes with short gaps.');
    }
  }, [snap, quantize, onNotes, onPattern]);

  const runTranscribe = useCallback(async (raw: CaptureTake) => {
    setStatus('transcribing');
    setProgress(2);
    setPhaseLabel('Tracing notes…');
    setError(null);
    const sourceKind = raw.source ?? 'mic';

    let transcribed: MidiNote[] = [];
    let used = sourceKind === 'file' ? 'basic pitch' : 'contour';
    try {
      const { transcribeVoice } = await import('../audio/analysis/pitchlineTranscribe');
      const result = await transcribeVoice(
        raw.samples,
        raw.sampleRate,
        (p) => setProgress(Math.round(p * 100)),
        { ...traceOptsRef.current, sourceKind },
      );
      transcribed = result.notes;
      used = result.method === 'neural'
        ? (sourceKind === 'file' ? 'basic pitch' : 'neural trace')
        : 'pitch contour';
      setModelStatus(result.modelReady ? 'ready' : 'failed');
      if (!result.modelReady && sourceKind === 'mic') {
        setError('Neural model unavailable — using pitch contour.');
      }
    } catch (e) {
      console.warn('[Pitchline] transcribe failed', e);
      transcribed = voiceToMidi(raw.samples, {
        sampleRate: raw.sampleRate,
        snap: 'chromatic',
        quantize: false,
        minNoteMs: 100,
      }).notes;
      used = 'pitch contour';
    }
    applyNotePost(transcribed, used, raw.duration, sourceKind);
  }, [applyNotePost]);

  const loadAudioFile = useCallback(async (file: File) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setNotes([]);
    setPlayHead(0);
    stopPlayback(true);

    try {
      getEngine();
      setStatus('decoding');
      setProgress(5);
      setPhaseLabel('Reading audio…');

      const decoded = await decodeAudioFile(file, setPhaseLabel);
      setTake(decoded);
      setProgress(15);

      setStatus('loading-model');
      setPhaseLabel('Loading AI model…');
      const { ensurePitchlineModel } = await import('../audio/analysis/basicPitchTranscribe');
      await ensurePitchlineModel();
      setModelStatus('ready');
      setProgress(20);

      await runTranscribe(decoded);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not load audio';
      setError(msg);
      setStatus('idle');
      setPhaseLabel('');
      if (msg.includes('Model')) setModelStatus('failed');
    } finally {
      busyRef.current = false;
    }
  }, [stopPlayback, runTranscribe]);

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void loadAudioFile(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void loadAudioFile(file);
  };

  useEffect(() => {
    void import('../audio/analysis/basicPitchTranscribe')
      .then((m) => m.warmupPitchline()
        .then(() => setModelStatus('ready'))
        .catch(() => setModelStatus('failed')))
      .catch(() => setModelStatus('failed'));
    return () => {
      playAbort.current = true;
      cancelPlayRef.current?.();
      if (autoStopRef.current) clearTimeout(autoStopRef.current);
      if (tickRef.current) cancelAnimationFrame(tickRef.current);
      stopPreview();
      void rec.current.dispose();
    };
  }, []);

  const startRecord = async () => {
    if (busyRef.current) return;
    setError(null);
    setNotes([]);
    setTake(null);
    setPlayHead(0);
    try {
      stopPlayback(true);
      getEngine();
      await rec.current.start((rms) => setLevel(rms));
      recStartRef.current = performance.now();
      setElapsed(0);
      setStatus('recording');
      const tick = () => {
        if (!rec.current.active) return;
        setElapsed((performance.now() - recStartRef.current) / 1000);
        tickRef.current = requestAnimationFrame(tick);
      };
      tick();
      if (useAutoStop) {
        autoStopRef.current = window.setTimeout(() => void stopRecord(), autoStopSec * 1000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Microphone permission denied');
      setStatus('idle');
    }
  };

  const stopRecord = async () => {
    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
    if (tickRef.current) cancelAnimationFrame(tickRef.current);
    setLevel(0);

    const raw = await rec.current.stop();
    if (!raw || raw.duration < 0.25) {
      setError('Take too short — sing a bit longer');
      setStatus('idle');
      return;
    }
    if (raw.peak < 0.004) {
      setError('Mic was silent — check permissions and sing closer');
      setStatus('idle');
      return;
    }

    busyRef.current = true;
    setTake(raw);
    try {
      setStatus('loading-model');
      setPhaseLabel('Loading AI model…');
      const { ensurePitchlineModel } = await import('../audio/analysis/basicPitchTranscribe');
      await ensurePitchlineModel();
      await runTranscribe(raw);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transcription failed');
      setStatus('idle');
    } finally {
      busyRef.current = false;
    }
  };

  const retrace = async () => {
    const raw = takeRef.current;
    if (!raw || busyRef.current || status === 'recording') return;
    busyRef.current = true;
    stopPlayback(true);
    try {
      await runTranscribe(raw);
    } finally {
      busyRef.current = false;
    }
  };

  const playTake = async () => {
    const cap = takeRef.current;
    if (!cap) return;
    const eng = getEngine();
    await eng.resume();
    stopPreview();
    const buffer = eng.ctx.createBuffer(1, cap.samples.length, cap.sampleRate);
    buffer.getChannelData(0).set(cap.samples);
    const src = eng.ctx.createBufferSource();
    const g = eng.ctx.createGain();
    g.gain.value = 0.85;
    src.buffer = buffer;
    src.connect(g);
    g.connect(eng.ctx.destination);
    previewRef.current = src;
    src.onended = () => {
      if (previewRef.current === src) previewRef.current = null;
    };
    src.start();
  };

  const playNotes = async () => {
    const list = notesRef.current;
    const cap = takeRef.current;
    if (!list.length) {
      if (cap) {
        setPlaying(true);
        await playTake();
        window.setTimeout(() => setPlaying(false), cap.duration * 1000 + 50);
      }
      return;
    }
    const eng = getEngine();
    await eng.resume();
    eng.setSustainPedal(false);
    onPreparePlay?.();
    stopPlayback(true);
    playAbort.current = false;
    setPlaying(true);
    cancelPlayRef.current = scheduleMidiPlayback(eng, list, {
      isAborted: () => playAbort.current,
      onHead: setPlayHead,
      onDone: () => {
        setPlaying(false);
        setPlayHead(0);
        cancelPlayRef.current = null;
      },
    });
  };

  const exportMidi = () => {
    const blob = notesToMidiFile(notes, bpm);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'nexus-pitchline.mid';
    a.click();
  };

  const bars = useMemo(() => (take ? waveformBars(take.samples) : []), [take]);
  const maxT = Math.max(take?.duration || 1, notes.reduce((m, n) => Math.max(m, n.start + n.duration), 1));
  const minM = notes.length ? Math.min(...notes.map((n) => n.midi)) - 2 : 48;
  const maxM = notes.length ? Math.max(...notes.map((n) => n.midi)) + 2 : 72;
  const span = Math.max(12, maxM - minM);
  const recording = status === 'recording';
  const processing = status === 'decoding' || status === 'loading-model' || status === 'transcribing';
  const busy = recording || processing;

  const statusLabel = recording
    ? fmt(elapsed)
    : processing
      ? phaseLabel || 'Working…'
      : notes.length
        ? `${notes.length} notes`
        : 'Ready';

  return (
    <div
      className={`pitchline-studio${dragOver ? ' pl-drag' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div className="pl-orb pl-orb-a" aria-hidden />
      <div className="pl-orb pl-orb-b" aria-hidden />

      <header className="pl-header">
        <div>
          <p className="pl-eyebrow">Browser · Basic Pitch</p>
          <h1 className="pl-title">Audio → MIDI</h1>
          <p className="pl-sub">Record, upload, or drop audio — transcribe to MIDI in your browser</p>
        </div>
        <div className="pl-status-card">
          {processing ? (
            <ProgressRing pct={progress} label={status === 'transcribing' ? 'trace' : 'load'} />
          ) : (
            <>
              <span className="pl-status-value">{statusLabel}</span>
              <span className="pl-status-meta">
                {recording ? 'Recording' : status === 'ready' ? engineName || 'Done' : 'Standby'}
              </span>
            </>
          )}
        </div>
      </header>

      <div className="pl-grid">
        <section className="pl-panel pl-controls">
          <div className="pl-record-wrap">
            <button
              type="button"
              className={`pl-record-btn${recording ? ' is-recording' : ''}`}
              disabled={busy && !recording}
              onClick={() => (recording ? void stopRecord() : void startRecord())}
              aria-label={recording ? 'Stop recording' : 'Start recording'}
            >
              <span className="pl-record-inner">
                {recording ? (
                  <span className="pl-stop-icon" />
                ) : (
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z" fill="currentColor" />
                    <path d="M19 11a1 1 0 0 0-2 0 5 5 0 0 1-10 0 1 1 0 0 0-2 0 7 7 0 0 0 6 6.92V21H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-3.08A7 7 0 0 0 19 11Z" fill="currentColor" />
                  </svg>
                )}
              </span>
              {recording && <span className="pl-record-pulse" aria-hidden />}
            </button>
            <p className="pl-record-hint">{recording ? 'Tap to stop' : 'Tap to record'}</p>
          </div>

          {recording && (
            <div className="pl-meter">
              <div className="pl-meter-fill" style={{ width: `${Math.min(100, level * 480)}%` }} />
            </div>
          )}

          <div className="pl-transport">
            <button type="button" className="pl-btn pl-btn-primary" disabled={playing || busy || (!notes.length && !take)} onClick={() => void playNotes()}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z"/></svg>
              Play
            </button>
            <button type="button" className="pl-btn" disabled={!playing} onClick={() => stopPlayback()}>Stop</button>
            <button type="button" className="pl-btn" disabled={!take || playing || busy} onClick={() => void playTake()}>Hear</button>
            <button type="button" className="pl-btn" disabled={!take || busy} onClick={() => void retrace()}>Re-trace</button>
            <button type="button" className="pl-btn" disabled={!notes.length} onClick={exportMidi}>MIDI</button>
          </div>

          <div className="pl-upload">
            <input ref={fileInputRef} type="file" accept={AUDIO_UPLOAD_ACCEPT} className="sr-only" onChange={onFileInput} />
            <button
              type="button"
              className="pl-upload-btn"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M12 16V4m0 0 8-4m-8 4 8 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>Upload audio</span>
              <span className="pl-upload-sub">WAV · MP3 · OGG · FLAC</span>
            </button>
            <p className="pl-upload-drop">or drag & drop anywhere</p>
          </div>

          <label className="pl-toggle">
            <input type="checkbox" checked={useAutoStop} onChange={(e) => setUseAutoStop(e.target.checked)} />
            <span>Auto-stop</span>
            <select value={autoStopSec} disabled={!useAutoStop} onChange={(e) => setAutoStopSec(Number(e.target.value))} className="pl-select">
              {[4, 8, 12, 16, 30].map((s) => <option key={s} value={s}>{s}s</option>)}
            </select>
          </label>
        </section>

        <section className="pl-panel pl-visual">
          {bars.length > 0 ? (
            <div className="pl-wave" aria-hidden>
              {bars.map((v, i) => (
                <span key={i} style={{ height: `${Math.max(6, v * 100)}%` }} />
              ))}
            </div>
          ) : (
            <div className="pl-wave pl-wave-empty">
              <span>Waveform appears after record or upload</span>
            </div>
          )}

          <div className="pl-roll">
            {notes.length === 0 && !recording && (
              <div className="pl-roll-empty">
                {processing ? phaseLabel : 'Piano roll fills in after tracing'}
              </div>
            )}
            {notes.map((n, i) => (
              <div
                key={i}
                className="pl-note"
                style={{
                  left: `${(n.start / maxT) * 100}%`,
                  width: `${Math.max(1, (n.duration / maxT) * 100)}%`,
                  bottom: `${((n.midi - minM) / span) * 100}%`,
                  height: `${100 / span}%`,
                  opacity: 0.5 + n.velocity * 0.5,
                }}
                title={`${midiToName(n.midi)} · ${n.duration.toFixed(2)}s`}
              />
            ))}
            {playing && (
              <div className="pl-playhead" style={{ left: `${Math.min(100, (playHead / maxT) * 100)}%` }} />
            )}
          </div>

          {(status === 'ready' || take) && (
            <div className="pl-meta">
              {engineName && <span className="pl-chip">{engineName}</span>}
              {notes.length > 0 && <span className="pl-chip">{notes.length} notes</span>}
              <span className={`pl-chip${modelStatus === 'failed' ? ' pl-chip-warn' : ''}`}>
                AI {modelStatus}
              </span>
              {take && <span className="pl-chip">{fmt(take.duration)}</span>}
              {take?.sourceName && (
                <span className="pl-chip pl-chip-file" title={take.sourceName}>{take.sourceName}</span>
              )}
            </div>
          )}
        </section>
      </div>

      {error && <p className="pl-error">{error}</p>}

      <button type="button" className="pl-advanced-toggle" onClick={() => setShowAdvanced((v) => !v)}>
        {showAdvanced ? '▾ Hide options' : '▸ Sensitivity & scale'}
      </button>
      {showAdvanced && (
        <div className="pl-advanced">
          <label className="pl-slider-label">
            Onset sensitivity
            <input type="range" min={0} max={100} value={onsetSens} onChange={(e) => setOnsetSens(Number(e.target.value))} className="pl-slider" />
            <span>{onsetSens}</span>
          </label>
          <label className="pl-slider-label">
            Frame sensitivity
            <input type="range" min={0} max={100} value={frameSens} onChange={(e) => setFrameSens(Number(e.target.value))} className="pl-slider" />
            <span>{frameSens}</span>
          </label>
          <label className="pl-slider-label">
            Scale
            <select value={snap} onChange={(e) => setSnap(e.target.value as ScaleSnap)} className="pl-select">
              <option value="chromatic">Chromatic</option>
              <option value="major">Major</option>
              <option value="minor">Minor</option>
              <option value="pentatonic">Pentatonic</option>
            </select>
          </label>
          <label className="pl-toggle">
            <input type="checkbox" checked={quantize} onChange={(e) => setQuantize(e.target.checked)} />
            <span>Quantize 1/16</span>
          </label>
        </div>
      )}
    </div>
  );
};

export default VoiceToMidiStudio;
