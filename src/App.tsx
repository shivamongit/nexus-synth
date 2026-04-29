import React, { useState, useCallback, useRef, useEffect } from 'react';
import { AudioEngine, type SynthParams, type WaveformType, type FilterType } from './audio/AudioEngine';
import { MidiEngine, type MidiDevice } from './audio/MidiEngine';
import { PRESETS, DEFAULT_PARAMS } from './audio/presets';
import { initAnalytics, trackEvent, incrementLocalCounter, getActiveProviders } from './lib/analytics';
import { isEmbedded, getBootPreset, listenHost, postToHost } from './lib/embed';
import Knob from './components/Knob';
import Visualizer from './components/Visualizer';
import Keyboard from './components/Keyboard';
import Sequencer from './components/Sequencer';
import MidiIndicator from './components/MidiIndicator';
import PeakMeter from './components/PeakMeter';
import PresetBrowser from './components/PresetBrowser';

type ViewMode = 'synth' | 'sequencer';

const WAVEFORMS: WaveformType[] = ['sine', 'sawtooth', 'square', 'triangle'];
const WAVE_ICONS: Record<WaveformType, string> = {
  sine: '∿', sawtooth: '⩘', square: '⊓', triangle: '△',
};
const FILTER_TYPES: FilterType[] = ['lowpass', 'highpass', 'bandpass', 'notch'];
const FILTER_LABELS: Record<FilterType, string> = {
  lowpass: 'LP', highpass: 'HP', bandpass: 'BP', notch: 'NT',
};

const APP_VERSION = '1.1.0';

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

const App: React.FC = () => {
  const embedded = isEmbedded();
  const [params, setParams] = useState<SynthParams>(deepClone(DEFAULT_PARAMS));
  const [presetIdx, setPresetIdx] = useState(0);
  const [engine, setEngine] = useState<AudioEngine | null>(null);
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());
  const [octave, setOctave] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>('synth');
  const [vizMode, setVizMode] = useState<'oscilloscope' | 'spectrum'>('oscilloscope');
  const [isInitialized, setIsInitialized] = useState(false);

  // MIDI state
  const [midiEnabled, setMidiEnabled] = useState(false);
  const [midiDevices, setMidiDevices] = useState<MidiDevice[]>([]);
  const [midiSelectedId, setMidiSelectedId] = useState<string | null>(null);
  const [midiActivity, setMidiActivity] = useState(0);
  const [pitchBend, setPitchBend] = useState(0);
  const [modWheel, setModWheel] = useState(0);

  const engineRef = useRef<AudioEngine | null>(null);
  const midiRef = useRef<MidiEngine | null>(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  // Initialise analytics once
  useEffect(() => {
    initAnalytics();
    trackEvent('app_loaded', { embedded: embedded ? 1 : 0 });
  }, [embedded]);

  // Boot preset from URL
  useEffect(() => {
    const boot = getBootPreset();
    if (boot !== null && boot >= 0 && boot < PRESETS.length) {
      setPresetIdx(boot);
      setParams(deepClone(PRESETS[boot].params));
    }
  }, []);

  const initAudio = useCallback(() => {
    if (engineRef.current) return engineRef.current;
    const eng = new AudioEngine(paramsRef.current);
    engineRef.current = eng;
    setEngine(eng);
    setIsInitialized(true);
    trackEvent('audio_started', { sample_rate: eng.ctx.sampleRate });
    postToHost({ type: 'nexus:ready', version: APP_VERSION });
    return eng;
  }, []);

  useEffect(() => {
    if (engineRef.current) engineRef.current.updateParams(params);
  }, [params]);

  const updateParam = useCallback((section: string, key: string, value: number | string) => {
    setParams(prev => {
      const next = deepClone(prev);
      const target = (next as any)[section];
      if (typeof target === 'object' && target !== null && key) {
        target[key] = value;
      } else {
        (next as any)[section] = value;
      }
      return next;
    });
  }, []);

  const handleNoteOn = useCallback((note: number, velocity: number) => {
    const eng = engineRef.current || initAudio();
    eng.noteOn(note, velocity);
    setActiveNotes(prev => new Set(prev).add(note));
    incrementLocalCounter('notesPlayed');
    postToHost({ type: 'nexus:noteOn', note, velocity, source: 'ui' });
  }, [initAudio]);

  const handleNoteOff = useCallback((note: number) => {
    engineRef.current?.noteOff(note);
    setActiveNotes(prev => {
      const next = new Set(prev);
      next.delete(note);
      return next;
    });
    postToHost({ type: 'nexus:noteOff', note, source: 'ui' });
  }, []);

  const loadPreset = useCallback((idx: number) => {
    if (idx < 0 || idx >= PRESETS.length) return;
    setPresetIdx(idx);
    const p = deepClone(PRESETS[idx].params);
    setParams(p);
    if (engineRef.current) {
      engineRef.current.updateParams(p);
      engineRef.current.updateReverb(p.effects.reverbDecay);
    }
    incrementLocalCounter('presetsLoaded');
    trackEvent('preset_loaded', { name: PRESETS[idx].name, category: PRESETS[idx].category });
    postToHost({ type: 'nexus:presetLoaded', index: idx, name: PRESETS[idx].name });
  }, []);

  // ─── MIDI setup ────────────────────────────────────────────
  const enableMidi = useCallback(async () => {
    if (midiRef.current) return;
    const mr = new MidiEngine();
    if (!mr.supported) return;

    const ok = await mr.init({
      onNoteOn: (note, vel) => {
        const eng = engineRef.current || initAudio();
        eng.noteOn(note, vel);
        setActiveNotes(prev => new Set(prev).add(note));
        setMidiActivity(a => a + 1);
        incrementLocalCounter('notesPlayed');
        postToHost({ type: 'nexus:noteOn', note, velocity: vel, source: 'midi' });
      },
      onNoteOff: (note) => {
        engineRef.current?.noteOff(note);
        setActiveNotes(prev => { const n = new Set(prev); n.delete(note); return n; });
        setMidiActivity(a => a + 1);
        postToHost({ type: 'nexus:noteOff', note, source: 'midi' });
      },
      onPitchBend: (semi) => {
        engineRef.current?.setPitchBend(semi);
        setPitchBend(semi);
        setMidiActivity(a => a + 1);
      },
      onModWheel: (v) => {
        engineRef.current?.setModWheel(v);
        setModWheel(v);
        setMidiActivity(a => a + 1);
      },
      onSustain: (on) => {
        engineRef.current?.setSustainPedal(on);
        setMidiActivity(a => a + 1);
      },
      onAllNotesOff: () => {
        engineRef.current?.allNotesOff();
        setActiveNotes(new Set());
      },
      onDeviceChange: (devs) => {
        setMidiDevices(devs);
        setMidiSelectedId(mr.getSelectedId());
      },
      onActivity: () => {},
    });
    if (!ok) return;

    midiRef.current = mr;
    setMidiEnabled(true);
    setMidiDevices(mr.getDevices());
    setMidiSelectedId(mr.getSelectedId());
    trackEvent('midi_enabled', { devices: mr.getDevices().length });
  }, [initAudio]);

  // ─── Host message API ─────────────────────────────────────
  useEffect(() => {
    const unlisten = listenHost((msg) => {
      switch (msg.type) {
        case 'nexus:noteOn': {
          const eng = engineRef.current || initAudio();
          eng.noteOn(msg.note, msg.velocity ?? 0.8);
          setActiveNotes(prev => new Set(prev).add(msg.note));
          break;
        }
        case 'nexus:noteOff':
          engineRef.current?.noteOff(msg.note);
          setActiveNotes(prev => { const n = new Set(prev); n.delete(msg.note); return n; });
          break;
        case 'nexus:loadPreset':
          loadPreset(msg.index);
          break;
        case 'nexus:panic':
          engineRef.current?.panic();
          setActiveNotes(new Set());
          break;
        case 'nexus:setParam':
          updateParam(msg.section, msg.key, msg.value);
          break;
      }
    });
    return unlisten;
  }, [initAudio, loadPreset, updateParam]);

  // ─── UI sub-components ────────────────────────────────────
  const WaveformSelector: React.FC<{
    value: WaveformType;
    onChange: (w: WaveformType) => void;
  }> = ({ value, onChange }) => (
    <div className="flex gap-0.5">
      {WAVEFORMS.map(w => (
        <button
          key={w}
          onClick={() => onChange(w)}
          className={`w-7 h-6 text-[13px] rounded-sm transition-all flex items-center justify-center ${
            value === w
              ? 'bg-nexus-accent/20 text-nexus-accent border border-nexus-accent/40'
              : 'bg-nexus-surface text-nexus-text-dim border border-transparent hover:text-nexus-text'
          }`}
          title={w}
        >
          {WAVE_ICONS[w]}
        </button>
      ))}
    </div>
  );

  return (
    <div className="w-full h-full flex flex-col bg-nexus-bg overflow-hidden">
      {/* HEADER */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-nexus-border bg-nexus-bg/80 backdrop-blur-sm flex-shrink-0 gap-3">
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-nexus-accent animate-pulse-glow" style={{ boxShadow: '0 0 8px #00d4ff' }} />
            <h1 className="text-base font-display font-bold tracking-[0.15em] text-nexus-text">NEXUS</h1>
            <span className="text-[8px] uppercase tracking-[0.2em] text-nexus-text-muted font-mono mt-0.5">SPECTRAL SYNTH v{APP_VERSION}</span>
          </div>
          {!embedded && (
            <>
              <div className="h-4 w-px bg-nexus-border" />
              <div className="flex items-center gap-1">
                {(['synth', 'sequencer'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className={`text-[9px] uppercase tracking-wider px-2.5 py-1 rounded transition-all ${
                      viewMode === mode
                        ? 'bg-nexus-accent/15 text-nexus-accent border border-nexus-accent/30'
                        : 'text-nexus-text-dim hover:text-nexus-text'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Preset browser */}
        <div className="flex-1 flex justify-center">
          <PresetBrowser presets={PRESETS} currentIndex={presetIdx} onLoad={loadPreset} />
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <MidiIndicator
            supported={typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator}
            enabled={midiEnabled}
            onToggle={enableMidi}
            devices={midiDevices}
            selectedId={midiSelectedId}
            onSelect={(id) => { midiRef.current?.selectInput(id); setMidiSelectedId(id); }}
            activityTick={midiActivity}
            pitchBend={pitchBend}
            modWheel={modWheel}
          />

          {!isInitialized && (
            <button
              onClick={initAudio}
              className="text-[9px] uppercase tracking-wider px-3 py-1.5 rounded bg-nexus-accent/20 text-nexus-accent border border-nexus-accent/40 hover:bg-nexus-accent/30 transition-all shadow-glow"
            >
              START AUDIO
            </button>
          )}
          <div className="flex items-center gap-1.5 px-2 py-1 rounded border border-nexus-border bg-nexus-surface">
            <span className="text-[8px] uppercase tracking-wider text-nexus-text-muted">VOICES</span>
            <span className="text-[10px] font-mono text-nexus-accent w-4 text-right">{engine?.activeVoiceCount ?? 0}</span>
          </div>
          <button
            onClick={() => { engineRef.current?.panic(); setActiveNotes(new Set()); postToHost({ type: 'nexus:panic' }); }}
            className="text-[9px] px-2 py-1 rounded bg-nexus-surface border border-nexus-border text-nexus-text-dim hover:text-nexus-pink hover:border-nexus-pink/30 transition-colors"
          >
            PANIC
          </button>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <div className="flex-1 flex flex-col overflow-hidden p-2 gap-2">
        {viewMode === 'synth' ? (
          <>
            {/* TOP ROW: Visualizer + Oscillators + Filter */}
            <div className="flex gap-2 flex-shrink-0" style={{ minHeight: '220px' }}>
              {/* Visualizer */}
              <div className="panel flex flex-col w-[280px] flex-shrink-0">
                <div className="flex items-center justify-between panel-header">
                  <span>ANALYZER</span>
                  <div className="flex gap-0.5">
                    {(['oscilloscope', 'spectrum'] as const).map(m => (
                      <button
                        key={m}
                        onClick={() => setVizMode(m)}
                        className={`text-[8px] uppercase px-1.5 py-0.5 rounded transition-all ${
                          vizMode === m ? 'text-nexus-accent bg-nexus-accent/10' : 'text-nexus-text-muted hover:text-nexus-text-dim'
                        }`}
                      >
                        {m === 'oscilloscope' ? 'SCOPE' : 'FFT'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex-1 p-2 flex items-center justify-center gap-2">
                  <Visualizer engine={engine} mode={vizMode} width={220} height={170} />
                  <PeakMeter engine={engine} width={8} height={170} />
                </div>
              </div>

              {/* OSC 1 */}
              <div className="panel flex-1">
                <div className="panel-header flex items-center justify-between">
                  <span>OSC 1</span>
                  <WaveformSelector
                    value={params.osc1.waveform}
                    onChange={w => updateParam('osc1', 'waveform', w)}
                  />
                </div>
                <div className="p-3 flex flex-wrap gap-2 items-start">
                  <Knob label="GAIN" value={params.osc1.gain} min={0} max={1} onChange={v => updateParam('osc1', 'gain', v)} />
                  <Knob label="OCTAVE" value={params.osc1.octave} min={-2} max={2} step={1} onChange={v => updateParam('osc1', 'octave', v)} formatValue={v => v > 0 ? `+${v}` : `${v}`} />
                  <Knob label="SEMI" value={params.osc1.semi} min={-12} max={12} step={1} onChange={v => updateParam('osc1', 'semi', v)} formatValue={v => v > 0 ? `+${v}` : `${v}`} />
                  <Knob label="DETUNE" value={params.osc1.detune} min={-100} max={100} step={1} unit="ct" onChange={v => updateParam('osc1', 'detune', v)} formatValue={v => Math.round(v).toString()} />
                  <Knob label="UNISON" value={params.osc1.unison} min={1} max={7} step={1} onChange={v => updateParam('osc1', 'unison', v)} formatValue={v => Math.round(v).toString()} />
                  <Knob label="SPREAD" value={params.osc1.unisonSpread} min={0} max={100} step={1} unit="ct" onChange={v => updateParam('osc1', 'unisonSpread', v)} formatValue={v => Math.round(v).toString()} />
                </div>
              </div>

              {/* OSC 2 */}
              <div className="panel flex-1">
                <div className="panel-header flex items-center justify-between">
                  <span>OSC 2</span>
                  <WaveformSelector
                    value={params.osc2.waveform}
                    onChange={w => updateParam('osc2', 'waveform', w)}
                  />
                </div>
                <div className="p-3 flex flex-wrap gap-2 items-start">
                  <Knob label="GAIN" value={params.osc2.gain} min={0} max={1} onChange={v => updateParam('osc2', 'gain', v)} />
                  <Knob label="OCTAVE" value={params.osc2.octave} min={-2} max={2} step={1} onChange={v => updateParam('osc2', 'octave', v)} formatValue={v => v > 0 ? `+${v}` : `${v}`} />
                  <Knob label="SEMI" value={params.osc2.semi} min={-12} max={12} step={1} onChange={v => updateParam('osc2', 'semi', v)} formatValue={v => v > 0 ? `+${v}` : `${v}`} />
                  <Knob label="DETUNE" value={params.osc2.detune} min={-100} max={100} step={1} unit="ct" onChange={v => updateParam('osc2', 'detune', v)} formatValue={v => Math.round(v).toString()} />
                  <Knob label="UNISON" value={params.osc2.unison} min={1} max={7} step={1} onChange={v => updateParam('osc2', 'unison', v)} formatValue={v => Math.round(v).toString()} />
                  <Knob label="SPREAD" value={params.osc2.unisonSpread} min={0} max={100} step={1} unit="ct" onChange={v => updateParam('osc2', 'unisonSpread', v)} formatValue={v => Math.round(v).toString()} />
                </div>
              </div>

              {/* FILTER + DRIVE */}
              <div className="panel w-[220px] flex-shrink-0">
                <div className="panel-header flex items-center justify-between">
                  <span>FILTER</span>
                  <div className="flex gap-0.5">
                    {FILTER_TYPES.map(ft => (
                      <button
                        key={ft}
                        onClick={() => updateParam('filter', 'type', ft)}
                        className={`text-[8px] px-1.5 py-0.5 rounded transition-all ${
                          params.filter.type === ft
                            ? 'text-nexus-warm bg-nexus-warm/10 border border-nexus-warm/30'
                            : 'text-nexus-text-muted hover:text-nexus-text-dim'
                        }`}
                      >
                        {FILTER_LABELS[ft]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="p-3 flex flex-wrap gap-2 items-start">
                  <Knob label="CUTOFF" value={params.filter.frequency} min={20} max={20000} step={1} unit="Hz" color="#ff6b35" onChange={v => updateParam('filter', 'frequency', v)} />
                  <Knob label="RESO" value={params.filter.resonance} min={0} max={20} step={0.1} color="#ff6b35" onChange={v => updateParam('filter', 'resonance', v)} />
                  <Knob label="ENV" value={params.filter.envAmount} min={0} max={1} color="#ff6b35" onChange={v => updateParam('filter', 'envAmount', v)} />
                  <Knob label="DRIVE" value={params.drive ?? 0.15} min={0} max={1} color="#ffbf3f" onChange={v => updateParam('drive', '', v)} />
                  <Knob label="NOISE" value={params.noiseLevel} min={0} max={0.5} color="#ff6b35" onChange={v => updateParam('noiseLevel', '', v)} />
                </div>
              </div>
            </div>

            {/* MIDDLE ROW: Envelopes + LFO + Effects + Master */}
            <div className="flex gap-2 flex-shrink-0" style={{ minHeight: '175px' }}>
              <div className="panel flex-1">
                <div className="panel-header"><span>AMP ENVELOPE</span></div>
                <div className="p-3 flex gap-2 items-start">
                  <Knob label="ATK" value={params.ampEnv.attack} min={0.001} max={5} unit="s" color="#00ff88" onChange={v => updateParam('ampEnv', 'attack', v)} />
                  <Knob label="DEC" value={params.ampEnv.decay} min={0.001} max={5} unit="s" color="#00ff88" onChange={v => updateParam('ampEnv', 'decay', v)} />
                  <Knob label="SUS" value={params.ampEnv.sustain} min={0} max={1} color="#00ff88" onChange={v => updateParam('ampEnv', 'sustain', v)} />
                  <Knob label="REL" value={params.ampEnv.release} min={0.005} max={10} unit="s" color="#00ff88" onChange={v => updateParam('ampEnv', 'release', v)} />
                </div>
              </div>

              <div className="panel flex-1">
                <div className="panel-header"><span>FILTER ENVELOPE</span></div>
                <div className="p-3 flex gap-2 items-start">
                  <Knob label="ATK" value={params.filterEnv.attack} min={0.001} max={5} unit="s" color="#ff6b35" onChange={v => updateParam('filterEnv', 'attack', v)} />
                  <Knob label="DEC" value={params.filterEnv.decay} min={0.001} max={5} unit="s" color="#ff6b35" onChange={v => updateParam('filterEnv', 'decay', v)} />
                  <Knob label="SUS" value={params.filterEnv.sustain} min={0} max={1} color="#ff6b35" onChange={v => updateParam('filterEnv', 'sustain', v)} />
                  <Knob label="REL" value={params.filterEnv.release} min={0.005} max={10} unit="s" color="#ff6b35" onChange={v => updateParam('filterEnv', 'release', v)} />
                </div>
              </div>

              <div className="panel w-[230px] flex-shrink-0">
                <div className="panel-header flex items-center justify-between">
                  <span>LFO</span>
                  <div className="flex gap-0.5">
                    {(['filter', 'pitch', 'amp'] as const).map(t => (
                      <button
                        key={t}
                        onClick={() => updateParam('lfo', 'target', t)}
                        className={`text-[8px] uppercase px-1.5 py-0.5 rounded transition-all ${
                          params.lfo.target === t
                            ? 'text-nexus-pink bg-nexus-pink/10 border border-nexus-pink/30'
                            : 'text-nexus-text-muted hover:text-nexus-text-dim'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="p-3 flex gap-2 items-start">
                  <Knob label="RATE" value={params.lfo.rate} min={0.01} max={20} unit="Hz" color="#ff2d7b" onChange={v => updateParam('lfo', 'rate', v)} />
                  <Knob label="DEPTH" value={params.lfo.depth} min={0} max={2000} color="#ff2d7b" onChange={v => updateParam('lfo', 'depth', v)} />
                  <div className="flex flex-col items-center gap-1 mt-1">
                    <span className="text-[9px] uppercase tracking-wider text-nexus-text-dim">WAVE</span>
                    <WaveformSelector
                      value={params.lfo.waveform}
                      onChange={w => updateParam('lfo', 'waveform', w)}
                    />
                  </div>
                </div>
              </div>

              <div className="panel flex-1">
                <div className="panel-header"><span>EFFECTS</span></div>
                <div className="p-3 flex flex-wrap gap-2 items-start">
                  <Knob label="REV MIX" value={params.effects.reverbMix} min={0} max={1} onChange={v => updateParam('effects', 'reverbMix', v)} />
                  <Knob label="REV DEC" value={params.effects.reverbDecay} min={0.1} max={6} unit="s" onChange={v => {
                    updateParam('effects', 'reverbDecay', v);
                    engineRef.current?.updateReverb(v);
                  }} />
                  <Knob label="DLY MIX" value={params.effects.delayMix} min={0} max={1} onChange={v => updateParam('effects', 'delayMix', v)} />
                  <Knob label="DLY TM" value={params.effects.delayTime} min={0.01} max={1.5} unit="s" onChange={v => updateParam('effects', 'delayTime', v)} />
                  <Knob label="DLY FB" value={params.effects.delayFeedback} min={0} max={0.9} onChange={v => updateParam('effects', 'delayFeedback', v)} />
                  <Knob label="CHR MIX" value={params.effects.chorusMix} min={0} max={1} color="#a855f7" onChange={v => updateParam('effects', 'chorusMix', v)} />
                  <Knob label="CHR RATE" value={params.effects.chorusRate} min={0.1} max={6} unit="Hz" color="#a855f7" onChange={v => updateParam('effects', 'chorusRate', v)} />
                  <Knob label="DIST" value={params.effects.distortionDrive} min={0} max={1} onChange={v => updateParam('effects', 'distortionDrive', v)} />
                  <Knob label="DIST MX" value={params.effects.distortionMix} min={0} max={1} onChange={v => updateParam('effects', 'distortionMix', v)} />
                </div>
              </div>

              <div className="panel w-[80px] flex-shrink-0">
                <div className="panel-header"><span>MASTER</span></div>
                <div className="p-3 flex flex-col items-center">
                  <Knob label="VOLUME" value={params.masterGain} min={0} max={1} size={56} onChange={v => updateParam('masterGain', '', v)} />
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="panel flex-1">
            <div className="panel-header"><span>STEP SEQUENCER</span></div>
            <div className="p-3 flex-1">
              <Sequencer onNoteOn={handleNoteOn} onNoteOff={handleNoteOff} baseOctave={octave} />
            </div>
          </div>
        )}

        {/* KEYBOARD */}
        <div className="panel flex-shrink-0">
          <div className="panel-header"><span>KEYBOARD</span></div>
          <div className="p-2">
            <Keyboard
              onNoteOn={handleNoteOn}
              onNoteOff={handleNoteOff}
              octave={octave}
              onOctaveChange={setOctave}
              activeNotes={activeNotes}
            />
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <footer className="flex items-center justify-between px-4 py-1 border-t border-nexus-border text-[8px] text-nexus-text-muted font-mono flex-shrink-0">
        <span>
          NEXUS SPECTRAL SYNTHESIZER v{APP_VERSION}
          {getActiveProviders().length > 0 && (
            <span className="ml-3 text-nexus-text-dim">● {getActiveProviders().join(' · ')}</span>
          )}
        </span>
        <span>{engine ? `${engine.ctx.sampleRate}Hz · ${engine.ctx.state}` : 'Audio not initialized'}</span>
      </footer>
    </div>
  );
};

export default App;
