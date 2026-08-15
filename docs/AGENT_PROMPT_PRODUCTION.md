# Agent prompt — NEXUS production-grade synth + filters

Copy everything below the line into a new Cursor agent chat (Agent mode) with this repo open. Do not implement Tone.js. Do not rewrite the UI framework.

---

You are upgrading **nexus-synth** (Vite + React 18 + TypeScript + Web Audio) from a demo-quality subtractive synth into a production-grade instrument. Read `docs/PRODUCTION_GRADE_PLAN.md` and the existing engine before writing code.

## Product intent

NEXUS should feel like a small Vital/Serum-class **subtractive** synth in the browser: fat unison, a **musical analog-style filter** that you can play with while notes are held, tight envelopes, MIDI, and a clean master bus. Visual design can stay. Honesty matters: do not add README claims you did not implement.

## Hard constraints

- Keep React + Vite + TypeScript. Keep MIT license.
- Audio: Web Audio API. New DSP goes in **AudioWorklet** (TypeScript compiled to a worklet). Native `BiquadFilterNode` is not the production VCF.
- Do **not** add Tone.js, Magenta, or a C++/Rust WASM toolchain in the first pass. JS AudioWorklet first. WASM only if CPU budget fails after a real measurement.
- Do **not** fake a ladder by chaining 4 `BiquadFilterNode`s.
- Do **not** use `setInterval` for musical timing in new code; use `AudioContext.currentTime`.
- Bind any future HTTP server to `0.0.0.0:$PORT` if you add one (Render). This app is a static site — keep it that way unless asked.
- Filesystem is ephemeral on Render; presets must use `localStorage` / download JSON, not server disk.
- Match existing code style. No drive-by refactors, no new markdown unless asked, no commit unless asked.

## What is wrong today (must understand)

`src/audio/AudioEngine.ts`:

- Filter = one `BiquadFilterNode` (12 dB, unstable high Q, no keytrack, env amount in Hz).
- `updateParams()` does not apply cutoff/Q/type/osc/unison to **active** voices.
- Comment claims PeriodicWave; oscillators use naive `OscillatorNode` types (aliasing).
- No polyphony cap / steal. LFO `connect()` to `AudioParam`s is never disconnected → leaks.
- `glide` unused. Pitch bend overwrites unison detune. Voice stop uses `setTimeout`.
- Filter envelope uses `exponentialRampToValueAtTime` (unsafe at 0).
- Global LFO, mixed units on depth.

`src/App.tsx`: JSON `deepClone` every knob; chorus depth has no control; filter UI has no model/slope/keytrack.

`src/components/Sequencer.tsx`: `setInterval` clock; swing state unused for timing.

## Implementation order (mandatory)

### Phase 0 — make the current synth honest and playable

1. Live-parameter application for all held voices (filter, drive, osc gains at minimum).
2. Disconnect all LFO connections in `killVoice`.
3. Max voices (default 12) + oldest-note stealing.
4. Pitch bend = unisonOffset + osc.detune + bendCents.
5. Implement portamento using `glide` (seconds) on oscillator frequencies.
6. Filter envelope amount in **octaves**, bipolar later in P1; never ramp through 0.
7. Expose chorus depth in the UI.
8. Vitest: note frequency helper, steal policy, envelope time > 0.
9. Fix README so it matches behavior after this phase.

Ship P0 as a coherent diff before P1 unless the user says to continue.

### Phase 1 — production filters (the main goal)

Create `src/audio/worklets/voice-processor.ts` (or split osc/filter if clearer) registered as an AudioWorklet.

**Oscillators (minimum viable anti-alias):** polyBLEP saw and square/pulse, plus sine. Unison: N detuned voices, stereo pan, 1/√N gain.

**Filter models (both required):**

A. **TPT / Cytomic-style SVF** (Zavalishin TPT)
   - Outputs: lowpass, highpass, bandpass, notch; mix/morph
   - Slope: 12 dB (one SVF) and 24 dB (cascade)
   - Soft nonlinearity in the loop (tanh) driven by `filter.drive`
   - Stable under sample-accurate cutoff modulation

B. **ZDF 4-pole Moog ladder**
   - Huovilainen-style saturating poles + correct ZDF feedback solve
   - Self-oscillates musically at high resonance
   - Primary mode: 24 dB lowpass (HP/BP taps optional)

**Shared filter params** (extend `FilterConfig`, presets, UI):

- `model: 'svf' | 'ladder'`
- `type` / `morph` for SVF
- `slope: 12 | 24`
- `frequency` (Hz)
- `resonance` (0–1 mapped internally; do not expose raw Q=20)
- `drive`
- `keytrack` (0–1)
- `envAmount` (bipolar, octaves)
- optional `spread` (stereo cutoff cents)

Cutoff formula per sample:

`cutoff = baseHz * 2^(keytrack * (note-60)/12) * 2^(envOctaves) * 2^(lfoOctaves)`

Clamp with tan(π f / fs) warping; protect Nyquist.

**Tests (non-negotiable):**

- No NaN for a grid of cutoff × resonance × sampleRate (44100, 48000).
- Sine-probe: 24 dB LP attenuation about one octave above cutoff ≈ −24 dB ± 3 dB (away from resonance).
- Fast sweep 20 Hz→20 kHz in 20 ms does not explode.
- Held notes respond to cutoff within one render quantum.

**UI:** model, slope, keytrack, drive, bipolar env; small magnitude-response sketch (canvas) of the current filter.

Keep insert FX (delay, chorus, dist, reverb) on the main graph for P1 unless they block routing.

### Phase 2 — only after P1 tests pass

- Pulse width; wavetable slot via PeriodicWave or loaded bank
- Per-voice LFO + retrigger + optional tempo sync
- Mod matrix (at least 8 routes: env1/env2/lfo/vel/modwheel/pressure → cutoff/reso/pitch/amp/pan/drive)
- Sequencer on audio clock; implement swing
- Velocity → filter

### Phase 3 — product

- User presets in localStorage + JSON export/import
- DC blocker; replace noise-IR reverb with a small FDN when touching reverb
- Oversample saturator (2×)
- Embed `postMessage` origin allowlist
- CPU/voice meter
- Docs = features that exist

## Engineering rules

- Parameter changes must be lock-free in the worklet (atomics or AudioParams). No allocating in `process()`.
- Precompute wavetables / BLEP residuals in constructor.
- Voice steal must send a fast release, not a click.
- Presets must remain valid: migrate old `FilterConfig` (type/frequency/resonance/envAmount) to new fields with defaults.
- Add `chorusDepth` knob if missing; wire `glide`.
- Keep MIDI: notes, velocity, pitch bend, CC1, sustain, panic.

## Done when

A reviewer can hold a hypersaw chord, sweep a **24 dB ladder** and **SVF** without zipper or blow-ups, hear self-oscillation, keytrack, and envelope in octaves; knobs work on live notes; tests pass; README does not lie.

Start by reading `AudioEngine.ts`, `App.tsx`, `presets.ts`, and `docs/PRODUCTION_GRADE_PLAN.md`. Then implement Phase 0. Ask before skipping to Phase 1 if P0 is incomplete.
