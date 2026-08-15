export type WaveformType = 'sine' | 'sawtooth' | 'square' | 'triangle';
export type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'notch' | 'peak';
export type FilterModel = 'svf' | 'ladder';
export type FilterSlope = 12 | 24;
export type FilterRouting = 'serial' | 'parallel';
export type LfoTarget = 'filter' | 'filter2' | 'pitch' | 'amp' | 'drive' | 'res';
export type ModSource = 'lfo1' | 'lfo2' | 'ampEnv' | 'filterEnv' | 'velocity' | 'modWheel' | 'follower';
export type ModDest = 'cutoff1' | 'cutoff2' | 'res1' | 'res2' | 'pitch' | 'amp' | 'drive' | 'pan' | 'f2mix';

export interface OscConfig {
  waveform: WaveformType;
  detune: number;
  gain: number;
  octave: number;
  semi: number;
  unison: number;
  unisonSpread: number;
}

export interface FilterConfig {
  model: FilterModel;
  type: FilterType;
  frequency: number;
  resonance: number;
  envAmount: number;
  drive: number;
  slope: FilterSlope;
  keytrack: number;
  enabled: boolean;
}

export interface ADSRConfig {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export interface EffectsConfig {
  reverbMix: number;
  reverbDecay: number;
  delayTime: number;
  delayFeedback: number;
  delayMix: number;
  distortionDrive: number;
  distortionMix: number;
  chorusRate: number;
  chorusDepth: number;
  chorusMix: number;
}

export interface LFOConfig {
  rate: number;
  depth: number;
  waveform: WaveformType;
  target: LfoTarget;
}

export interface ModRoute {
  source: ModSource;
  dest: ModDest;
  depth: number;
  enabled: boolean;
}

export interface SynthParams {
  osc1: OscConfig;
  osc2: OscConfig;
  filter: FilterConfig;
  filter2: FilterConfig;
  filterRouting: FilterRouting;
  filterMix: number;
  filterSpread: number;
  ampEnv: ADSRConfig;
  filterEnv: ADSRConfig;
  effects: EffectsConfig;
  lfo: LFOConfig;
  lfo2: LFOConfig;
  modMatrix: ModRoute[];
  masterGain: number;
  glide: number;
  noiseLevel: number;
  drive: number;
  sampleMix: number;
}

export const FILTER_TYPE_INDEX: Record<FilterType, number> = {
  lowpass: 0,
  highpass: 1,
  bandpass: 2,
  notch: 3,
  peak: 4,
};

export function defaultFilter(over: Partial<FilterConfig> = {}): FilterConfig {
  const rawRes = over.resonance ?? 0.2;
  const resonance = rawRes > 1 ? Math.min(1, rawRes / 20) : rawRes;
  return {
    model: over.model ?? 'svf',
    type: over.type ?? 'lowpass',
    frequency: over.frequency ?? 8000,
    resonance,
    envAmount: over.envAmount ?? 0,
    drive: over.drive ?? 0,
    slope: over.slope ?? 24,
    keytrack: over.keytrack ?? 0,
    enabled: over.enabled ?? true,
  };
}

export function defaultModMatrix(): ModRoute[] {
  return [
    { source: 'lfo1', dest: 'cutoff1', depth: 0, enabled: false },
    { source: 'lfo2', dest: 'cutoff2', depth: 0, enabled: false },
    { source: 'filterEnv', dest: 'cutoff1', depth: 0, enabled: false },
    { source: 'follower', dest: 'cutoff1', depth: 0.6, enabled: false },
    { source: 'velocity', dest: 'amp', depth: 0, enabled: false },
    { source: 'modWheel', dest: 'res1', depth: 0, enabled: false },
  ];
}

export function hydrateParams(p: Partial<SynthParams> = {}): SynthParams {
  const f1 = (p.filter || {}) as Partial<FilterConfig>;
  const f2 = (p.filter2 || {}) as Partial<FilterConfig>;
  return {
    osc1: p.osc1 as SynthParams['osc1'],
    osc2: p.osc2 as SynthParams['osc2'],
    ...p,
    filter: defaultFilter(f1),
    filter2: p.filter2
      ? defaultFilter(f2)
      : defaultFilter({ enabled: false, frequency: 12000, slope: 12, resonance: 0.1 }),
    filterRouting: p.filterRouting ?? 'serial',
    filterMix: p.filterMix ?? 0.5,
    filterSpread: p.filterSpread ?? 0,
    lfo2: p.lfo2 ?? { rate: 0.5, depth: 0, waveform: 'sine', target: 'filter2' },
    modMatrix: p.modMatrix?.length ? p.modMatrix : defaultModMatrix(),
    sampleMix: p.sampleMix ?? 0,
    drive: (p.drive as number) ?? 0.15,
  } as SynthParams;
}

export const NOTE_FREQ = (note: number) => 440 * Math.pow(2, (note - 69) / 12);

export function trackedCutoffHz(baseHz: number, keytrack: number, note: number): number {
  const hz = baseHz * Math.pow(2, keytrack * (note - 60) / 12);
  return Math.max(20, Math.min(20000, hz));
}

export function envPeakHz(baseHz: number, envAmount: number): number {
  return Math.max(20, Math.min(20000, baseHz * Math.pow(2, envAmount * 4)));
}
