// NEXUS Spectral Synthesizer — Audio Engine
// Pure Web Audio API. Production-grade: band-limited oscillators via PeriodicWave,
// per-voice stereo unison spread, analog-style drive, multimode filter, dual ADSRs,
// LFO, chorus, delay, distortion, convolution reverb, master compressor.

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
  /** Analog-style per-voice drive before the filter — 0-1 */
  drive?: number;
}

interface Voice {
  osc1Nodes: OscillatorNode[];
  osc2Nodes: OscillatorNode[];
  osc1Gains: GainNode[];
  osc2Gains: GainNode[];
  osc1Pans: StereoPannerNode[];
  osc2Pans: StereoPannerNode[];
  noiseNode: AudioBufferSourceNode | null;
  noiseGain: GainNode;
  voiceGain: GainNode;
  voiceFilter: BiquadFilterNode;
  voiceDrive: WaveShaperNode;
  lfoPitchConnections: AudioParam[];
  note: number;
  velocity: number;
  startTime: number;
  released: boolean;
  sustained: boolean;
}

const NOTE_FREQ = (note: number) => 440 * Math.pow(2, (note - 69) / 12);

// ─────────────────────────────────────────────────────────────────────
// Drive curves — reusable WaveShaper tables
// ─────────────────────────────────────────────────────────────────────
function makeSoftClipCurve(drive: number, samples = 2048): Float32Array<ArrayBuffer> {
  // Tanh-style soft clipper with drive scaling — musical analog-style saturation
  const curve = new Float32Array(new ArrayBuffer(samples * 4));
  const amount = 1 + drive * 12; // 1..13
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

function makeDistortionCurve(drive: number, samples = 44100): Float32Array<ArrayBuffer> {
  // Existing aggressive distortion — kept for the insert effect
  const k = drive * 100;
  const curve = new Float32Array(new ArrayBuffer(samples * 4));
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

// ─────────────────────────────────────────────────────────────────────
// Reverb — algorithmic IR with early reflections + diffused tail
// ─────────────────────────────────────────────────────────────────────
function generateReverbIR(ctx: BaseAudioContext, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const decayClamped = Math.max(decay, 0.1);
  const length = Math.max(1, Math.floor(rate * decayClamped));
  const impulse = ctx.createBuffer(2, length, rate);

  // Early reflection taps (time in sec, amplitude) — natural small-room pattern
  const earlyTaps = [
    [0.007, 0.45], [0.013, 0.38], [0.023, 0.32], [0.031, 0.28],
    [0.043, 0.24], [0.057, 0.2],  [0.071, 0.17], [0.089, 0.14],
  ];

  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    // Diffused noise tail with exponential decay
    for (let i = 0; i < length; i++) {
      const t = i / rate;
      const env = Math.pow(1 - i / length, decayClamped * 1.5);
      // Modulated noise for smoother tail
      const noise = (Math.random() * 2 - 1) * 0.6;
      data[i] = noise * env;
    }
    // Stamp in early reflections (pre-delay varies slightly L vs R for width)
    for (const [time, amp] of earlyTaps) {
      const t = Math.floor((time + ch * 0.0013) * rate);
      if (t < length) data[t] += amp * (ch === 0 ? 1 : 0.95);
    }
    // Soft low-pass smoothing to darken the tail
    let prev = 0;
    for (let i = 0; i < length; i++) {
      prev = prev * 0.5 + data[i] * 0.5;
      data[i] = prev;
    }
  }
  return impulse;
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
  private params: SynthParams;

  // FX chain
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

  // Chorus — dual-delay modulated by LFOs for stereo motion
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

  // LFO
  private lfoNode: OscillatorNode | null = null;
  private lfoGain: GainNode;

  // Buses
  private preFilterBus: GainNode;

  // MIDI-controlled realtime params
  private pitchBendSemi = 0;   // -2..+2 semitones
  private modWheel = 0;        // 0..1 (drives LFO depth scaling + vibrato)
  private sustainPedal = false;
  private modWheelLfoGain: GainNode; // additional LFO send on pitch when mod wheel up

  private noiseBuffer: AudioBuffer;

  constructor(params: SynthParams) {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.params = params;

    // Master chain: voices → preFilter → distortion → delay → reverb → chorus → compressor → limiter → destination
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = params.masterGain;

    // Master compressor — gentle glue
    this.masterCompressor = this.ctx.createDynamicsCompressor();
    this.masterCompressor.threshold.value = -18;
    this.masterCompressor.knee.value = 12;
    this.masterCompressor.ratio.value = 2.5;
    this.masterCompressor.attack.value = 0.003;
    this.masterCompressor.release.value = 0.12;

    // Master limiter — brick-wall at -0.3dB
    this.masterLimiter = this.ctx.createDynamicsCompressor();
    this.masterLimiter.threshold.value = -1;
    this.masterLimiter.knee.value = 0;
    this.masterLimiter.ratio.value = 20;
    this.masterLimiter.attack.value = 0.001;
    this.masterLimiter.release.value = 0.05;

    // Analysers
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

    // Cached noise buffer
    this.noiseBuffer = this.buildNoiseBuffer();

    // DISTORTION
    this.distortionNode = this.ctx.createWaveShaper();
    this.distortionNode.oversample = '4x';
    this.distortionNode.curve = makeDistortionCurve(params.effects.distortionDrive);
    this.distortionGain = this.ctx.createGain();
    this.distortionGain.gain.value = params.effects.distortionMix;
    this.distortionDry = this.ctx.createGain();
    this.distortionDry.gain.value = 1 - params.effects.distortionMix;

    // DELAY
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

    // REVERB
    this.reverbNode = this.ctx.createConvolver();
    this.reverbNode.buffer = generateReverbIR(this.ctx, params.effects.reverbDecay);
    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = params.effects.reverbMix;
    this.reverbDry = this.ctx.createGain();
    this.reverbDry.gain.value = 1 - params.effects.reverbMix;

    // CHORUS (stereo dual-delay)
    this.chorusDelayL = this.ctx.createDelay(0.1);
    this.chorusDelayR = this.ctx.createDelay(0.1);
    this.chorusDelayL.delayTime.value = 0.015;
    this.chorusDelayR.delayTime.value = 0.018;

    this.chorusLfoL = this.ctx.createOscillator();
    this.chorusLfoL.type = 'sine';
    this.chorusLfoL.frequency.value = params.effects.chorusRate;
    this.chorusLfoR = this.ctx.createOscillator();
    this.chorusLfoR.type = 'sine';
    this.chorusLfoR.frequency.value = params.effects.chorusRate * 1.17;

    this.chorusLfoGainL = this.ctx.createGain();
    this.chorusLfoGainL.gain.value = 0.003 * params.effects.chorusDepth;
    this.chorusLfoGainR = this.ctx.createGain();
    this.chorusLfoGainR.gain.value = 0.003 * params.effects.chorusDepth;

    this.chorusLfoL.connect(this.chorusLfoGainL);
    this.chorusLfoR.connect(this.chorusLfoGainR);
    this.chorusLfoGainL.connect(this.chorusDelayL.delayTime);
    this.chorusLfoGainR.connect(this.chorusDelayR.delayTime);
    this.chorusLfoL.start();
    this.chorusLfoR.start();

    this.chorusSplit = this.ctx.createChannelSplitter(2);
    this.chorusMerger = this.ctx.createChannelMerger(2);
    this.chorusWet = this.ctx.createGain();
    this.chorusWet.gain.value = params.effects.chorusMix;
    this.chorusDry = this.ctx.createGain();
    this.chorusDry.gain.value = 1 - params.effects.chorusMix;

    // LFO
    this.lfoGain = this.ctx.createGain();
    this.lfoGain.gain.value = params.lfo.depth;

    this.modWheelLfoGain = this.ctx.createGain();
    this.modWheelLfoGain.gain.value = 0;

    this.connectGraph();
    this.startLFO();
  }

  private connectGraph() {
    // Voice output → preFilterBus → distortion → delay → reverb → chorus → compressor → limiter → master → destination

    // Distortion (parallel)
    this.preFilterBus.connect(this.distortionNode);
    this.distortionNode.connect(this.distortionGain);
    this.preFilterBus.connect(this.distortionDry);
    const postDistortion = this.ctx.createGain();
    this.distortionGain.connect(postDistortion);
    this.distortionDry.connect(postDistortion);

    // Delay (parallel with feedback)
    postDistortion.connect(this.delayNode);
    this.delayNode.connect(this.delayFilter);
    this.delayFilter.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delayNode);
    this.delayFilter.connect(this.delayGain);
    postDistortion.connect(this.delayDry);
    const postDelay = this.ctx.createGain();
    this.delayGain.connect(postDelay);
    this.delayDry.connect(postDelay);

    // Reverb (parallel)
    postDelay.connect(this.reverbNode);
    this.reverbNode.connect(this.reverbGain);
    postDelay.connect(this.reverbDry);
    const postReverb = this.ctx.createGain();
    this.reverbGain.connect(postReverb);
    this.reverbDry.connect(postReverb);

    // Chorus (parallel stereo)
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

    // Master chain
    postChorus.connect(this.masterGain);
    this.masterGain.connect(this.masterCompressor);
    this.masterCompressor.connect(this.masterLimiter);
    this.masterLimiter.connect(this.analyserTime);
    this.masterLimiter.connect(this.analyserFreq);

    // Peak meters (stereo split)
    const peakSplit = this.ctx.createChannelSplitter(2);
    this.masterLimiter.connect(peakSplit);
    peakSplit.connect(this.peakAnalyserL, 0);
    peakSplit.connect(this.peakAnalyserR, 1);

    this.analyserTime.connect(this.ctx.destination);
  }

  private startLFO() {
    if (this.lfoNode) {
      try { this.lfoNode.stop(); this.lfoNode.disconnect(); } catch {}
    }
    this.lfoNode = this.ctx.createOscillator();
    this.lfoNode.type = this.params.lfo.waveform;
    this.lfoNode.frequency.value = this.params.lfo.rate;
    this.lfoNode.connect(this.lfoGain);
    this.lfoNode.connect(this.modWheelLfoGain);
    this.lfoNode.start();
  }

  private buildNoiseBuffer(): AudioBuffer {
    const bufferSize = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  // ─────────────────────────────────────────────
  // MIDI-style realtime controls
  // ─────────────────────────────────────────────

  /** Pitch bend in semitones (-2..+2 typical). Applies to all active voices. */
  setPitchBend(semitones: number) {
    this.pitchBendSemi = semitones;
    const cents = semitones * 100;
    const now = this.ctx.currentTime;
    this.voices.forEach(v => {
      v.osc1Nodes.forEach((o, i) => {
        const baseDetune = this.params.osc1.detune + (v.osc1Gains[i] ? 0 : 0);
        o.detune.setTargetAtTime(baseDetune + cents, now, 0.01);
      });
      v.osc2Nodes.forEach((o, i) => {
        const baseDetune = this.params.osc2.detune;
        o.detune.setTargetAtTime(baseDetune + cents, now, 0.01);
      });
    });
  }

  /** Mod wheel 0..1 — adds vibrato via LFO → pitch regardless of LFO target. */
  setModWheel(value: number) {
    this.modWheel = Math.max(0, Math.min(1, value));
    // Vibrato depth in cents (0..50)
    this.modWheelLfoGain.gain.setTargetAtTime(this.modWheel * 50, this.ctx.currentTime, 0.02);
  }

  /** Sustain pedal (CC64). When released, release all sustained voices. */
  setSustainPedal(on: boolean) {
    this.sustainPedal = on;
    if (!on) {
      // Release voices that were waiting for pedal
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

  // ─────────────────────────────────────────────
  // Note lifecycle
  // ─────────────────────────────────────────────

  noteOn(note: number, velocity: number = 0.8) {
    if (this.ctx.state === 'suspended') this.ctx.resume();

    if (this.voices.has(note)) {
      this.killVoice(note);
    }

    const freq = NOTE_FREQ(note);
    const now = this.ctx.currentTime;
    const { osc1, osc2, filter, ampEnv, filterEnv } = this.params;

    // Voice gain
    const voiceGain = this.ctx.createGain();
    voiceGain.gain.setValueAtTime(0.001, now);

    // Voice filter
    const voiceFilter = this.ctx.createBiquadFilter();
    voiceFilter.type = filter.type;
    voiceFilter.Q.value = filter.resonance;
    voiceFilter.frequency.setValueAtTime(Math.max(filter.frequency, 20), now);

    // Per-voice soft drive before filter (analog warmth)
    const voiceDrive = this.ctx.createWaveShaper();
    voiceDrive.oversample = '2x';
    voiceDrive.curve = makeSoftClipCurve(this.params.drive ?? 0.15);

    const osc1Nodes: OscillatorNode[] = [];
    const osc1Gains: GainNode[] = [];
    const osc1Pans: StereoPannerNode[] = [];
    const osc2Nodes: OscillatorNode[] = [];
    const osc2Gains: GainNode[] = [];
    const osc2Pans: StereoPannerNode[] = [];
    const lfoPitchConnections: AudioParam[] = [];

    const createUnisonOscs = (
      config: OscConfig,
      baseFreq: number,
      nodes: OscillatorNode[],
      gains: GainNode[],
      pans: StereoPannerNode[]
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
        osc.detune.value = config.detune + detuneOffset + this.pitchBendSemi * 100;

        const gain = this.ctx.createGain();
        gain.gain.value = perVoiceGain * velocity;

        // Stereo spread for unison — spread across [-1, +1]
        const pan = this.ctx.createStereoPanner();
        pan.pan.value = count > 1
          ? ((i / (count - 1)) * 2 - 1) * Math.min(1, config.unisonSpread / 100)
          : 0;

        osc.connect(gain);
        gain.connect(pan);
        pan.connect(voiceDrive);
        osc.start(now);

        // LFO → pitch (target) + mod wheel vibrato (always)
        if (this.params.lfo.target === 'pitch') {
          this.lfoGain.connect(osc.detune);
          lfoPitchConnections.push(osc.detune);
        }
        this.modWheelLfoGain.connect(osc.detune);

        nodes.push(osc);
        gains.push(gain);
        pans.push(pan);
      }
    };

    createUnisonOscs(osc1, freq, osc1Nodes, osc1Gains, osc1Pans);
    createUnisonOscs(osc2, freq, osc2Nodes, osc2Gains, osc2Pans);

    // Noise source
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

    // Drive → filter → voiceGain → bus
    voiceDrive.connect(voiceFilter);
    voiceFilter.connect(voiceGain);
    voiceGain.connect(this.preFilterBus);

    // LFO → filter / amp
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
      osc1Nodes, osc2Nodes, osc1Gains, osc2Gains, osc1Pans, osc2Pans,
      noiseNode, noiseGain, voiceGain, voiceFilter, voiceDrive,
      lfoPitchConnections,
      note, velocity, startTime: now, released: false, sustained: false,
    });
  }

  noteOff(note: number, force = false) {
    const voice = this.voices.get(note);
    if (!voice || voice.released) return;

    // If sustain pedal is down (and not forced), mark as sustained and hold
    if (this.sustainPedal && !force) {
      voice.sustained = true;
      return;
    }

    this.releaseVoice(note);
  }

  private releaseVoice(note: number) {
    const voice = this.voices.get(note);
    if (!voice || voice.released) return;

    voice.released = true;
    const now = this.ctx.currentTime;
    const { ampEnv, filterEnv, filter } = this.params;

    voice.voiceGain.gain.cancelScheduledValues(now);
    voice.voiceGain.gain.setValueAtTime(Math.max(voice.voiceGain.gain.value, 0.001), now);
    voice.voiceGain.gain.exponentialRampToValueAtTime(0.001, now + Math.max(ampEnv.release, 0.005));

    voice.voiceFilter.frequency.cancelScheduledValues(now);
    voice.voiceFilter.frequency.setValueAtTime(Math.max(voice.voiceFilter.frequency.value, 20), now);
    voice.voiceFilter.frequency.exponentialRampToValueAtTime(
      Math.max(filter.frequency, 20), now + Math.max(filterEnv.release, 0.005)
    );

    const cleanupTime = (Math.max(ampEnv.release, filterEnv.release) + 0.1) * 1000;
    setTimeout(() => this.killVoice(note), cleanupTime);
  }

  private killVoice(note: number) {
    const voice = this.voices.get(note);
    if (!voice) return;

    try {
      voice.osc1Nodes.forEach(o => { try { o.stop(); } catch {}; o.disconnect(); });
      voice.osc2Nodes.forEach(o => { try { o.stop(); } catch {}; o.disconnect(); });
      voice.osc1Gains.forEach(g => g.disconnect());
      voice.osc2Gains.forEach(g => g.disconnect());
      voice.osc1Pans.forEach(p => p.disconnect());
      voice.osc2Pans.forEach(p => p.disconnect());
      if (voice.noiseNode) { try { voice.noiseNode.stop(); } catch {}; voice.noiseNode.disconnect(); }
      voice.noiseGain.disconnect();
      voice.voiceDrive.disconnect();
      voice.voiceGain.disconnect();
      voice.voiceFilter.disconnect();
    } catch {}

    this.voices.delete(note);
  }

  // ─────────────────────────────────────────────
  // Param updates
  // ─────────────────────────────────────────────

  updateParams(params: SynthParams) {
    const prev = this.params;
    this.params = params;
    const now = this.ctx.currentTime;

    this.masterGain.gain.linearRampToValueAtTime(params.masterGain, now + 0.02);

    // Delay
    this.delayNode.delayTime.linearRampToValueAtTime(params.effects.delayTime, now + 0.05);
    this.delayFeedback.gain.linearRampToValueAtTime(params.effects.delayFeedback, now + 0.02);
    this.delayGain.gain.linearRampToValueAtTime(params.effects.delayMix, now + 0.02);
    this.delayDry.gain.linearRampToValueAtTime(1 - params.effects.delayMix, now + 0.02);

    // Reverb mix
    this.reverbGain.gain.linearRampToValueAtTime(params.effects.reverbMix, now + 0.02);
    this.reverbDry.gain.linearRampToValueAtTime(1 - params.effects.reverbMix, now + 0.02);

    // Distortion
    this.distortionGain.gain.linearRampToValueAtTime(params.effects.distortionMix, now + 0.02);
    this.distortionDry.gain.linearRampToValueAtTime(1 - params.effects.distortionMix, now + 0.02);
    if (params.effects.distortionDrive !== prev.effects.distortionDrive) {
      this.distortionNode.curve = makeDistortionCurve(params.effects.distortionDrive);
    }

    // Chorus
    this.chorusWet.gain.linearRampToValueAtTime(params.effects.chorusMix, now + 0.02);
    this.chorusDry.gain.linearRampToValueAtTime(1 - params.effects.chorusMix, now + 0.02);
    this.chorusLfoL.frequency.linearRampToValueAtTime(params.effects.chorusRate, now + 0.02);
    this.chorusLfoR.frequency.linearRampToValueAtTime(params.effects.chorusRate * 1.17, now + 0.02);
    this.chorusLfoGainL.gain.linearRampToValueAtTime(0.003 * params.effects.chorusDepth, now + 0.02);
    this.chorusLfoGainR.gain.linearRampToValueAtTime(0.003 * params.effects.chorusDepth, now + 0.02);

    // LFO
    if (this.lfoNode) {
      this.lfoNode.frequency.linearRampToValueAtTime(params.lfo.rate, now + 0.02);
      if (this.lfoNode.type !== params.lfo.waveform) {
        this.lfoNode.type = params.lfo.waveform;
      }
    }
    this.lfoGain.gain.linearRampToValueAtTime(params.lfo.depth, now + 0.02);

    // Drive curve
    if ((params.drive ?? 0.15) !== (prev.drive ?? 0.15)) {
      // Update live voices' drive curves
      const curve = makeSoftClipCurve(params.drive ?? 0.15);
      this.voices.forEach(v => { v.voiceDrive.curve = curve; });
    }
  }

  updateReverb(decay: number) {
    this.reverbNode.buffer = generateReverbIR(this.ctx, decay);
  }

  // ─────────────────────────────────────────────
  // Visualisation
  // ─────────────────────────────────────────────

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

  panic() {
    this.voices.forEach((_, note) => this.killVoice(note));
    this.voices.clear();
    this.sustainPedal = false;
  }

  async resume() {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  dispose() {
    this.panic();
    if (this.lfoNode) { try { this.lfoNode.stop(); } catch {} }
    try { this.chorusLfoL.stop(); } catch {}
    try { this.chorusLfoR.stop(); } catch {}
    this.ctx.close();
  }
}
