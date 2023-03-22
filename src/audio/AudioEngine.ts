export type WaveformType = 'sine' | 'sawtooth' | 'square' | 'triangle';
export type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'notch';

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
  type: FilterType;
  frequency: number;
  resonance: number;
  envAmount: number;
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
  target: 'filter' | 'pitch' | 'amp';
}

export interface SynthParams {
  osc1: OscConfig;
  osc2: OscConfig;
  filter: FilterConfig;
  ampEnv: ADSRConfig;
  filterEnv: ADSRConfig;
  effects: EffectsConfig;
  lfo: LFOConfig;
  masterGain: number;
  glide: number;
  noiseLevel: number;
}

interface Voice {
  osc1Nodes: OscillatorNode[];
  osc2Nodes: OscillatorNode[];
  osc1Gains: GainNode[];
  osc2Gains: GainNode[];
  noiseNode: AudioBufferSourceNode | null;
  noiseGain: GainNode;
  voiceGain: GainNode;
  voiceFilter: BiquadFilterNode;
  note: number;
  velocity: number;
  startTime: number;
  released: boolean;
}

const NOTE_FREQ = (note: number) => 440 * Math.pow(2, (note - 69) / 12);

export class AudioEngine {
  ctx: AudioContext;
  masterGain: GainNode;
  analyserTime: AnalyserNode;
  analyserFreq: AnalyserNode;
  
  private voices: Map<number, Voice> = new Map();
  private params: SynthParams;
  
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
  
  private lfoNode: OscillatorNode | null = null;
  private lfoGain: GainNode;
  
  private preFilterBus: GainNode;
  private postFilterBus: GainNode;

  constructor(params: SynthParams) {
    this.ctx = new AudioContext();
    this.params = params;

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = params.masterGain;
    
    this.analyserTime = this.ctx.createAnalyser();
    this.analyserTime.fftSize = 2048;
    this.analyserTime.smoothingTimeConstant = 0.8;
    
    this.analyserFreq = this.ctx.createAnalyser();
    this.analyserFreq.fftSize = 4096;
    this.analyserFreq.smoothingTimeConstant = 0.85;

    this.preFilterBus = this.ctx.createGain();
    this.postFilterBus = this.ctx.createGain();

    // === DISTORTION ===
    this.distortionNode = this.ctx.createWaveShaper();
    this.distortionNode.oversample = '4x';
    this.updateDistortionCurve(params.effects.distortionDrive);
    this.distortionGain = this.ctx.createGain();
    this.distortionGain.gain.value = params.effects.distortionMix;
    this.distortionDry = this.ctx.createGain();
    this.distortionDry.gain.value = 1 - params.effects.distortionMix;

    // === DELAY ===
    this.delayNode = this.ctx.createDelay(2.0);
    this.delayNode.delayTime.value = params.effects.delayTime;
    this.delayFeedback = this.ctx.createGain();
    this.delayFeedback.gain.value = params.effects.delayFeedback;
    this.delayGain = this.ctx.createGain();
    this.delayGain.gain.value = params.effects.delayMix;
    this.delayDry = this.ctx.createGain();
    this.delayDry.gain.value = 1 - params.effects.delayMix;
    this.delayFilter = this.ctx.createBiquadFilter();
    this.delayFilter.type = 'lowpass';
    this.delayFilter.frequency.value = 4000;

    // === REVERB ===
    this.reverbNode = this.ctx.createConvolver();
    this.generateReverbIR(params.effects.reverbDecay);
    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = params.effects.reverbMix;
    this.reverbDry = this.ctx.createGain();
    this.reverbDry.gain.value = 1 - params.effects.reverbMix;

    // === LFO ===
    this.lfoGain = this.ctx.createGain();
    this.lfoGain.gain.value = params.lfo.depth;

    this.connectGraph();
    this.startLFO();
  }

  private connectGraph() {
    // Voice outputs → preFilterBus → distortion split → delay split → reverb split → master → analysers → destination
    
    // Distortion: parallel dry/wet
    this.preFilterBus.connect(this.distortionNode);
    this.distortionNode.connect(this.distortionGain);
    this.preFilterBus.connect(this.distortionDry);

    const postDistortion = this.ctx.createGain();
    this.distortionGain.connect(postDistortion);
    this.distortionDry.connect(postDistortion);

    // Delay: parallel dry/wet with feedback loop
    postDistortion.connect(this.delayNode);
    this.delayNode.connect(this.delayFilter);
    this.delayFilter.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delayNode);
    this.delayFilter.connect(this.delayGain);
    postDistortion.connect(this.delayDry);

    const postDelay = this.ctx.createGain();
    this.delayGain.connect(postDelay);
    this.delayDry.connect(postDelay);

    // Reverb: parallel dry/wet
    postDelay.connect(this.reverbNode);
    this.reverbNode.connect(this.reverbGain);
    postDelay.connect(this.reverbDry);

    this.reverbGain.connect(this.masterGain);
    this.reverbDry.connect(this.masterGain);

    this.masterGain.connect(this.analyserTime);
    this.masterGain.connect(this.analyserFreq);
    this.analyserTime.connect(this.ctx.destination);
  }

  private startLFO() {
    if (this.lfoNode) {
      this.lfoNode.stop();
      this.lfoNode.disconnect();
    }
    this.lfoNode = this.ctx.createOscillator();
    this.lfoNode.type = this.params.lfo.waveform;
    this.lfoNode.frequency.value = this.params.lfo.rate;
    this.lfoNode.connect(this.lfoGain);
    this.lfoNode.start();
  }

  private generateReverbIR(decay: number) {
    const rate = this.ctx.sampleRate;
    const length = rate * Math.max(decay, 0.1);
    const impulse = this.ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay * 1.5);
      }
    }
    this.reverbNode.buffer = impulse;
  }

  private updateDistortionCurve(drive: number) {
    const k = drive * 100;
    const samples = 44100;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
    }
    this.distortionNode.curve = curve;
  }

  private createNoiseBuffer(): AudioBuffer {
    const bufferSize = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  noteOn(note: number, velocity: number = 0.8) {
    if (this.ctx.state === 'suspended') this.ctx.resume();
    
    // Kill existing voice on same note
    if (this.voices.has(note)) {
      this.killVoice(note);
    }

    const freq = NOTE_FREQ(note);
    const now = this.ctx.currentTime;
    const { osc1, osc2, filter, ampEnv, filterEnv } = this.params;

    // Voice gain (amp envelope target)
    const voiceGain = this.ctx.createGain();
    voiceGain.gain.setValueAtTime(0.001, now);

    // Voice filter
    const voiceFilter = this.ctx.createBiquadFilter();
    voiceFilter.type = filter.type;
    voiceFilter.Q.value = filter.resonance;
    voiceFilter.frequency.setValueAtTime(Math.max(filter.frequency, 20), now);

    // Create oscillators with unison
    const osc1Nodes: OscillatorNode[] = [];
    const osc1Gains: GainNode[] = [];
    const osc2Nodes: OscillatorNode[] = [];
    const osc2Gains: GainNode[] = [];

    const createUnisonOscs = (
      config: OscConfig,
      baseFreq: number,
      nodes: OscillatorNode[],
      gains: GainNode[]
    ) => {
      const count = Math.max(1, config.unison);
      const perVoiceGain = config.gain / Math.sqrt(count);
      
      for (let i = 0; i < count; i++) {
        const osc = this.ctx.createOscillator();
        osc.type = config.waveform;
        
        const detuneOffset = count > 1
          ? ((i / (count - 1)) * 2 - 1) * config.unisonSpread
          : 0;
        
        const octaveMultiplier = Math.pow(2, config.octave);
        const semiMultiplier = Math.pow(2, config.semi / 12);
        osc.frequency.value = baseFreq * octaveMultiplier * semiMultiplier;
        osc.detune.value = config.detune + detuneOffset;

        const gain = this.ctx.createGain();
        gain.gain.value = perVoiceGain * velocity;

        osc.connect(gain);
        gain.connect(voiceFilter);
        osc.start(now);

        nodes.push(osc);
        gains.push(gain);

        // Connect LFO to pitch if target is pitch
        if (this.params.lfo.target === 'pitch') {
          this.lfoGain.connect(osc.detune);
        }
      }
    };

    createUnisonOscs(osc1, freq, osc1Nodes, osc1Gains);
    createUnisonOscs(osc2, freq, osc2Nodes, osc2Gains);

    // Noise
    let noiseNode: AudioBufferSourceNode | null = null;
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.value = this.params.noiseLevel * velocity;
    if (this.params.noiseLevel > 0.01) {
      noiseNode = this.ctx.createBufferSource();
      noiseNode.buffer = this.createNoiseBuffer();
      noiseNode.loop = true;
      noiseNode.connect(noiseGain);
      noiseGain.connect(voiceFilter);
      noiseNode.start(now);
    }

    // Connect filter → voiceGain → bus
    voiceFilter.connect(voiceGain);
    voiceGain.connect(this.preFilterBus);

    // LFO → filter if target
    if (this.params.lfo.target === 'filter') {
      this.lfoGain.connect(voiceFilter.frequency);
    }
    if (this.params.lfo.target === 'amp') {
      this.lfoGain.connect(voiceGain.gain);
    }

    // Amp envelope
    voiceGain.gain.setValueAtTime(0.001, now);
    voiceGain.gain.exponentialRampToValueAtTime(
      velocity, now + Math.max(ampEnv.attack, 0.002)
    );
    voiceGain.gain.exponentialRampToValueAtTime(
      Math.max(ampEnv.sustain * velocity, 0.001),
      now + ampEnv.attack + Math.max(ampEnv.decay, 0.002)
    );

    // Filter envelope
    const filterBase = Math.max(filter.frequency, 20);
    const filterPeak = Math.min(filterBase + filter.envAmount * 8000, 20000);
    voiceFilter.frequency.setValueAtTime(filterBase, now);
    voiceFilter.frequency.exponentialRampToValueAtTime(
      filterPeak, now + Math.max(filterEnv.attack, 0.002)
    );
    voiceFilter.frequency.exponentialRampToValueAtTime(
      Math.max(filterBase + (filterPeak - filterBase) * filterEnv.sustain, 20),
      now + filterEnv.attack + Math.max(filterEnv.decay, 0.002)
    );

    this.voices.set(note, {
      osc1Nodes, osc2Nodes, osc1Gains, osc2Gains,
      noiseNode, noiseGain, voiceGain, voiceFilter,
      note, velocity, startTime: now, released: false,
    });
  }

  noteOff(note: number) {
    const voice = this.voices.get(note);
    if (!voice || voice.released) return;

    voice.released = true;
    const now = this.ctx.currentTime;
    const { ampEnv, filterEnv, filter } = this.params;

    // Amp release
    voice.voiceGain.gain.cancelScheduledValues(now);
    voice.voiceGain.gain.setValueAtTime(Math.max(voice.voiceGain.gain.value, 0.001), now);
    voice.voiceGain.gain.exponentialRampToValueAtTime(0.001, now + Math.max(ampEnv.release, 0.005));

    // Filter release
    voice.voiceFilter.frequency.cancelScheduledValues(now);
    voice.voiceFilter.frequency.setValueAtTime(
      Math.max(voice.voiceFilter.frequency.value, 20), now
    );
    voice.voiceFilter.frequency.exponentialRampToValueAtTime(
      Math.max(filter.frequency, 20), now + Math.max(filterEnv.release, 0.005)
    );

    // Cleanup after release
    const cleanupTime = (Math.max(ampEnv.release, filterEnv.release) + 0.1) * 1000;
    setTimeout(() => {
      this.killVoice(note);
    }, cleanupTime);
  }

  private killVoice(note: number) {
    const voice = this.voices.get(note);
    if (!voice) return;

    try {
      voice.osc1Nodes.forEach(o => { o.stop(); o.disconnect(); });
      voice.osc2Nodes.forEach(o => { o.stop(); o.disconnect(); });
      voice.osc1Gains.forEach(g => g.disconnect());
      voice.osc2Gains.forEach(g => g.disconnect());
      if (voice.noiseNode) { voice.noiseNode.stop(); voice.noiseNode.disconnect(); }
      voice.noiseGain.disconnect();
      voice.voiceGain.disconnect();
      voice.voiceFilter.disconnect();
    } catch (e) {
      // Node already stopped/disconnected
    }

    this.voices.delete(note);
  }

  updateParams(params: SynthParams) {
    this.params = params;
    this.masterGain.gain.linearRampToValueAtTime(params.masterGain, this.ctx.currentTime + 0.02);

    // Effects
    this.delayNode.delayTime.linearRampToValueAtTime(params.effects.delayTime, this.ctx.currentTime + 0.05);
    this.delayFeedback.gain.linearRampToValueAtTime(params.effects.delayFeedback, this.ctx.currentTime + 0.02);
    this.delayGain.gain.linearRampToValueAtTime(params.effects.delayMix, this.ctx.currentTime + 0.02);
    this.delayDry.gain.linearRampToValueAtTime(1 - params.effects.delayMix, this.ctx.currentTime + 0.02);

    this.reverbGain.gain.linearRampToValueAtTime(params.effects.reverbMix, this.ctx.currentTime + 0.02);
    this.reverbDry.gain.linearRampToValueAtTime(1 - params.effects.reverbMix, this.ctx.currentTime + 0.02);

    this.distortionGain.gain.linearRampToValueAtTime(params.effects.distortionMix, this.ctx.currentTime + 0.02);
    this.distortionDry.gain.linearRampToValueAtTime(1 - params.effects.distortionMix, this.ctx.currentTime + 0.02);
    this.updateDistortionCurve(params.effects.distortionDrive);

    // LFO
    if (this.lfoNode) {
      this.lfoNode.frequency.linearRampToValueAtTime(params.lfo.rate, this.ctx.currentTime + 0.02);
      if (this.lfoNode.type !== params.lfo.waveform) {
        this.lfoNode.type = params.lfo.waveform;
      }
    }
    this.lfoGain.gain.linearRampToValueAtTime(params.lfo.depth, this.ctx.currentTime + 0.02);
  }

  updateReverb(decay: number) {
    this.generateReverbIR(decay);
  }

  getTimeDomainData(): Float32Array {
    const data = new Float32Array(this.analyserTime.fftSize);
    this.analyserTime.getFloatTimeDomainData(data);
    return data;
  }

  getFrequencyData(): Uint8Array {
    const data = new Uint8Array(this.analyserFreq.frequencyBinCount);
    this.analyserFreq.getByteFrequencyData(data);
    return data;
  }

  get activeVoiceCount(): number {
    return this.voices.size;
  }

  panic() {
    this.voices.forEach((_, note) => this.killVoice(note));
    this.voices.clear();
  }

  async resume() {
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  dispose() {
    this.panic();
    if (this.lfoNode) this.lfoNode.stop();
    this.ctx.close();
  }
}
