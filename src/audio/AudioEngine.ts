// NEXUS Spectral Synthesizer — Audio Engine
// Dual ZDF filters in AudioWorklet, live params, poly steal, sample osc, mod matrix.

export type {
  WaveformType, FilterType, FilterModel, FilterSlope, FilterRouting,
  LfoTarget, ModSource, ModDest, OscConfig, FilterConfig, ADSRConfig,
  EffectsConfig, LFOConfig, ModRoute, SynthParams,
} from './types';

import type { LFOConfig, OscConfig, SynthParams } from './types';
import {
  FILTER_TYPE_INDEX, NOTE_FREQ, envPeakHz, hydrateParams, trackedCutoffHz,
} from './types';

interface Voice {
  osc1Nodes: OscillatorNode[];
  osc2Nodes: OscillatorNode[];
  osc1Gains: GainNode[];
  osc2Gains: GainNode[];
  osc1Pans: StereoPannerNode[];
  osc2Pans: StereoPannerNode[];
  osc1Detune: number[];
  osc2Detune: number[];
  noiseNode: AudioBufferSourceNode | null;
  noiseGain: GainNode;
  sampleNode: AudioBufferSourceNode | null;
  sampleGain: GainNode;
  voiceGain: GainNode;
  voiceDrive: WaveShaperNode;
  filterNode: AudioNode;
  worklet: AudioWorkletNode | null;
  fallbackA: BiquadFilterNode | null;
  fallbackB: BiquadFilterNode | null;
  lfoDisconnects: Array<{ src: AudioNode; dest: AudioNode | AudioParam }>;
  note: number;
  velocity: number;
  startTime: number;
  released: boolean;
  sustained: boolean;
  speak?: boolean;
}

const MAX_VOICES = 12;

function makeSoftClipCurve(drive: number, samples = 2048): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(new ArrayBuffer(samples * 4));
  const amount = 1 + drive * 12;
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

function makeDistortionCurve(drive: number, samples = 2048): Float32Array<ArrayBuffer> {
  const k = drive * 100;
  const curve = new Float32Array(new ArrayBuffer(samples * 4));
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

function generateReverbIR(ctx: BaseAudioContext, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const decayClamped = Math.max(decay, 0.1);
  const length = Math.max(1, Math.floor(rate * decayClamped));
  const impulse = ctx.createBuffer(2, length, rate);
  const earlyTaps = [
    [0.007, 0.45], [0.013, 0.38], [0.023, 0.32], [0.031, 0.28],
    [0.043, 0.24], [0.057, 0.2], [0.071, 0.17], [0.089, 0.14],
  ];
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const env = Math.pow(1 - i / length, decayClamped * 1.5);
      data[i] = (Math.random() * 2 - 1) * 0.6 * env;
    }
    for (const [time, amp] of earlyTaps) {
      const t = Math.floor((time + ch * 0.0013) * rate);
      if (t < length) data[t] += amp * (ch === 0 ? 1 : 0.95);
    }
    let prev = 0;
    for (let i = 0; i < length; i++) {
      prev = prev * 0.5 + data[i] * 0.5;
      data[i] = prev;
    }
  }
  return impulse;
}

function safeExpRamp(param: AudioParam, value: number, time: number) {
  const v = Math.max(value, 0.0001);
  param.exponentialRampToValueAtTime(v, time);
}

export class AudioEngine {
  ctx: AudioContext;
  masterGain: GainNode;
  masterCompressor: DynamicsCompressorNode;
  masterLimiter: DynamicsCompressorNode;
  analyserTime: AnalyserNode;
  analyserFreq: AnalyserNode;
  peakAnalyserL: AnalyserNode;
  peakAnalyserR: AnalyserNode;

  private voices: Map<number, Voice> = new Map();
  /** Pitchline / MIDI playback slots — allows repeated & overlapping same pitch. */
  private seqVoices: Map<number, Voice> = new Map();
  private params: SynthParams;
  private workletReady = false;
  private workletFailed = false;

  private reverbNode: ConvolverNode;
  private reverbGain: GainNode;
  private reverbDry: GainNode;
  private delayNode: DelayNode;
  private delayFeedback: GainNode;
  private delayGain: GainNode;
  private delayDry: GainNode;
  private delayFilter: BiquadFilterNode;
  private distortionNode: WaveShaperNode;
  private distortionGain: GainNode;
  private distortionDry: GainNode;
  private chorusDelayL: DelayNode;
  private chorusDelayR: DelayNode;
  private chorusLfoL: OscillatorNode;
  private chorusLfoR: OscillatorNode;
  private chorusLfoGainL: GainNode;
  private chorusLfoGainR: GainNode;
  private chorusMerger: ChannelMergerNode;
  private chorusSplit: ChannelSplitterNode;
  private chorusWet: GainNode;
  private chorusDry: GainNode;
  private eqLow: BiquadFilterNode;
  private eqMid: BiquadFilterNode;
  private eqHigh: BiquadFilterNode;
  private phaserStages: BiquadFilterNode[];
  private phaserLfo: OscillatorNode;
  private phaserLfoGain: GainNode;
  private phaserWet: GainNode;
  private phaserDry: GainNode;
  private widthDelay: DelayNode;
  private widthWet: GainNode;
  private widthDry: GainNode;
  private widthSplit: ChannelSplitterNode;
  private widthMerge: ChannelMergerNode;

  private lfoNode: OscillatorNode | null = null;
  private lfo2Node: OscillatorNode | null = null;
  private lfoGain: GainNode;
  private lfo2Gain: GainNode;
  private modWheelLfoGain: GainNode;
  private followerAmount: GainNode;
  private followerDrive: ConstantSourceNode;

  private preFilterBus: GainNode;
  private pitchBendSemi = 0;
  private modWheel = 0;
  private sustainPedal = false;
  private lastFreq = 440;
  private noiseBuffer: AudioBuffer;
  private sampleBuffer: AudioBuffer | null = null;
  sampleRootMidi = 60;

  constructor(params: SynthParams) {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.params = hydrateParams(params);

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.params.masterGain;

    this.masterCompressor = this.ctx.createDynamicsCompressor();
    this.masterCompressor.threshold.value = -18;
    this.masterCompressor.knee.value = 12;
    this.masterCompressor.ratio.value = 2.5;
    this.masterCompressor.attack.value = 0.003;
    this.masterCompressor.release.value = 0.12;

    this.masterLimiter = this.ctx.createDynamicsCompressor();
    this.masterLimiter.threshold.value = -1;
    this.masterLimiter.knee.value = 0;
    this.masterLimiter.ratio.value = 20;
    this.masterLimiter.attack.value = 0.001;
    this.masterLimiter.release.value = 0.05;

    this.analyserTime = this.ctx.createAnalyser();
    this.analyserTime.fftSize = 2048;
    this.analyserTime.smoothingTimeConstant = 0.8;
    this.analyserFreq = this.ctx.createAnalyser();
    this.analyserFreq.fftSize = 4096;
    this.analyserFreq.smoothingTimeConstant = 0.85;
    this.peakAnalyserL = this.ctx.createAnalyser();
    this.peakAnalyserL.fftSize = 512;
    this.peakAnalyserL.smoothingTimeConstant = 0.3;
    this.peakAnalyserR = this.ctx.createAnalyser();
    this.peakAnalyserR.fftSize = 512;
    this.peakAnalyserR.smoothingTimeConstant = 0.3;

    this.preFilterBus = this.ctx.createGain();
    this.noiseBuffer = this.buildNoiseBuffer();

    this.distortionNode = this.ctx.createWaveShaper();
    this.distortionNode.oversample = '4x';
    this.distortionNode.curve = makeDistortionCurve(this.params.effects.distortionDrive);
    this.distortionGain = this.ctx.createGain();
    this.distortionGain.gain.value = this.params.effects.distortionMix;
    this.distortionDry = this.ctx.createGain();
    this.distortionDry.gain.value = 1 - this.params.effects.distortionMix;

    this.delayNode = this.ctx.createDelay(2.0);
    this.delayNode.delayTime.value = this.params.effects.delayTime;
    this.delayFeedback = this.ctx.createGain();
    this.delayFeedback.gain.value = this.params.effects.delayFeedback;
    this.delayGain = this.ctx.createGain();
    this.delayGain.gain.value = this.params.effects.delayMix;
    this.delayDry = this.ctx.createGain();
    this.delayDry.gain.value = 1 - this.params.effects.delayMix;
    this.delayFilter = this.ctx.createBiquadFilter();
    this.delayFilter.type = 'lowpass';
    this.delayFilter.frequency.value = 4000;

    this.reverbNode = this.ctx.createConvolver();
    this.reverbNode.buffer = generateReverbIR(this.ctx, this.params.effects.reverbDecay);
    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = this.params.effects.reverbMix;
    this.reverbDry = this.ctx.createGain();
    this.reverbDry.gain.value = 1 - this.params.effects.reverbMix;

    this.chorusDelayL = this.ctx.createDelay(0.1);
    this.chorusDelayR = this.ctx.createDelay(0.1);
    this.chorusDelayL.delayTime.value = 0.015;
    this.chorusDelayR.delayTime.value = 0.018;
    this.chorusLfoL = this.ctx.createOscillator();
    this.chorusLfoL.type = 'sine';
    this.chorusLfoL.frequency.value = this.params.effects.chorusRate;
    this.chorusLfoR = this.ctx.createOscillator();
    this.chorusLfoR.type = 'sine';
    this.chorusLfoR.frequency.value = this.params.effects.chorusRate * 1.17;
    this.chorusLfoGainL = this.ctx.createGain();
    this.chorusLfoGainL.gain.value = 0.003 * this.params.effects.chorusDepth;
    this.chorusLfoGainR = this.ctx.createGain();
    this.chorusLfoGainR.gain.value = 0.003 * this.params.effects.chorusDepth;
    this.chorusLfoL.connect(this.chorusLfoGainL);
    this.chorusLfoR.connect(this.chorusLfoGainR);
    this.chorusLfoGainL.connect(this.chorusDelayL.delayTime);
    this.chorusLfoGainR.connect(this.chorusDelayR.delayTime);
    this.chorusLfoL.start();
    this.chorusLfoR.start();
    this.chorusSplit = this.ctx.createChannelSplitter(2);
    this.chorusMerger = this.ctx.createChannelMerger(2);
    this.chorusWet = this.ctx.createGain();
    this.chorusWet.gain.value = this.params.effects.chorusMix;
    this.chorusDry = this.ctx.createGain();
    this.chorusDry.gain.value = 1 - this.params.effects.chorusMix;

    this.eqLow = this.ctx.createBiquadFilter();
    this.eqLow.type = 'lowshelf';
    this.eqLow.frequency.value = 120;
    this.eqLow.gain.value = this.params.effects.eqLow ?? 0;
    this.eqMid = this.ctx.createBiquadFilter();
    this.eqMid.type = 'peaking';
    this.eqMid.frequency.value = 1000;
    this.eqMid.Q.value = 0.8;
    this.eqMid.gain.value = this.params.effects.eqMid ?? 0;
    this.eqHigh = this.ctx.createBiquadFilter();
    this.eqHigh.type = 'highshelf';
    this.eqHigh.frequency.value = 8000;
    this.eqHigh.gain.value = this.params.effects.eqHigh ?? 0;

    this.phaserStages = [0, 1, 2, 3].map((i) => {
      const ap = this.ctx.createBiquadFilter();
      ap.type = 'allpass';
      ap.frequency.value = 400 + i * 280;
      ap.Q.value = 0.5;
      return ap;
    });
    this.phaserLfo = this.ctx.createOscillator();
    this.phaserLfo.type = 'sine';
    this.phaserLfo.frequency.value = this.params.effects.phaserRate;
    this.phaserLfoGain = this.ctx.createGain();
    this.phaserLfoGain.gain.value = 700;
    this.phaserLfo.connect(this.phaserLfoGain);
    this.phaserStages.forEach((ap) => this.phaserLfoGain.connect(ap.frequency));
    this.phaserLfo.start();
    this.phaserWet = this.ctx.createGain();
    this.phaserWet.gain.value = this.params.effects.phaserMix ?? 0;
    this.phaserDry = this.ctx.createGain();
    this.phaserDry.gain.value = 1 - (this.params.effects.phaserMix ?? 0);

    this.widthDelay = this.ctx.createDelay(0.03);
    this.widthDelay.delayTime.value = 0.008 * (this.params.effects.stereoWidth ?? 0.5);
    this.widthWet = this.ctx.createGain();
    this.widthDry = this.ctx.createGain();
    this.widthSplit = this.ctx.createChannelSplitter(2);
    this.widthMerge = this.ctx.createChannelMerger(2);

    this.lfoGain = this.ctx.createGain();
    this.lfoGain.gain.value = this.params.lfo.depth;
    this.lfo2Gain = this.ctx.createGain();
    this.lfo2Gain.gain.value = this.params.lfo2.depth;
    this.modWheelLfoGain = this.ctx.createGain();
    this.modWheelLfoGain.gain.value = 0;

    this.followerAmount = this.ctx.createGain();
    this.followerAmount.gain.value = 0;
    this.followerDrive = this.ctx.createConstantSource();
    this.followerDrive.offset.value = 1;
    this.followerDrive.start();
    this.followerDrive.connect(this.followerAmount);

    this.connectGraph();
    this.startLFOs();
    void this.attachWorklet();
  }

  async attachWorklet() {
    if (this.workletReady || this.workletFailed) return;
    try {
      await this.ctx.audioWorklet.addModule(
        new URL('./worklets/nexus-filter-processor.js', import.meta.url),
      );
      this.workletReady = true;
    } catch (err) {
      console.warn('[NEXUS] filter worklet failed, using biquad fallback', err);
      this.workletFailed = true;
    }
  }

  private connectGraph() {
    this.preFilterBus.connect(this.distortionNode);
    this.distortionNode.connect(this.distortionGain);
    this.preFilterBus.connect(this.distortionDry);
    const postDistortion = this.ctx.createGain();
    this.distortionGain.connect(postDistortion);
    this.distortionDry.connect(postDistortion);

    postDistortion.connect(this.delayNode);
    this.delayNode.connect(this.delayFilter);
    this.delayFilter.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delayNode);
    this.delayFilter.connect(this.delayGain);
    postDistortion.connect(this.delayDry);
    const postDelay = this.ctx.createGain();
    this.delayGain.connect(postDelay);
    this.delayDry.connect(postDelay);

    postDelay.connect(this.reverbNode);
    this.reverbNode.connect(this.reverbGain);
    postDelay.connect(this.reverbDry);
    const postReverb = this.ctx.createGain();
    this.reverbGain.connect(postReverb);
    this.reverbDry.connect(postReverb);

    postReverb.connect(this.chorusSplit);
    this.chorusSplit.connect(this.chorusDelayL, 0);
    this.chorusSplit.connect(this.chorusDelayR, 1);
    this.chorusDelayL.connect(this.chorusMerger, 0, 0);
    this.chorusDelayR.connect(this.chorusMerger, 0, 1);
    this.chorusMerger.connect(this.chorusWet);
    postReverb.connect(this.chorusDry);
    const postChorus = this.ctx.createGain();
    this.chorusWet.connect(postChorus);
    this.chorusDry.connect(postChorus);

    postChorus.connect(this.eqLow);
    this.eqLow.connect(this.eqMid);
    this.eqMid.connect(this.eqHigh);

    this.eqHigh.connect(this.phaserStages[0]);
    this.phaserStages[0].connect(this.phaserStages[1]);
    this.phaserStages[1].connect(this.phaserStages[2]);
    this.phaserStages[2].connect(this.phaserStages[3]);
    this.phaserStages[3].connect(this.phaserWet);
    this.eqHigh.connect(this.phaserDry);
    const postPhaser = this.ctx.createGain();
    this.phaserWet.connect(postPhaser);
    this.phaserDry.connect(postPhaser);

    postPhaser.connect(this.widthSplit);
    this.widthSplit.connect(this.widthDry, 0);
    this.widthSplit.connect(this.widthDelay, 1);
    this.widthDelay.connect(this.widthWet);
    this.widthDry.connect(this.widthMerge, 0, 0);
    this.widthWet.connect(this.widthMerge, 0, 1);
    this.widthMerge.connect(this.masterGain);
    this.masterGain.connect(this.masterCompressor);
    this.masterCompressor.connect(this.masterLimiter);
    this.masterLimiter.connect(this.analyserTime);
    this.masterLimiter.connect(this.analyserFreq);
    const peakSplit = this.ctx.createChannelSplitter(2);
    this.masterLimiter.connect(peakSplit);
    peakSplit.connect(this.peakAnalyserL, 0);
    peakSplit.connect(this.peakAnalyserR, 1);
    this.analyserTime.connect(this.ctx.destination);
  }

  private startLFOs() {
    this.lfoNode = this.spawnLfo(this.params.lfo, this.lfoGain, this.lfoNode);
    this.lfo2Node = this.spawnLfo(this.params.lfo2, this.lfo2Gain, this.lfo2Node);
  }

  private spawnLfo(cfg: LFOConfig, gain: GainNode, prev: OscillatorNode | null): OscillatorNode {
    if (prev) {
      try { prev.stop(); prev.disconnect(); } catch { /* */ }
    }
    const osc = this.ctx.createOscillator();
    osc.type = cfg.waveform;
    osc.frequency.value = cfg.rate;
    osc.connect(gain);
    osc.start();
    return osc;
  }

  private buildNoiseBuffer(): AudioBuffer {
    const bufferSize = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  setPitchBend(semitones: number) {
    this.pitchBendSemi = semitones;
    const cents = semitones * 100;
    const now = this.ctx.currentTime;
    this.voices.forEach((v) => {
      v.osc1Nodes.forEach((o, i) => {
        o.detune.setTargetAtTime(this.params.osc1.detune + v.osc1Detune[i] + cents, now, 0.01);
      });
      v.osc2Nodes.forEach((o, i) => {
        o.detune.setTargetAtTime(this.params.osc2.detune + v.osc2Detune[i] + cents, now, 0.01);
      });
    });
  }

  setModWheel(value: number) {
    this.modWheel = Math.max(0, Math.min(1, value));
    this.modWheelLfoGain.gain.setTargetAtTime(this.modWheel * 50, this.ctx.currentTime, 0.02);
  }

  setFollower(amount: number) {
    const hz = Math.max(0, amount) * 6000;
    this.followerAmount.gain.setTargetAtTime(hz, this.ctx.currentTime, 0.03);
  }

  setSampleBuffer(buffer: AudioBuffer | null, rootMidi = 60) {
    this.sampleBuffer = buffer;
    this.sampleRootMidi = rootMidi;
  }

  setSustainPedal(on: boolean) {
    this.sustainPedal = on;
    if (!on) {
      this.voices.forEach((voice, note) => {
        if (voice.sustained) {
          voice.sustained = false;
          this.releaseVoice(note);
        }
      });
    }
  }

  allNotesOff() {
    this.voices.forEach((_, n) => this.noteOff(n, true));
  }

  private stealOldest() {
    let oldestKey = -1;
    let oldestTime = Infinity;
    let fromSeq = false;
    this.voices.forEach((v, key) => {
      if (v.startTime < oldestTime) {
        oldestTime = v.startTime;
        oldestKey = key;
        fromSeq = false;
      }
    });
    this.seqVoices.forEach((v, key) => {
      if (v.startTime < oldestTime) {
        oldestTime = v.startTime;
        oldestKey = key;
        fromSeq = true;
      }
    });
    if (oldestKey >= 0) {
      if (fromSeq) this.killSeqVoice(oldestKey);
      else this.killVoice(oldestKey);
    }
  }

  private createFilterForVoice(): { node: AudioNode; worklet: AudioWorkletNode | null; a: BiquadFilterNode | null; b: BiquadFilterNode | null } {
    if (this.workletReady) {
      const worklet = new AudioWorkletNode(this.ctx, 'nexus-filter-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      return { node: worklet, worklet, a: null, b: null };
    }
    const a = this.ctx.createBiquadFilter();
    const b = this.ctx.createBiquadFilter();
    a.connect(b);
    return { node: b, worklet: null, a, b };
  }

  private applyFilterParams(voice: Voice, now: number, scheduleEnv: boolean) {
    const f1 = this.params.filter;
    const f2 = this.params.filter2;
    const base1 = trackedCutoffHz(f1.frequency, f1.keytrack, voice.note);
    const base2 = trackedCutoffHz(f2.frequency, f2.keytrack, voice.note);

    if (voice.worklet) {
      const p = voice.worklet.parameters;
      const setK = (name: string, v: number) => {
        p.get(name)?.setTargetAtTime(v, now, 0.015);
      };
      setK('f1Res', f1.resonance);
      setK('f1Drive', f1.drive);
      setK('f1Model', f1.model === 'ladder' ? 1 : 0);
      setK('f1Type', FILTER_TYPE_INDEX[f1.type] ?? 0);
      setK('f1Slope', f1.slope);
      setK('f2Res', f2.resonance);
      setK('f2Drive', f2.drive);
      setK('f2Model', f2.model === 'ladder' ? 1 : 0);
      setK('f2Type', FILTER_TYPE_INDEX[f2.type] ?? 0);
      setK('f2Slope', f2.slope);
      setK('f2Mix', this.params.filterMix);
      setK('routing', this.params.filterRouting === 'parallel' ? 1 : 0);
      setK('f2On', f2.enabled ? 1 : 0);
      setK('spread', this.params.filterSpread);

      const c1 = p.get('f1Cutoff');
      const c2 = p.get('f2Cutoff');
      if (c1) {
        if (scheduleEnv) this.scheduleFilterEnv(c1, base1, f1.envAmount, now);
        else c1.setTargetAtTime(base1, now, 0.02);
      }
      if (c2) {
        if (scheduleEnv) this.scheduleFilterEnv(c2, base2, f2.envAmount, now);
        else c2.setTargetAtTime(base2, now, 0.02);
      }
      return;
    }

    if (voice.fallbackA) {
      voice.fallbackA.type = f1.type === 'peak' ? 'peaking' : f1.type;
      voice.fallbackA.Q.value = 0.5 + f1.resonance * 12;
      if (scheduleEnv) this.scheduleFilterEnv(voice.fallbackA.frequency, base1, f1.envAmount, now);
      else voice.fallbackA.frequency.setTargetAtTime(base1, now, 0.02);
    }
    if (voice.fallbackB) {
      voice.fallbackB.type = f2.type === 'peak' ? 'peaking' : f2.type;
      voice.fallbackB.Q.value = 0.5 + f2.resonance * 12;
      voice.fallbackB.frequency.setTargetAtTime(base2, now, 0.02);
    }
  }

  private scheduleFilterEnv(param: AudioParam, baseHz: number, envAmount: number, now: number) {
    const { filterEnv } = this.params;
    const peak = envPeakHz(baseHz, envAmount);
    const sustain = envPeakHz(baseHz, envAmount * filterEnv.sustain);
    param.cancelScheduledValues(now);
    param.setValueAtTime(Math.max(baseHz, 20), now);
    safeExpRamp(param, peak, now + Math.max(filterEnv.attack, 0.002));
    safeExpRamp(param, sustain, now + filterEnv.attack + Math.max(filterEnv.decay, 0.002));
  }

  private connectVoiceMod(voice: Voice) {
    const bind = (src: AudioNode, dest: AudioParam | AudioNode | undefined) => {
      if (!dest) return;
      src.connect(dest as AudioParam);
      voice.lfoDisconnects.push({ src, dest });
    };

    const cutoff1 = voice.worklet?.parameters.get('f1Cutoff') ?? voice.fallbackA?.frequency;
    const cutoff2 = voice.worklet?.parameters.get('f2Cutoff') ?? voice.fallbackB?.frequency;
    const res1 = voice.worklet?.parameters.get('f1Res');
    const res2 = voice.worklet?.parameters.get('f2Res');
    const f2mix = voice.worklet?.parameters.get('f2Mix');
    const driveP = voice.worklet?.parameters.get('f1Drive');

    const routeTarget = (target: LFOConfig['target'], gain: GainNode) => {
      if (target === 'filter') bind(gain, cutoff1);
      else if (target === 'filter2') bind(gain, cutoff2);
      else if (target === 'amp') bind(gain, voice.voiceGain.gain);
      else if (target === 'res') bind(gain, res1);
      else if (target === 'drive') bind(gain, driveP);
      else if (target === 'pitch') {
        voice.osc1Nodes.forEach((o) => bind(gain, o.detune));
        voice.osc2Nodes.forEach((o) => bind(gain, o.detune));
      }
    };

    routeTarget(this.params.lfo.target, this.lfoGain);
    routeTarget(this.params.lfo2.target, this.lfo2Gain);

    voice.osc1Nodes.forEach((o) => bind(this.modWheelLfoGain, o.detune));
    voice.osc2Nodes.forEach((o) => bind(this.modWheelLfoGain, o.detune));
    bind(this.followerAmount, cutoff1);

    for (const route of this.params.modMatrix) {
      if (!route.enabled || Math.abs(route.depth) < 0.001) continue;
      const g = this.ctx.createGain();
      g.gain.value = route.depth * (route.dest.startsWith('cutoff') ? 4000 : route.dest === 'pitch' ? 100 : 1);
      const srcNode =
        route.source === 'lfo1' ? this.lfoGain :
        route.source === 'lfo2' ? this.lfo2Gain :
        route.source === 'modWheel' ? this.modWheelLfoGain :
        route.source === 'follower' ? this.followerAmount :
        null;
      if (!srcNode) continue;
      srcNode.connect(g);
      voice.lfoDisconnects.push({ src: srcNode, dest: g });
      if (route.dest === 'cutoff1') bind(g, cutoff1);
      else if (route.dest === 'cutoff2') bind(g, cutoff2);
      else if (route.dest === 'res1') bind(g, res1);
      else if (route.dest === 'res2') bind(g, res2);
      else if (route.dest === 'amp') bind(g, voice.voiceGain.gain);
      else if (route.dest === 'drive') bind(g, driveP);
      else if (route.dest === 'f2mix') bind(g, f2mix);
      else if (route.dest === 'pitch') {
        voice.osc1Nodes.forEach((o) => bind(g, o.detune));
        voice.osc2Nodes.forEach((o) => bind(g, o.detune));
      } else if (route.dest === 'pan') {
        voice.osc1Pans.forEach((p) => bind(g, p.pan));
      }
    }
  }

  noteOn(note: number, velocity: number = 0.8, when?: number, opts?: { speak?: boolean }) {
    if (this.voices.has(note)) this.killVoice(note);
    this.spawnVoice(note, velocity, when, opts, this.voices, note);
  }

  /** Scheduled MIDI playback — unique slot per note instance. */
  seqNoteOn(slot: number, note: number, velocity: number, when?: number, opts?: { speak?: boolean }) {
    if (this.seqVoices.has(slot)) this.killSeqVoice(slot);
    this.spawnVoice(note, velocity, when, opts, this.seqVoices, slot);
  }

  seqNoteOff(slot: number, when?: number) {
    const voice = this.seqVoices.get(slot);
    if (!voice || voice.released) return;
    this.releaseVoiceFromMap(this.seqVoices, slot, when);
  }

  private spawnVoice(
    note: number,
    velocity: number,
    when: number | undefined,
    opts: { speak?: boolean } | undefined,
    map: Map<number, Voice>,
    mapKey: number,
  ) {
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (this.voices.size + this.seqVoices.size >= MAX_VOICES) this.stealOldest();

    const freq = NOTE_FREQ(note);
    const now = Math.max(this.ctx.currentTime, when ?? this.ctx.currentTime);
    const speak = !!opts?.speak;
    const { osc1, osc2 } = this.params;
    const ampEnv = speak
      ? { attack: 0.004, decay: 0.06, sustain: 0.88, release: 0.09 }
      : this.params.ampEnv;
    const glide = Math.max(0, this.params.glide);

    const voiceGain = this.ctx.createGain();
    voiceGain.gain.setValueAtTime(0.001, now);

    const voiceDrive = this.ctx.createWaveShaper();
    voiceDrive.oversample = '2x';
    voiceDrive.curve = makeSoftClipCurve(this.params.drive ?? 0.15);

    const filt = this.createFilterForVoice();

    const osc1Nodes: OscillatorNode[] = [];
    const osc1Gains: GainNode[] = [];
    const osc1Pans: StereoPannerNode[] = [];
    const osc1Detune: number[] = [];
    const osc2Nodes: OscillatorNode[] = [];
    const osc2Gains: GainNode[] = [];
    const osc2Pans: StereoPannerNode[] = [];
    const osc2Detune: number[] = [];

    const startFreq = glide > 0.005 ? Math.max(this.lastFreq, 20) : freq;

    const createUnisonOscs = (
      config: OscConfig,
      nodes: OscillatorNode[],
      gains: GainNode[],
      pans: StereoPannerNode[],
      detunes: number[],
    ) => {
      const count = Math.max(1, Math.min(7, config.unison | 0));
      const perVoiceGain = config.gain / Math.sqrt(count);
      const octaveMultiplier = Math.pow(2, config.octave);
      const semiMultiplier = Math.pow(2, config.semi / 12);
      const target = freq * octaveMultiplier * semiMultiplier;
      const from = startFreq * octaveMultiplier * semiMultiplier;

      for (let i = 0; i < count; i++) {
        const osc = this.ctx.createOscillator();
        osc.type = config.waveform;
        const detuneOffset = count > 1
          ? ((i / (count - 1)) * 2 - 1) * config.unisonSpread
          : 0;
        osc.frequency.setValueAtTime(from, now);
        if (glide > 0.005) safeExpRamp(osc.frequency, target, now + glide);
        else osc.frequency.value = target;
        osc.detune.value = config.detune + detuneOffset + this.pitchBendSemi * 100;

        const gain = this.ctx.createGain();
        gain.gain.value = perVoiceGain * velocity;
        const pan = this.ctx.createStereoPanner();
        pan.pan.value = count > 1
          ? ((i / (count - 1)) * 2 - 1) * Math.min(1, config.unisonSpread / 100)
          : 0;

        osc.connect(gain);
        gain.connect(pan);
        pan.connect(voiceDrive);
        osc.start(now);

        nodes.push(osc);
        gains.push(gain);
        pans.push(pan);
        detunes.push(detuneOffset);
      }
    };

    createUnisonOscs(osc1, osc1Nodes, osc1Gains, osc1Pans, osc1Detune);
    createUnisonOscs(osc2, osc2Nodes, osc2Gains, osc2Pans, osc2Detune);
    this.lastFreq = freq;

    let noiseNode: AudioBufferSourceNode | null = null;
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.value = this.params.noiseLevel * velocity;
    if (this.params.noiseLevel > 0.005) {
      noiseNode = this.ctx.createBufferSource();
      noiseNode.buffer = this.noiseBuffer;
      noiseNode.loop = true;
      noiseNode.connect(noiseGain);
      noiseGain.connect(voiceDrive);
      noiseNode.start(now);
    }

    let sampleNode: AudioBufferSourceNode | null = null;
    const sampleGain = this.ctx.createGain();
    sampleGain.gain.value = speak ? 0 : this.params.sampleMix * velocity;
    if (!speak && this.sampleBuffer && this.params.sampleMix > 0.005) {
      sampleNode = this.ctx.createBufferSource();
      sampleNode.buffer = this.sampleBuffer;
      sampleNode.loop = true;
      const root = NOTE_FREQ(this.sampleRootMidi);
      sampleNode.playbackRate.value = freq / root;
      sampleNode.connect(sampleGain);
      sampleGain.connect(voiceDrive);
      sampleNode.start(now);
    }

    voiceDrive.connect(filt.node);
    filt.node.connect(voiceGain);
    voiceGain.connect(this.preFilterBus);

    const atk = Math.max(ampEnv.attack, 0.002);
    voiceGain.gain.setValueAtTime(0.001, now);
    safeExpRamp(voiceGain.gain, Math.max(velocity, 0.001), now + atk);
    safeExpRamp(
      voiceGain.gain,
      Math.max(ampEnv.sustain * velocity, 0.001),
      now + ampEnv.attack + Math.max(ampEnv.decay, 0.002),
    );

    const voice: Voice = {
      osc1Nodes, osc2Nodes, osc1Gains, osc2Gains, osc1Pans, osc2Pans,
      osc1Detune, osc2Detune,
      noiseNode, noiseGain, sampleNode, sampleGain,
      voiceGain, voiceDrive,
      filterNode: filt.node,
      worklet: filt.worklet,
      fallbackA: filt.a,
      fallbackB: filt.b,
      lfoDisconnects: [],
      note, velocity, startTime: now, released: false, sustained: false, speak,
    };

    this.applyFilterParams(voice, now, true);
    this.connectVoiceMod(voice);
    map.set(mapKey, voice);
  }

  noteOff(note: number, force = false, when?: number) {
    const voice = this.voices.get(note);
    if (!voice || voice.released) return;
    if (this.sustainPedal && !force) {
      voice.sustained = true;
      return;
    }
    this.releaseVoiceFromMap(this.voices, note, when);
  }

  private releaseVoiceFromMap(map: Map<number, Voice>, key: number, when?: number) {
    const voice = map.get(key);
    if (!voice || voice.released) return;
    voice.released = true;
    const now = Math.max(this.ctx.currentTime, when ?? this.ctx.currentTime);
    const { ampEnv, filterEnv } = this.params;
    const rel = Math.max(voice.speak ? 0.09 : ampEnv.release, 0.005);
    const g = voice.voiceGain.gain;
    if (typeof g.cancelAndHoldAtTime === 'function') g.cancelAndHoldAtTime(now);
    else {
      g.cancelScheduledValues(now);
      g.setValueAtTime(Math.max(g.value, 0.001), now);
    }
    safeExpRamp(g, 0.001, now + rel);

    const f1 = trackedCutoffHz(this.params.filter.frequency, this.params.filter.keytrack, voice.note);
    const c1 = voice.worklet?.parameters.get('f1Cutoff') ?? voice.fallbackA?.frequency;
    if (c1) {
      if (typeof c1.cancelAndHoldAtTime === 'function') c1.cancelAndHoldAtTime(now);
      else {
        c1.cancelScheduledValues(now);
        c1.setValueAtTime(Math.max(c1.value, 20), now);
      }
      safeExpRamp(c1, f1, now + Math.max(voice.speak ? 0.05 : filterEnv.release, 0.005));
    }

    const wait = Math.max(0, now - this.ctx.currentTime) + Math.max(rel, filterEnv.release) + 0.12;
    const isSeq = map === this.seqVoices;
    window.setTimeout(() => {
      if (isSeq) this.killSeqVoice(key);
      else this.killVoice(key);
    }, wait * 1000);
  }

  private releaseVoice(note: number, when?: number) {
    this.releaseVoiceFromMap(this.voices, note, when);
  }

  private killVoice(note: number) {
    const voice = this.voices.get(note);
    if (!voice) return;
    this.disposeVoice(voice);
    this.voices.delete(note);
  }

  private killSeqVoice(slot: number) {
    const voice = this.seqVoices.get(slot);
    if (!voice) return;
    this.disposeVoice(voice);
    this.seqVoices.delete(slot);
  }

  private disposeVoice(voice: Voice) {
    try {
      for (const { src, dest } of voice.lfoDisconnects) {
        try { src.disconnect(dest as AudioParam); } catch { /* */ }
      }
      voice.osc1Nodes.forEach((o) => { try { o.stop(); } catch { /* */ } o.disconnect(); });
      voice.osc2Nodes.forEach((o) => { try { o.stop(); } catch { /* */ } o.disconnect(); });
      voice.osc1Gains.forEach((g) => g.disconnect());
      voice.osc2Gains.forEach((g) => g.disconnect());
      voice.osc1Pans.forEach((p) => p.disconnect());
      voice.osc2Pans.forEach((p) => p.disconnect());
      if (voice.noiseNode) { try { voice.noiseNode.stop(); } catch { /* */ } voice.noiseNode.disconnect(); }
      if (voice.sampleNode) { try { voice.sampleNode.stop(); } catch { /* */ } voice.sampleNode.disconnect(); }
      voice.noiseGain.disconnect();
      voice.sampleGain.disconnect();
      voice.voiceDrive.disconnect();
      voice.voiceGain.disconnect();
      voice.filterNode.disconnect();
      voice.worklet?.disconnect();
      voice.fallbackA?.disconnect();
      voice.fallbackB?.disconnect();
    } catch { /* */ }
  }

  updateParams(params: SynthParams) {
    const prev = this.params;
    this.params = hydrateParams(params);
    const now = this.ctx.currentTime;
    const p = this.params;

    this.masterGain.gain.linearRampToValueAtTime(p.masterGain, now + 0.02);
    this.delayNode.delayTime.linearRampToValueAtTime(p.effects.delayTime, now + 0.05);
    this.delayFeedback.gain.linearRampToValueAtTime(p.effects.delayFeedback, now + 0.02);
    this.delayGain.gain.linearRampToValueAtTime(p.effects.delayMix, now + 0.02);
    this.delayDry.gain.linearRampToValueAtTime(1 - p.effects.delayMix, now + 0.02);
    this.reverbGain.gain.linearRampToValueAtTime(p.effects.reverbMix, now + 0.02);
    this.reverbDry.gain.linearRampToValueAtTime(1 - p.effects.reverbMix, now + 0.02);
    this.distortionGain.gain.linearRampToValueAtTime(p.effects.distortionMix, now + 0.02);
    this.distortionDry.gain.linearRampToValueAtTime(1 - p.effects.distortionMix, now + 0.02);
    if (p.effects.distortionDrive !== prev.effects.distortionDrive) {
      this.distortionNode.curve = makeDistortionCurve(p.effects.distortionDrive);
    }
    this.chorusWet.gain.linearRampToValueAtTime(p.effects.chorusMix, now + 0.02);
    this.chorusDry.gain.linearRampToValueAtTime(1 - p.effects.chorusMix, now + 0.02);
    this.chorusLfoL.frequency.linearRampToValueAtTime(p.effects.chorusRate, now + 0.02);
    this.chorusLfoR.frequency.linearRampToValueAtTime(p.effects.chorusRate * 1.17, now + 0.02);
    this.chorusLfoGainL.gain.linearRampToValueAtTime(0.003 * p.effects.chorusDepth, now + 0.02);
    this.chorusLfoGainR.gain.linearRampToValueAtTime(0.003 * p.effects.chorusDepth, now + 0.02);
    this.eqLow.gain.linearRampToValueAtTime(p.effects.eqLow, now + 0.03);
    this.eqMid.gain.linearRampToValueAtTime(p.effects.eqMid, now + 0.03);
    this.eqHigh.gain.linearRampToValueAtTime(p.effects.eqHigh, now + 0.03);
    this.phaserWet.gain.linearRampToValueAtTime(p.effects.phaserMix, now + 0.02);
    this.phaserDry.gain.linearRampToValueAtTime(1 - p.effects.phaserMix, now + 0.02);
    this.phaserLfo.frequency.linearRampToValueAtTime(p.effects.phaserRate, now + 0.02);
    this.widthDelay.delayTime.linearRampToValueAtTime(0.002 + p.effects.stereoWidth * 0.012, now + 0.03);

    if (this.lfoNode) {
      this.lfoNode.frequency.linearRampToValueAtTime(p.lfo.rate, now + 0.02);
      if (this.lfoNode.type !== p.lfo.waveform) this.lfoNode.type = p.lfo.waveform;
    }
    if (this.lfo2Node) {
      this.lfo2Node.frequency.linearRampToValueAtTime(p.lfo2.rate, now + 0.02);
      if (this.lfo2Node.type !== p.lfo2.waveform) this.lfo2Node.type = p.lfo2.waveform;
    }
    this.lfoGain.gain.linearRampToValueAtTime(p.lfo.depth, now + 0.02);
    this.lfo2Gain.gain.linearRampToValueAtTime(p.lfo2.depth, now + 0.02);

    if ((p.drive ?? 0.15) !== (prev.drive ?? 0.15)) {
      const curve = makeSoftClipCurve(p.drive ?? 0.15);
      this.voices.forEach((v) => { v.voiceDrive.curve = curve; });
    }

    this.voices.forEach((v) => {
      this.applyFilterParams(v, now, false);
      v.osc1Gains.forEach((g) => {
        const count = Math.max(1, p.osc1.unison);
        g.gain.setTargetAtTime((p.osc1.gain / Math.sqrt(count)) * v.velocity, now, 0.02);
      });
      v.osc2Gains.forEach((g) => {
        const count = Math.max(1, p.osc2.unison);
        g.gain.setTargetAtTime((p.osc2.gain / Math.sqrt(count)) * v.velocity, now, 0.02);
      });
      v.noiseGain.gain.setTargetAtTime(p.noiseLevel * v.velocity, now, 0.02);
      v.sampleGain.gain.setTargetAtTime(p.sampleMix * v.velocity, now, 0.02);
      v.osc1Nodes.forEach((o) => { if (o.type !== p.osc1.waveform) o.type = p.osc1.waveform; });
      v.osc2Nodes.forEach((o) => { if (o.type !== p.osc2.waveform) o.type = p.osc2.waveform; });
    });
  }

  updateReverb(decay: number) {
    this.reverbNode.buffer = generateReverbIR(this.ctx, decay);
  }

  getTimeDomainData(): Float32Array {
    const data = new Float32Array(new ArrayBuffer(this.analyserTime.fftSize * 4));
    this.analyserTime.getFloatTimeDomainData(data);
    return data;
  }

  getFrequencyData(): Uint8Array {
    const data = new Uint8Array(this.analyserFreq.frequencyBinCount);
    this.analyserFreq.getByteFrequencyData(data);
    return data;
  }

  getPeakLevels(): { l: number; r: number } {
    const bufL = new Float32Array(new ArrayBuffer(this.peakAnalyserL.fftSize * 4));
    const bufR = new Float32Array(new ArrayBuffer(this.peakAnalyserR.fftSize * 4));
    this.peakAnalyserL.getFloatTimeDomainData(bufL);
    this.peakAnalyserR.getFloatTimeDomainData(bufR);
    let peakL = 0, peakR = 0;
    for (let i = 0; i < bufL.length; i++) {
      const l = Math.abs(bufL[i]);
      const r = Math.abs(bufR[i]);
      if (l > peakL) peakL = l;
      if (r > peakR) peakR = r;
    }
    return { l: peakL, r: peakR };
  }

  get activeVoiceCount(): number {
    return this.voices.size;
  }

  get workletActive(): boolean {
    return this.workletReady;
  }

  panic() {
    this.voices.forEach((_, note) => this.killVoice(note));
    this.seqVoices.forEach((_, slot) => this.killSeqVoice(slot));
    this.voices.clear();
    this.seqVoices.clear();
    this.sustainPedal = false;
  }

  async resume() {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    await this.attachWorklet();
  }

  dispose() {
    this.panic();
    if (this.lfoNode) { try { this.lfoNode.stop(); } catch { /* */ } }
    if (this.lfo2Node) { try { this.lfo2Node.stop(); } catch { /* */ } }
    try { this.chorusLfoL.stop(); } catch { /* */ }
    try { this.chorusLfoR.stop(); } catch { /* */ }
    try { this.phaserLfo.stop(); } catch { /* */ }
    try { this.followerDrive.stop(); } catch { /* */ }
    this.ctx.close();
  }
}
