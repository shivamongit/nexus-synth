# NEXUS production-grade plan

This is the engineering plan after a full-repo audit of v1.1.0. Use with `docs/AGENT_PROMPT_PRODUCTION.md`.

## Current state (facts)

| Claim in README | Code reality |
|---|---|
| Band-limited oscillators via PeriodicWave | `OscillatorNode.type = sawtooth/square/triangle/sine` — aliased |
| 8+ voice polyphony with oldest-note stealing | Unlimited `Map` of voices, no steal |
| Multimode production filter | One `BiquadFilterNode` (12 dB/oct RBJ) |
| Glide | Field exists on `SynthParams`, never read |
| Chorus depth | Param exists, no UI knob |
| Live synthesis | `updateParams()` does not touch held-voice filters/oscs |

Core files: `src/audio/AudioEngine.ts` (god class), `src/App.tsx` (all UI state), `src/audio/MidiEngine.ts`, `src/audio/presets.ts`.

## DSP target (filters)

Do **not** cascade BiquadFilterNodes and call it analog.

Implement in an **AudioWorklet** voice processor:

1. **TPT / Cytomic SVF** (Zavalishin topology-preserving transform)
   - Simultaneous LP, HP, BP, notch (and peak) outputs
   - Mix/morph between modes
   - Cascade two stages for 12 dB vs 24 dB
   - Soft saturator in the integrator / feedback path
   - Coefficient update every sample or every block with cutoff smoothing

2. **ZDF 4-pole Moog ladder** (Huovilainen / corrected Zavalishin feedback)
   - 24 dB lowpass, self-oscillation at high resonance
   - `tanh` (or similar) nonlinearities per pole
   - Drive control = input gain into the ladder

3. **Shared musical controls**
   - Cutoff Hz (20–20k), log taper in UI
   - Resonance 0–1 mapped to stable analog-style Q / k
   - Key tracking 0–100%
   - Filter envelope amount **bipolar, in octaves** (not Hz add)
   - Optional stereo cutoff offset (cents)

References: Zavalishin *The Art of VA Filter Design*; Wishnick DAFx-14; Cytomic SVF; SST `sst-filters`.

WASM (Rust/C++ SST) is **P1.5 / P2** only if the JS worklet fails the CPU budget.

## Architecture

```
React UI  →  AudioEngine (main)  →  AudioWorklet (voices: osc, filter, env, LFO)
                 ↓
            native FX: delay, chorus, convolver→FDN later, compressor, limiter, analysers
```

Voice allocation stays on the main thread (note on/off, steal). AudioParams / `MessagePort` / `AudioParam` map for cutoff, Q, drive so automation is block-accurate.

## Phases

### P0 — Correctness (do first, still on native nodes if needed)

- Live-update cutoff, Q, type, drive, osc gains on active voices
- Disconnect LFO from `AudioParam`s in `killVoice`
- Polyphony cap + oldest-note steal
- Pitch bend preserves unison detune offsets
- Filter env in octaves; never `exponentialRamp` through 0
- Implement `glide` (portamento on frequency)
- Chorus depth knob; remove or hide unused claims in README
- Tests: frequency mapping, steal, envelope duration

### P1 — Production filters (AudioWorklet)

- Scaffold `src/audio/worklets/voice-processor.ts` (Vite `?worker` / `registerProcessor`)
- polyBLEP saw/square/pulse + sine + triangle (triangle can wait)
- TPT SVF + ladder models + slope + keytrack + bipolar env
- Self-tests: magnitude response vs analytic; NaN/stability sweep
- Filter response mini-plot in UI

### P2 — Modulation and oscillators

- Pulse width; optional wavetable (`PeriodicWave` or loaded bank)
- Per-voice LFO, retrigger, tempo sync
- 8-slot mod matrix
- Velocity to filter; aftertouch
- Sequencer: `currentTime` scheduler, not `setInterval`; actually use swing

### P3 — Product

- User presets + JSON import/export
- DC blocker; FDN reverb; oversampled saturator
- CPU meter; Vitest + Playwright
- Embed: check `event.origin`
- Docs that match the binary

## Non-goals

- Tone.js / vanilla-js wrappers over the existing graph
- Full Serum wavetable editor in v1
- Rewriting UI in a new framework
- Claiming Vital/Serum parity until P1 acceptance tests pass

## Success criteria

- Held notes respond to filter knobs within one render quantum
- 24 dB LP measures ~−24 dB one octave above cutoff (sine probe)
- Self-oscillation without NaNs at 44.1k and 48k
- 8 voices × 5 unison + 24 dB ladder + current FX < ~40% of one core on a mid laptop
- README only lists implemented features
