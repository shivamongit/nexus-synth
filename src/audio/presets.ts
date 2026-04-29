import type { SynthParams } from './AudioEngine';

export interface Preset {
  name: string;
  category: string;
  params: SynthParams;
}

const BASE: SynthParams = {
  osc1: { waveform: 'sawtooth', detune: 0, gain: 0.5, octave: 0, semi: 0, unison: 1, unisonSpread: 0 },
  osc2: { waveform: 'square', detune: 0, gain: 0, octave: 0, semi: 0, unison: 1, unisonSpread: 0 },
  filter: { type: 'lowpass', frequency: 8000, resonance: 1, envAmount: 0 },
  ampEnv: { attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.3 },
  filterEnv: { attack: 0.01, decay: 0.3, sustain: 0.5, release: 0.3 },
  effects: {
    reverbMix: 0, reverbDecay: 1.5,
    delayTime: 0.3, delayFeedback: 0.3, delayMix: 0,
    distortionDrive: 0, distortionMix: 0,
    chorusRate: 1, chorusDepth: 0.5, chorusMix: 0,
  },
  lfo: { rate: 2, depth: 0, waveform: 'sine', target: 'filter' },
  masterGain: 0.6,
  glide: 0,
  noiseLevel: 0,
  drive: 0.15,
};

function merge(overrides: Partial<SynthParams> & Record<string, any>): SynthParams {
  return {
    ...BASE,
    ...overrides,
    osc1: { ...BASE.osc1, ...(overrides.osc1 || {}) },
    osc2: { ...BASE.osc2, ...(overrides.osc2 || {}) },
    filter: { ...BASE.filter, ...(overrides.filter || {}) },
    ampEnv: { ...BASE.ampEnv, ...(overrides.ampEnv || {}) },
    filterEnv: { ...BASE.filterEnv, ...(overrides.filterEnv || {}) },
    effects: { ...BASE.effects, ...(overrides.effects || {}) },
    lfo: { ...BASE.lfo, ...(overrides.lfo || {}) },
  };
}

export const PRESETS: Preset[] = [
  {
    name: 'INIT',
    category: 'Init',
    params: { ...BASE },
  },
  {
    name: 'Hypersaw Lead',
    category: 'Lead',
    params: merge({
      osc1: { waveform: 'sawtooth', detune: 0, gain: 0.5, octave: 0, semi: 0, unison: 5, unisonSpread: 25 },
      osc2: { waveform: 'sawtooth', detune: 7, gain: 0.3, octave: 1, semi: 0, unison: 3, unisonSpread: 15 },
      filter: { type: 'lowpass', frequency: 4000, resonance: 3, envAmount: 0.6 },
      ampEnv: { attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.4 },
      filterEnv: { attack: 0.005, decay: 0.3, sustain: 0.4, release: 0.5 },
      effects: { ...BASE.effects, reverbMix: 0.15, reverbDecay: 1.8, delayMix: 0.12, delayTime: 0.375, delayFeedback: 0.35 },
    }),
  },
  {
    name: 'Deep Sub Bass',
    category: 'Bass',
    params: merge({
      osc1: { waveform: 'sine', detune: 0, gain: 0.7, octave: -1, semi: 0, unison: 1, unisonSpread: 0 },
      osc2: { waveform: 'square', detune: 0, gain: 0.2, octave: 0, semi: 0, unison: 1, unisonSpread: 0 },
      filter: { type: 'lowpass', frequency: 400, resonance: 2, envAmount: 0.4 },
      ampEnv: { attack: 0.005, decay: 0.4, sustain: 0.9, release: 0.15 },
      filterEnv: { attack: 0.005, decay: 0.5, sustain: 0.2, release: 0.2 },
      effects: { ...BASE.effects, distortionDrive: 0.15, distortionMix: 0.2 },
    }),
  },
  {
    name: 'Ethereal Pad',
    category: 'Pad',
    params: merge({
      osc1: { waveform: 'sawtooth', detune: -5, gain: 0.35, octave: 0, semi: 0, unison: 4, unisonSpread: 30 },
      osc2: { waveform: 'triangle', detune: 5, gain: 0.35, octave: 0, semi: 7, unison: 3, unisonSpread: 20 },
      filter: { type: 'lowpass', frequency: 2500, resonance: 2, envAmount: 0.3 },
      ampEnv: { attack: 1.2, decay: 1.5, sustain: 0.7, release: 3.0 },
      filterEnv: { attack: 1.0, decay: 2.0, sustain: 0.5, release: 2.5 },
      effects: { ...BASE.effects, reverbMix: 0.5, reverbDecay: 3.0, chorusMix: 0.3, chorusRate: 0.5, chorusDepth: 0.7 },
      lfo: { rate: 0.3, depth: 200, waveform: 'sine', target: 'filter' },
      noiseLevel: 0.03,
    }),
  },
  {
    name: 'Crystal Pluck',
    category: 'Pluck',
    params: merge({
      osc1: { waveform: 'triangle', detune: 0, gain: 0.5, octave: 0, semi: 0, unison: 2, unisonSpread: 8 },
      osc2: { waveform: 'sine', detune: 0, gain: 0.3, octave: 1, semi: 0, unison: 1, unisonSpread: 0 },
      filter: { type: 'lowpass', frequency: 6000, resonance: 4, envAmount: 0.8 },
      ampEnv: { attack: 0.002, decay: 0.5, sustain: 0.0, release: 0.8 },
      filterEnv: { attack: 0.001, decay: 0.4, sustain: 0.0, release: 0.6 },
      effects: { ...BASE.effects, reverbMix: 0.3, reverbDecay: 2.0, delayMix: 0.2, delayTime: 0.25, delayFeedback: 0.4 },
    }),
  },
  {
    name: 'Reese Bass',
    category: 'Bass',
    params: merge({
      osc1: { waveform: 'sawtooth', detune: -12, gain: 0.5, octave: -1, semi: 0, unison: 2, unisonSpread: 10 },
      osc2: { waveform: 'sawtooth', detune: 12, gain: 0.5, octave: -1, semi: 0, unison: 2, unisonSpread: 10 },
      filter: { type: 'lowpass', frequency: 1200, resonance: 5, envAmount: 0.3 },
      ampEnv: { attack: 0.01, decay: 0.3, sustain: 0.9, release: 0.2 },
      filterEnv: { attack: 0.01, decay: 0.6, sustain: 0.3, release: 0.3 },
      lfo: { rate: 0.15, depth: 300, waveform: 'sine', target: 'filter' },
      effects: { ...BASE.effects, distortionDrive: 0.3, distortionMix: 0.25 },
    }),
  },
  {
    name: 'Acid Squelch',
    category: 'Lead',
    params: merge({
      osc1: { waveform: 'sawtooth', detune: 0, gain: 0.6, octave: 0, semi: 0, unison: 1, unisonSpread: 0 },
      osc2: { waveform: 'square', detune: 0, gain: 0.0, octave: 0, semi: 0, unison: 1, unisonSpread: 0 },
      filter: { type: 'lowpass', frequency: 300, resonance: 15, envAmount: 0.9 },
      ampEnv: { attack: 0.002, decay: 0.2, sustain: 0.5, release: 0.1 },
      filterEnv: { attack: 0.002, decay: 0.15, sustain: 0.05, release: 0.1 },
      effects: { ...BASE.effects, distortionDrive: 0.4, distortionMix: 0.3, delayMix: 0.15, delayTime: 0.188, delayFeedback: 0.5 },
    }),
  },
  {
    name: 'Warm Keys',
    category: 'Keys',
    params: merge({
      osc1: { waveform: 'triangle', detune: -3, gain: 0.45, octave: 0, semi: 0, unison: 2, unisonSpread: 6 },
      osc2: { waveform: 'sine', detune: 3, gain: 0.35, octave: 0, semi: 0, unison: 1, unisonSpread: 0 },
      filter: { type: 'lowpass', frequency: 3500, resonance: 1, envAmount: 0.4 },
      ampEnv: { attack: 0.008, decay: 0.8, sustain: 0.4, release: 0.5 },
      filterEnv: { attack: 0.005, decay: 0.6, sustain: 0.2, release: 0.4 },
      effects: { ...BASE.effects, reverbMix: 0.2, reverbDecay: 1.5, chorusMix: 0.15, chorusRate: 0.8, chorusDepth: 0.4 },
    }),
  },
  {
    name: 'Noise Riser FX',
    category: 'FX',
    params: merge({
      osc1: { waveform: 'sawtooth', detune: 0, gain: 0.2, octave: 1, semi: 0, unison: 3, unisonSpread: 40 },
      osc2: { waveform: 'square', detune: 0, gain: 0.15, octave: 2, semi: 7, unison: 2, unisonSpread: 50 },
      filter: { type: 'bandpass', frequency: 2000, resonance: 8, envAmount: 0.7 },
      ampEnv: { attack: 2.0, decay: 0.5, sustain: 0.8, release: 1.5 },
      filterEnv: { attack: 3.0, decay: 1.0, sustain: 0.9, release: 1.0 },
      noiseLevel: 0.15,
      effects: { ...BASE.effects, reverbMix: 0.6, reverbDecay: 4.0, delayMix: 0.3, delayTime: 0.5, delayFeedback: 0.6 },
      lfo: { rate: 4, depth: 500, waveform: 'sawtooth', target: 'filter' },
    }),
  },
  {
    name: 'Cyber Arp',
    category: 'Lead',
    params: merge({
      osc1: { waveform: 'square', detune: 0, gain: 0.4, octave: 0, semi: 0, unison: 2, unisonSpread: 12 },
      osc2: { waveform: 'sawtooth', detune: 0, gain: 0.3, octave: 1, semi: 0, unison: 1, unisonSpread: 0 },
      filter: { type: 'lowpass', frequency: 5000, resonance: 4, envAmount: 0.5 },
      ampEnv: { attack: 0.002, decay: 0.15, sustain: 0.0, release: 0.2 },
      filterEnv: { attack: 0.001, decay: 0.12, sustain: 0.0, release: 0.15 },
      effects: { ...BASE.effects, delayMix: 0.35, delayTime: 0.167, delayFeedback: 0.55, reverbMix: 0.2, reverbDecay: 1.2 },
    }),
  },

  // ─── Production-grade additions ──────────────────────────────────────
  {
    name: 'Trance Supersaw',
    category: 'Lead',
    params: merge({
      osc1: { waveform: 'sawtooth', detune: -8, gain: 0.5, octave: 0, semi: 0, unison: 7, unisonSpread: 35 },
      osc2: { waveform: 'sawtooth', detune: 8, gain: 0.4, octave: -1, semi: 0, unison: 5, unisonSpread: 22 },
      filter: { type: 'lowpass', frequency: 5500, resonance: 2, envAmount: 0.5 },
      ampEnv: { attack: 0.02, decay: 0.4, sustain: 0.85, release: 0.6 },
      filterEnv: { attack: 0.005, decay: 0.4, sustain: 0.6, release: 0.5 },
      effects: { ...BASE.effects, reverbMix: 0.28, reverbDecay: 2.2, delayMix: 0.18, delayTime: 0.375, delayFeedback: 0.4, chorusMix: 0.25, chorusRate: 0.7, chorusDepth: 0.6 },
      drive: 0.25,
    }),
  },
  {
    name: 'Wobble Bass',
    category: 'Bass',
    params: merge({
      osc1: { waveform: 'sawtooth', detune: 0, gain: 0.55, octave: -1, semi: 0, unison: 3, unisonSpread: 18 },
      osc2: { waveform: 'square', detune: 0, gain: 0.3, octave: -1, semi: 12, unison: 1, unisonSpread: 0 },
      filter: { type: 'lowpass', frequency: 600, resonance: 8, envAmount: 0.5 },
      ampEnv: { attack: 0.005, decay: 0.3, sustain: 0.9, release: 0.2 },
      filterEnv: { attack: 0.005, decay: 0.3, sustain: 0.3, release: 0.3 },
      lfo: { rate: 4, depth: 1800, waveform: 'sine', target: 'filter' },
      effects: { ...BASE.effects, distortionDrive: 0.35, distortionMix: 0.3, reverbMix: 0.08 },
      drive: 0.35,
    }),
  },
  {
    name: 'Dubstep Growl',
    category: 'Bass',
    params: merge({
      osc1: { waveform: 'sawtooth', detune: -12, gain: 0.5, octave: -1, semi: 0, unison: 3, unisonSpread: 25 },
      osc2: { waveform: 'square', detune: 12, gain: 0.45, octave: 0, semi: 7, unison: 3, unisonSpread: 15 },
      filter: { type: 'lowpass', frequency: 900, resonance: 12, envAmount: 0.65 },
      ampEnv: { attack: 0.003, decay: 0.25, sustain: 0.85, release: 0.15 },
      filterEnv: { attack: 0.003, decay: 0.3, sustain: 0.4, release: 0.2 },
      lfo: { rate: 6, depth: 700, waveform: 'square', target: 'filter' },
      effects: { ...BASE.effects, distortionDrive: 0.5, distortionMix: 0.45, delayMix: 0.05 },
      drive: 0.5,
    }),
  },
  {
    name: 'Ambient Drone',
    category: 'Pad',
    params: merge({
      osc1: { waveform: 'sawtooth', detune: -7, gain: 0.3, octave: 0, semi: 0, unison: 5, unisonSpread: 50 },
      osc2: { waveform: 'triangle', detune: 7, gain: 0.3, octave: 1, semi: 5, unison: 3, unisonSpread: 40 },
      filter: { type: 'lowpass', frequency: 1800, resonance: 1, envAmount: 0.2 },
      ampEnv: { attack: 2.5, decay: 2.0, sustain: 0.8, release: 5.0 },
      filterEnv: { attack: 3.0, decay: 3.0, sustain: 0.6, release: 4.0 },
      lfo: { rate: 0.15, depth: 300, waveform: 'sine', target: 'filter' },
      effects: { ...BASE.effects, reverbMix: 0.7, reverbDecay: 5.5, delayMix: 0.25, delayTime: 0.5, delayFeedback: 0.5, chorusMix: 0.45, chorusRate: 0.35, chorusDepth: 0.8 },
      noiseLevel: 0.05,
    }),
  },
  {
    name: 'FM Bell',
    category: 'Keys',
    params: merge({
      osc1: { waveform: 'sine', detune: 0, gain: 0.6, octave: 0, semi: 0, unison: 1, unisonSpread: 0 },
      osc2: { waveform: 'sine', detune: 0, gain: 0.25, octave: 2, semi: 7, unison: 1, unisonSpread: 0 },
      filter: { type: 'highpass', frequency: 120, resonance: 0.5, envAmount: 0 },
      ampEnv: { attack: 0.002, decay: 1.8, sustain: 0.0, release: 1.5 },
      filterEnv: { attack: 0.001, decay: 1.0, sustain: 0.0, release: 0.8 },
      effects: { ...BASE.effects, reverbMix: 0.45, reverbDecay: 3.5, delayMix: 0.22, delayTime: 0.333, delayFeedback: 0.45, chorusMix: 0.15, chorusRate: 1.2, chorusDepth: 0.3 },
      drive: 0.05,
    }),
  },
  {
    name: 'Phaser Pluck',
    category: 'Pluck',
    params: merge({
      osc1: { waveform: 'sawtooth', detune: -4, gain: 0.5, octave: 0, semi: 0, unison: 3, unisonSpread: 15 },
      osc2: { waveform: 'square', detune: 4, gain: 0.3, octave: 0, semi: 0, unison: 2, unisonSpread: 8 },
      filter: { type: 'bandpass', frequency: 2500, resonance: 6, envAmount: 0.6 },
      ampEnv: { attack: 0.003, decay: 0.35, sustain: 0.15, release: 0.4 },
      filterEnv: { attack: 0.002, decay: 0.3, sustain: 0.1, release: 0.3 },
      lfo: { rate: 0.8, depth: 1500, waveform: 'sine', target: 'filter' },
      effects: { ...BASE.effects, reverbMix: 0.28, reverbDecay: 1.8, delayMix: 0.28, delayTime: 0.25, delayFeedback: 0.45, chorusMix: 0.35, chorusRate: 1.5, chorusDepth: 0.7 },
    }),
  },
  {
    name: 'Vintage Brass',
    category: 'Keys',
    params: merge({
      osc1: { waveform: 'sawtooth', detune: -3, gain: 0.5, octave: 0, semi: 0, unison: 2, unisonSpread: 10 },
      osc2: { waveform: 'sawtooth', detune: 3, gain: 0.4, octave: 0, semi: 7, unison: 2, unisonSpread: 10 },
      filter: { type: 'lowpass', frequency: 2400, resonance: 2, envAmount: 0.35 },
      ampEnv: { attack: 0.08, decay: 0.3, sustain: 0.7, release: 0.25 },
      filterEnv: { attack: 0.04, decay: 0.3, sustain: 0.4, release: 0.3 },
      effects: { ...BASE.effects, reverbMix: 0.2, reverbDecay: 1.6, chorusMix: 0.25, chorusRate: 0.9, chorusDepth: 0.5, distortionDrive: 0.15, distortionMix: 0.12 },
      drive: 0.3,
    }),
  },
  {
    name: 'Future Pluck',
    category: 'Pluck',
    params: merge({
      osc1: { waveform: 'sawtooth', detune: 0, gain: 0.45, octave: 0, semi: 0, unison: 4, unisonSpread: 20 },
      osc2: { waveform: 'triangle', detune: 0, gain: 0.35, octave: 1, semi: 0, unison: 2, unisonSpread: 10 },
      filter: { type: 'lowpass', frequency: 5500, resonance: 5, envAmount: 0.75 },
      ampEnv: { attack: 0.002, decay: 0.4, sustain: 0.0, release: 0.5 },
      filterEnv: { attack: 0.001, decay: 0.3, sustain: 0.0, release: 0.35 },
      effects: { ...BASE.effects, reverbMix: 0.3, reverbDecay: 1.8, delayMix: 0.32, delayTime: 0.25, delayFeedback: 0.55, chorusMix: 0.2, chorusRate: 0.8, chorusDepth: 0.5 },
    }),
  },
];

export const DEFAULT_PARAMS = PRESETS[0].params;
