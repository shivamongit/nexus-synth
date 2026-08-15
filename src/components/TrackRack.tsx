import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AudioEngine } from '../audio/AudioEngine';
import { AUDIO_UPLOAD_ACCEPT, decodeAudioFile } from '../audio/analysis/audioFileDecode';
import { exportStemMidis } from '../audio/analysis/stemExport';
import { processTrackRack } from '../audio/analysis/stemPipeline';
import {
  createStemAudioPlayer,
  scheduleSingleStemMidi,
  scheduleStemPlayback,
  type StemAudioPlayer,
} from '../audio/analysis/stemPlayback';
import type { StemSeparationMode } from '../audio/analysis/stemSeparate';
import {
  cancelSeparationJob,
  checkStemApiHealth,
  getStemApiUrl,
  isStemApiAvailable,
  TRACK_RACK_MAX_SEC,
} from '../audio/analysis/stemSeparate';
import { isStemSeparationCloudDisabled } from '../lib/config';
import { warmupPitchline } from '../audio/analysis/basicPitchTranscribe';
import type { StemForgeResult, StemKind, StemTrack } from '../audio/analysis/stemTypes';
import { STEM_COLORS } from '../audio/analysis/stemTypes';
import { midiToName } from '../audio/analysis/voiceToMidi';
import TrackRackAgentProgress from './TrackRackAgentProgress';
import type { TrackRackProgressUpdate } from '../audio/analysis/stemPipeline';

interface Props {
  engine: AudioEngine | null;
  initAudio: () => AudioEngine;
  onPreparePlay?: () => void;
  onLoadPreset?: (idx: number) => void;
}

type LanePlayMode = 'audio' | 'midi';

interface LanePlayState {
  kind: StemKind | 'all';
  mode: LanePlayMode;
  head: number;
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const TrackRack: React.FC<Props> = ({
  engine, initAudio, onPreparePlay, onLoadPreset,
}) => {
  const [phase, setPhase] = useState('');
  const [progress, setProgress] = useState(0);
  const [agentProgress, setAgentProgress] = useState<TrackRackProgressUpdate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StemForgeResult | null>(null);
  const [stems, setStems] = useState<StemTrack[]>([]);
  const [lanePlay, setLanePlay] = useState<LanePlayState | null>(null);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [sepMode, setSepMode] = useState<StemSeparationMode>('fast');

  const fileRef = useRef<HTMLInputElement>(null);
  const playAbort = useRef(false);
  const runAbort = useRef<AbortController | null>(null);
  const sepJobId = useRef<string | null>(null);
  const cancelMidi = useRef<(() => void) | null>(null);
  const audioPlayers = useRef<Map<StemKind, StemAudioPlayer>>(new Map());
  const engRef = useRef<AudioEngine | null>(null);
  const stemsRef = useRef<StemTrack[]>([]);
  stemsRef.current = stems;
  engRef.current = engine;

  const getEngine = () => {
    const e = engine || initAudio();
    engRef.current = e;
    return e;
  };

  useEffect(() => {
    void warmupPitchline().catch(() => {});
    if (isStemApiAvailable()) {
      void checkStemApiHealth().then(setApiOnline);
    } else {
      setApiOnline(false);
    }
  }, []);

  const stopLanePlayback = useCallback((kind?: StemKind | 'all') => {
    if (kind) {
      if (lanePlay?.kind !== kind) return;
    }
    playAbort.current = true;
    cancelMidi.current?.();
    cancelMidi.current = null;
    for (const player of audioPlayers.current.values()) {
      player.stop();
    }
    audioPlayers.current.clear();
    engRef.current?.panic();
    setLanePlay(null);
  }, [lanePlay?.kind]);

  const stopProcessing = useCallback(() => {
    runAbort.current?.abort();
    if (sepJobId.current) {
      void cancelSeparationJob(sepJobId.current);
      sepJobId.current = null;
    }
    setBusy(false);
    setPhase('Stopped');
    setProgress(0);
    setAgentProgress(null);
    setError(null);
  }, []);

  const playStemAudio = useCallback(async (stem: StemTrack) => {
    const eng = getEngine();
    await eng.resume();
    stopLanePlayback();
    playAbort.current = false;

    const player = createStemAudioPlayer(
      eng,
      stem,
      (head) => setLanePlay({ kind: stem.kind, mode: 'audio', head }),
      () => setLanePlay(null),
    );
    audioPlayers.current.set(stem.kind, player);
    setLanePlay({ kind: stem.kind, mode: 'audio', head: 0 });
    player.play(0);
  }, [stopLanePlayback]);

  const playStemMidi = useCallback(async (stem: StemTrack) => {
    if (!stem.notes.length) return;
    const eng = getEngine();
    await eng.resume();
    eng.setSustainPedal(false);
    onPreparePlay?.();
    stopLanePlayback();
    playAbort.current = false;
    onLoadPreset?.(stem.presetIdx);
    setLanePlay({ kind: stem.kind, mode: 'midi', head: 0 });

    cancelMidi.current = scheduleSingleStemMidi(eng, stem, {
      isAborted: () => playAbort.current,
      onHead: (head) => setLanePlay({ kind: stem.kind, mode: 'midi', head }),
      onDone: () => {
        setLanePlay(null);
        cancelMidi.current = null;
      },
    });
  }, [onLoadPreset, onPreparePlay, stopLanePlayback]);

  const playAllMidi = useCallback(async () => {
    const tracks = stemsRef.current;
    if (!tracks.some((s) => s.notes.length)) return;
    const eng = getEngine();
    await eng.resume();
    eng.setSustainPedal(false);
    onPreparePlay?.();
    stopLanePlayback();
    playAbort.current = false;
    setLanePlay({ kind: 'all', mode: 'midi', head: 0 });

    const audible = tracks.filter((s) => {
      const anySolo = tracks.some((x) => x.solo);
      if (anySolo) return s.solo;
      return !s.muted;
    });
    if (audible.length === 1) onLoadPreset?.(audible[0].presetIdx);

    cancelMidi.current = scheduleStemPlayback(eng, tracks, {
      isAborted: () => playAbort.current,
      onHead: (head) => setLanePlay({ kind: 'all', mode: 'midi', head }),
      onDone: () => {
        setLanePlay(null);
        cancelMidi.current = null;
      },
    });
  }, [onLoadPreset, onPreparePlay, stopLanePlayback]);

  const runSong = useCallback(async (file: File) => {
    if (busy) return;
    if (!isStemApiAvailable()) {
      setError('Start the stem separator first — see setup box below.');
      return;
    }
    const online = await checkStemApiHealth();
    setApiOnline(online);
    if (!online) {
      setError('Stem separator is not responding — run: npm run stem-api');
      return;
    }

    setBusy(true);
    setError(null);
    setResult(null);
    setStems([]);
    setAgentProgress({ label: 'Starting…', pct: 0 });
    stopLanePlayback();
    runAbort.current?.abort();
    runAbort.current = new AbortController();
    sepJobId.current = null;
    const signal = runAbort.current.signal;

    try {
      getEngine();
      setPhase('Decoding…');
      setProgress(0.02);
      setAgentProgress({ label: 'Decoding audio…', pct: 0.02, detail: file.name });
      const decoded = await decodeAudioFile(file, (p) => {
        setPhase(p);
        setAgentProgress({ label: p, pct: 0.05, detail: file.name });
      });
      if (decoded.duration > TRACK_RACK_MAX_SEC) {
        throw new Error(`Song too long — max ${TRACK_RACK_MAX_SEC / 60} min for now.`);
      }
      setProgress(0.08);
      setAgentProgress({ label: 'Separating stems…', pct: 0.08, detail: file.name });

      const out = await processTrackRack(file, (update) => {
        setPhase(update.label);
        setProgress(update.pct);
        setAgentProgress(update);
      }, {
        separationMode: sepMode,
        signal,
        onJobId: (id) => { sepJobId.current = id; },
      });
      setResult(out);
      setStems(out.stems);
      setPhase('Ready');
      setProgress(1);
      setAgentProgress({ label: 'Ready', pct: 1, detail: `${out.stems.length} stems · ${out.stems.reduce((n, s) => n + s.notes.length, 0)} notes` });
      window.setTimeout(() => setAgentProgress(null), 1500);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setPhase('Stopped');
        setProgress(0);
        setAgentProgress(null);
        return;
      }
      setError(e instanceof Error ? e.message : 'Processing failed');
      setPhase('');
      setAgentProgress(null);
    } finally {
      sepJobId.current = null;
      setBusy(false);
    }
  }, [busy, stopLanePlayback, sepMode]);

  const toggleMute = (kind: StemTrack['kind']) => {
    setStems((prev) => prev.map((s) => (
      s.kind === kind ? { ...s, muted: !s.muted, solo: false } : s
    )));
  };

  const toggleSolo = (kind: StemTrack['kind']) => {
    setStems((prev) => prev.map((s) => (
      s.kind === kind
        ? { ...s, solo: !s.solo, muted: false }
        : { ...s, solo: false }
    )));
  };

  const isPlaying = lanePlay !== null;
  const maxT = Math.max(
    result?.duration ?? 1,
    ...stems.flatMap((s) => s.notes.map((n) => n.start + n.duration)),
    1,
  );
  const apiUrl = getStemApiUrl();

  return (
    <div
      className={`track-rack${dragOver ? ' track-rack-drag' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) void runSong(f);
      }}
    >
      <header className="sf-header">
        <div>
          <p className="pl-eyebrow">Song → stems → MIDI</p>
          <h1 className="pl-title">Track Rack</h1>
          <p className="pl-sub">
            Split a mix into vocals, drums, bass, and other — each stem gets its own MIDI lane and synth patch.
          </p>
        </div>
      </header>

      {busy && agentProgress && (
        <TrackRackAgentProgress progress={agentProgress} onStop={stopProcessing} />
      )}

      {apiOnline === false && (
        <div className="tr-setup">
          <strong>Stem separator not available</strong>
          {isStemSeparationCloudDisabled() ? (
            <>
              <p>
                Track Rack needs a Demucs worker for stem separation. The Render static deploy does not include it
                — use <strong>Audio → MIDI</strong> for cloud transcription, or run the worker locally:
              </p>
              <code className="tr-setup-cmd">npm run stem-api</code>
              <p className="tr-setup-hint">
                Add <code>VITE_STEM_API_URL</code> to your build env when you host a separate Demucs service.
              </p>
            </>
          ) : (
            <>
              <p>Start the Demucs worker once in a terminal:</p>
              <code className="tr-setup-cmd">npm run stem-api</code>
              <p className="tr-setup-hint">
                Then add <code>VITE_STEM_API_URL=http://localhost:8765</code> to <code>.env</code>
                {apiUrl ? ` (configured: ${apiUrl})` : ''} and restart Vite.
              </p>
            </>
          )}
        </div>
      )}

      {apiOnline === true && (
        <p className="tr-online">Demucs separator connected</p>
      )}

      <div className="sf-upload-row">
        <div className="tr-mode-toggle" role="group" aria-label="Separation speed">
          <button
            type="button"
            className={`tr-mode-btn${sepMode === 'fast' ? ' active' : ''}`}
            disabled={busy}
            onClick={() => setSepMode('fast')}
          >
            Fast
          </button>
          <button
            type="button"
            className={`tr-mode-btn${sepMode === 'quality' ? ' active' : ''}`}
            disabled={busy}
            onClick={() => setSepMode('quality')}
          >
            Quality
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept={AUDIO_UPLOAD_ACCEPT}
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void runSong(f);
          }}
        />
        <button
          type="button"
          className="pl-btn pl-btn-primary"
          disabled={busy || apiOnline === false}
          onClick={() => fileRef.current?.click()}
        >
          Import song
        </button>
        <button
          type="button"
          className="pl-btn"
          disabled={!stems.length || isPlaying || busy}
          onClick={() => void playAllMidi()}
        >
          Play all MIDI
        </button>
        <button type="button" className="pl-btn" disabled={!isPlaying} onClick={() => stopLanePlayback()}>
          Stop all
        </button>
        <button type="button" className="pl-btn" disabled={!stems.length} onClick={() => exportStemMidis(stems)}>
          Export MIDI
        </button>
      </div>

      {error && <p className="pl-error">{error}</p>}

      {result && (
        <p className="sf-meta">
          Demucs split · {fmt(result.duration)} · {stems.reduce((n, s) => n + s.notes.length, 0)} notes
        </p>
      )}

      <div className="sf-lanes">
        {stems.map((stem) => {
          const minM = stem.notes.length ? Math.min(...stem.notes.map((n) => n.midi)) - 2 : 48;
          const maxM = stem.notes.length ? Math.max(...stem.notes.map((n) => n.midi)) + 2 : 72;
          const span = Math.max(12, maxM - minM);
          const color = STEM_COLORS[stem.kind];
          const laneActive = lanePlay?.kind === stem.kind;
          const audioPlaying = laneActive && lanePlay?.mode === 'audio';
          const midiPlaying = laneActive && lanePlay?.mode === 'midi';
          const head = laneActive ? (lanePlay?.head ?? 0) : 0;
          const showPlayhead = laneActive || (lanePlay?.kind === 'all' && lanePlay.mode === 'midi');

          return (
            <div key={stem.kind} className="sf-lane">
              <div className="sf-lane-head">
                <span className="sf-lane-dot" style={{ background: color }} />
                <span className="sf-lane-title">{stem.label}</span>
                {stem.kind === 'vocals' && <span className="sf-lane-hq">HQ</span>}
                <span className="sf-lane-preset">{stem.presetName}</span>
                <span className="sf-lane-meta">{stem.notes.length} notes</span>
                <button
                  type="button"
                  className={`sf-lane-btn${stem.muted ? ' on' : ''}`}
                  onClick={() => toggleMute(stem.kind)}
                >
                  M
                </button>
                <button
                  type="button"
                  className={`sf-lane-btn${stem.solo ? ' on' : ''}`}
                  onClick={() => toggleSolo(stem.kind)}
                >
                  S
                </button>
                <button
                  type="button"
                  className="sf-lane-btn"
                  onClick={() => onLoadPreset?.(stem.presetIdx)}
                >
                  Patch
                </button>
              </div>

              <div className="sf-lane-transport">
                <div className="sf-transport-group">
                  <span className="sf-transport-label">Audio</span>
                  <button
                    type="button"
                    className={`sf-transport-btn${audioPlaying ? ' playing' : ''}`}
                    disabled={busy || !stem.samples.length}
                    onClick={() => void playStemAudio(stem)}
                    title="Play stem audio"
                  >
                    ▶
                  </button>
                  <button
                    type="button"
                    className="sf-transport-btn sf-transport-stop"
                    disabled={!audioPlaying}
                    onClick={() => stopLanePlayback(stem.kind)}
                    title="Stop stem audio"
                  >
                    ■
                  </button>
                </div>
                <div className="sf-transport-group">
                  <span className="sf-transport-label">MIDI</span>
                  <button
                    type="button"
                    className={`sf-transport-btn${midiPlaying ? ' playing' : ''}`}
                    disabled={!stem.notes.length || busy}
                    onClick={() => void playStemMidi(stem)}
                    title="Play stem MIDI"
                  >
                    ▶
                  </button>
                  <button
                    type="button"
                    className="sf-transport-btn sf-transport-stop"
                    disabled={!midiPlaying}
                    onClick={() => stopLanePlayback(stem.kind)}
                    title="Stop stem MIDI"
                  >
                    ■
                  </button>
                </div>
                {laneActive && (
                  <span className="sf-transport-time">
                    {fmt(head)} / {fmt(stem.duration)}
                  </span>
                )}
              </div>

              <div className="sf-roll">
                {!stem.notes.length && <span className="sf-roll-empty">No notes in this stem</span>}
                {stem.notes.map((n, i) => (
                  <div
                    key={i}
                    className="sf-note"
                    style={{
                      left: `${(n.start / maxT) * 100}%`,
                      width: `${Math.max(0.8, (n.duration / maxT) * 100)}%`,
                      bottom: `${((n.midi - minM) / span) * 100}%`,
                      height: `${100 / span}%`,
                      background: color,
                      opacity: 0.55 + n.velocity * 0.45,
                    }}
                    title={midiToName(n.midi)}
                  />
                ))}
                {showPlayhead && (
                  <div
                    className="pl-playhead"
                    style={{
                      left: `${Math.min(100, ((lanePlay?.kind === 'all' ? lanePlay.head : head) / maxT) * 100)}%`,
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!stems.length && !busy && apiOnline && !isStemSeparationCloudDisabled() && (
        <p className="sf-hint">Drop a song — Demucs splits it, then all four stems trace in parallel.</p>
      )}
      {!stems.length && !busy && isStemSeparationCloudDisabled() && (
        <p className="sf-hint">Stem separation is offline on this deploy. Use the Audio → MIDI tab for in-browser transcription.</p>
      )}
    </div>
  );
};

export default TrackRack;
