import React, { useState, useCallback, useRef, useEffect } from 'react';
import { AudioEngine, type SynthParams, type WaveformType, type FilterType } from './audio/AudioEngine';
import { PRESETS, DEFAULT_PARAMS } from './audio/presets';
import Knob from './components/Knob';
import Visualizer from './components/Visualizer';
import Keyboard from './components/Keyboard';
import Sequencer from './components/Sequencer';

type ViewMode = 'synth' | 'sequencer';

const WAVEFORMS: WaveformType[] = ['sine', 'sawtooth', 'square', 'triangle'];
const WAVE_ICONS: Record<WaveformType, string> = {
  sine: '∿', sawtooth: '⩘', square: '⊓', triangle: '△',
};
const FILTER_TYPES: FilterType[] = ['lowpass', 'highpass', 'bandpass', 'notch'];
const FILTER_LABELS: Record<FilterType, string> = {
  lowpass: 'LP', highpass: 'HP', bandpass: 'BP', notch: 'NT',
};

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

const App: React.FC = () => {
  const [params, setParams] = useState<SynthParams>(deepClone(DEFAULT_PARAMS));
  const [presetIdx, setPresetIdx] = useState(0);
  const [engine, setEngine] = useState<AudioEngine | null>(null);
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());
  const [octave, setOctave] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>('synth');
  const [vizMode, setVizMode] = useState<'oscilloscope' | 'spectrum'>('oscilloscope');
  const [isInitialized, setIsInitialized] = useState(false);
  const engineRef = useRef<AudioEngine | null>(null);

  const initAudio = useCallback(() => {
    if (engineRef.current) return engineRef.current;
    const eng = new AudioEngine(params);
    engineRef.current = eng;
    setEngine(eng);
    setIsInitialized(true);
    return eng;
  }, [params]);

  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.updateParams(params);
    }
  }, [params]);

  const updateParam = useCallback((
    section: string,
    key: string,
    value: number | string
  ) => {
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
  }, [initAudio]);

  const handleNoteOff = useCallback((note: number) => {
    engineRef.current?.noteOff(note);
    setActiveNotes(prev => {
      const next = new Set(prev);
      next.delete(note);
      return next;
    });
  }, []);

  const loadPreset = (idx: number) => {
    setPresetIdx(idx);
    const p = deepClone(PRESETS[idx].params);
    setParams(p);
    if (engineRef.current) {
      engineRef.current.updateParams(p);
      if (PRESETS[idx].params.effects.reverbDecay !== params.effects.reverbDecay) {
        engineRef.current.updateReverb(PRESETS[idx].params.effects.reverbDecay);
      }
    }
  };

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
      <header className="flex items-center justify-between px-4 py-2 border-b border-nexus-border bg-nexus-bg/80 backdrop-blur-sm flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-nexus-accent animate-pulse-glow" style={{ boxShadow: '0 0 8px #00d4ff' }} />
            <h1 className="text-base font-display font-bold tracking-[0.15em] text-nexus-text">NEXUS</h1>
            <span className="text-[8px] uppercase tracking-[0.2em] text-nexus-text-muted font-mono mt-0.5">SPECTRAL SYNTH</span>
          </div>
          <div className="h-4 w-px bg-nexus-border" />
          <div className="flex items-center gap-1">
            {['synth', 'sequencer'].map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode as ViewMode)}
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
        </div>

        {/* Preset browser */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => loadPreset(Math.max(0, presetIdx - 1))}
            className="text-nexus-text-dim hover:text-nexus-accent text-sm px-1 transition-colors"
          >
            ◀
          </button>
          <div className="min-w-[140px] text-center">
            <div className="text-[10px] font-mono text-nexus-text">{PRESETS[presetIdx].name}</div>
            <div className="text-[8px] uppercase tracking-wider text-nexus-text-muted">{PRESETS[presetIdx].category}</div>
          </div>
          <button
            onClick={() => loadPreset(Math.min(PRESETS.length - 1, presetIdx + 1))}
            className="text-nexus-text-dim hover:text-nexus-accent text-sm px-1 transition-colors"
          >
            ▶
          </button>
        </div>

        <div className="flex items-center gap-3">
          {!isInitialized && (
            <button
              onClick={initAudio}
              className="text-[9px] uppercase tracking-wider px-3 py-1.5 rounded bg-nexus-accent/20 text-nexus-accent border border-nexus-accent/40 hover:bg-nexus-accent/30 transition-all shadow-glow"
            >
              START AUDIO
            </button>
          )}
          <div className="flex items-center gap-1.5">
            <span className="text-[8px] uppercase tracking-wider text-nexus-text-muted">VOICES</span>
            <span className="text-[10px] font-mono text-nexus-accent">{engine?.activeVoiceCount ?? 0}</span>
          </div>
          <button
            onClick={() => engineRef.current?.panic()}
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
            {/* TOP ROW: Visualizer + Oscillators + Filter + Envelope */}
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
                <div className="flex-1 p-2 flex items-center justify-center">
                  <Visualizer engine={engine} mode={vizMode} width={256} height={170} />
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

              {/* FILTER */}
              <div className="panel w-[200px] flex-shrink-0">
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
                  <Knob label="NOISE" value={params.noiseLevel} min={0} max={0.5} color="#ff6b35" onChange={v => updateParam('noiseLevel', '', v)} />
                </div>
              </div>
            </div>

            {/* MIDDLE ROW: Envelopes + Effects + LFO + Master */}
            <div className="flex gap-2 flex-shrink-0" style={{ minHeight: '175px' }}>
              {/* AMP ENV */}
              <div className="panel flex-1">
                <div className="panel-header"><span>AMP ENVELOPE</span></div>
                <div className="p-3 flex gap-2 items-start">
                  <Knob label="ATK" value={params.ampEnv.attack} min={0.001} max={5} unit="s" color="#00ff88" onChange={v => updateParam('ampEnv', 'attack', v)} />
                  <Knob label="DEC" value={params.ampEnv.decay} min={0.001} max={5} unit="s" color="#00ff88" onChange={v => updateParam('ampEnv', 'decay', v)} />
                  <Knob label="SUS" value={params.ampEnv.sustain} min={0} max={1} color="#00ff88" onChange={v => updateParam('ampEnv', 'sustain', v)} />
                  <Knob label="REL" value={params.ampEnv.release} min={0.005} max={10} unit="s" color="#00ff88" onChange={v => updateParam('ampEnv', 'release', v)} />
                </div>
              </div>

              {/* FILTER ENV */}
              <div className="panel flex-1">
                <div className="panel-header"><span>FILTER ENVELOPE</span></div>
                <div className="p-3 flex gap-2 items-start">
                  <Knob label="ATK" value={params.filterEnv.attack} min={0.001} max={5} unit="s" color="#ff6b35" onChange={v => updateParam('filterEnv', 'attack', v)} />
                  <Knob label="DEC" value={params.filterEnv.decay} min={0.001} max={5} unit="s" color="#ff6b35" onChange={v => updateParam('filterEnv', 'decay', v)} />
                  <Knob label="SUS" value={params.filterEnv.sustain} min={0} max={1} color="#ff6b35" onChange={v => updateParam('filterEnv', 'sustain', v)} />
                  <Knob label="REL" value={params.filterEnv.release} min={0.005} max={10} unit="s" color="#ff6b35" onChange={v => updateParam('filterEnv', 'release', v)} />
                </div>
              </div>

              {/* LFO */}
              <div className="panel w-[220px] flex-shrink-0">
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
                  <Knob label="DEPTH" value={params.lfo.depth} min={0} max={1000} color="#ff2d7b" onChange={v => updateParam('lfo', 'depth', v)} />
                  <div className="flex flex-col items-center gap-1 mt-1">
                    <span className="text-[9px] uppercase tracking-wider text-nexus-text-dim">WAVE</span>
                    <WaveformSelector
                      value={params.lfo.waveform}
                      onChange={w => updateParam('lfo', 'waveform', w)}
                    />
                  </div>
                </div>
              </div>

              {/* EFFECTS */}
              <div className="panel flex-1">
                <div className="panel-header"><span>EFFECTS</span></div>
                <div className="p-3 flex flex-wrap gap-2 items-start">
                  <Knob label="REV MIX" value={params.effects.reverbMix} min={0} max={1} onChange={v => updateParam('effects', 'reverbMix', v)} />
                  <Knob label="REV DEC" value={params.effects.reverbDecay} min={0.1} max={6} unit="s" onChange={v => {
                    updateParam('effects', 'reverbDecay', v);
                    engineRef.current?.updateReverb(v);
                  }} />
                  <Knob label="DLY MIX" value={params.effects.delayMix} min={0} max={1} onChange={v => updateParam('effects', 'delayMix', v)} />
                  <Knob label="DLY TIME" value={params.effects.delayTime} min={0.01} max={1.5} unit="s" onChange={v => updateParam('effects', 'delayTime', v)} />
                  <Knob label="DLY FB" value={params.effects.delayFeedback} min={0} max={0.9} onChange={v => updateParam('effects', 'delayFeedback', v)} />
                  <Knob label="DIST" value={params.effects.distortionDrive} min={0} max={1} onChange={v => updateParam('effects', 'distortionDrive', v)} />
                  <Knob label="DIST MX" value={params.effects.distortionMix} min={0} max={1} onChange={v => updateParam('effects', 'distortionMix', v)} />
                </div>
              </div>

              {/* MASTER */}
              <div className="panel w-[80px] flex-shrink-0">
                <div className="panel-header"><span>MASTER</span></div>
                <div className="p-3 flex flex-col items-center">
                  <Knob label="VOLUME" value={params.masterGain} min={0} max={1} size={56} onChange={v => updateParam('masterGain', '', v)} />
                </div>
              </div>
            </div>
          </>
        ) : (
          /* SEQUENCER VIEW */
          <div className="panel flex-1">
            <div className="panel-header"><span>STEP SEQUENCER</span></div>
            <div className="p-3 flex-1">
              <Sequencer onNoteOn={handleNoteOn} onNoteOff={handleNoteOff} baseOctave={octave} />
            </div>
          </div>
        )}

        {/* KEYBOARD (always visible) */}
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
        <span>NEXUS SPECTRAL SYNTHESIZER v1.0</span>
        <span>{engine ? `${engine.ctx.sampleRate}Hz · ${engine.ctx.state}` : 'Audio not initialized'}</span>
      </footer>
    </div>
  );
};

export default App;
