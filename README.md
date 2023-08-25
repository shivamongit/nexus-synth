<div align="center">

# 🎛️ NEXUS

### Spectral Synthesizer for the Web — built with the Web Audio API.

[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)](https://vitejs.dev)
[![Web Audio](https://img.shields.io/badge/Web%20Audio-API-F38020)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-CSS-38B2AC?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A production-grade browser-based polysynth designed to rival desktop plugins like **Vital** and **Serum** in visual design and sonic quality. Dual oscillators, unison spread, multimode filter, dual envelopes, LFO, three insert effects, 16-step sequencer, real-time scope + spectrum analyzer.

**Zero dependencies for audio · Pure Web Audio API · 60fps visualizations.**

</div>

---

## ✨ Features

### Synthesis Engine
- **Dual Oscillators** with sine, sawtooth, square, and triangle waveforms
- **Unison Engine** — up to 7 voices per oscillator with adjustable spread
- **Octave & Semitone** tuning per oscillator
- **Noise Generator** — white noise layer with level control
- **8+ voice polyphony** with oldest-note stealing

### Modulation
- **Amp Envelope** — full ADSR with exponential curves
- **Filter Envelope** — independent ADSR routed to filter cutoff
- **LFO** — sine/saw/square/triangle with targets: filter, pitch, amplitude

### Filter
- **Multimode**: Lowpass, Highpass, Bandpass, Notch
- **Resonance** control (0–20)
- **Envelope Amount** for dynamic sweeps

### Effects
- **Reverb** — convolution-based with adjustable decay
- **Delay** — stereo with tempo-adjustable time, feedback, and high-cut filtering
- **Distortion** — waveshaper with drive and wet/dry mix

### UI Features
- **Real-time Oscilloscope** — Canvas-based waveform display
- **Spectrum Analyzer** — 64-band FFT visualization
- **SVG Rotary Knobs** — drag to adjust, shift for fine control, double-click to reset
- **Piano Keyboard** — 2+ octaves, velocity-sensitive, computer keyboard mapping (A-L = notes, Z/X = octave)
- **16-Step Sequencer** — chromatic grid with play/stop, BPM, swing, randomize, clear
- **10 Factory Presets** — Hypersaw Lead, Deep Sub Bass, Ethereal Pad, Crystal Pluck, Reese Bass, Acid Squelch, Warm Keys, Noise Riser FX, Cyber Arp
- **Panic Button** — kill all voices instantly

## ⌨️ Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `A S D F G H J K L ;` | White keys (C → E) |
| `W E T Y U O P` | Black keys |
| `Z` / `X` | Octave down / up |
| `Space` | Panic — kill all voices |

## 🚀 Quick Start

```bash
npm install
npm run dev       # → http://localhost:5173
npm run build     # → dist/
npm run preview   # serve production build locally
```

Click **START AUDIO** to initialize the Web Audio context (browser autoplay policy requires a user gesture).

## 🛠️ Tech Stack

- **[React 18](https://react.dev)** + **[TypeScript 5](https://www.typescriptlang.org/)**
- **[Vite 6](https://vitejs.dev)** — sub-100ms HMR
- **[Tailwind CSS](https://tailwindcss.com)** — styling
- **[Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)** — every voice, filter, envelope, LFO, and effect (no Tone.js, no third-party DSP)
- **Canvas 2D** — real-time scope + 64-band FFT spectrum at 60fps

## 🎚️ Signal Flow

```
[OSC1 + unison] ─┐
                 ├─→ [Mixer] ─→ [Multimode Filter] ─→ [Amp Envelope] ─→ [Distortion] ─→ [Delay] ─→ [Reverb] ─→ Master
[OSC2 + unison] ─┤                    ▲
                 │                    │
[Noise]─────────┘            [Filter Envelope]
                                      ▲
                                    [LFO]
```

## 🏗️ Architecture

```
nexus-synth/
├── src/
│   ├── App.tsx                # Main UI + state
│   ├── audio/
│   │   ├── SynthEngine.ts     # Voice allocator, AudioContext, polyphony
│   │   └── Voice.ts           # Per-note: 2× OSC + noise + filter + envelopes
│   ├── components/
│   │   ├── Knob.tsx           # SVG rotary, drag/shift/double-click reset
│   │   ├── Keyboard.tsx       # Velocity-sensitive piano + computer-key map
│   │   ├── Scope.tsx          # Canvas oscilloscope
│   │   └── Spectrum.tsx       # 64-band FFT visualizer
│   └── index.css              # Tailwind + theme tokens
└── ...
```

## 🎛️ Presets

10 factory presets ship in-app — click through them to learn the engine:

`Hypersaw Lead` · `Deep Sub Bass` · `Ethereal Pad` · `Crystal Pluck` · `Reese Bass` · `Acid Squelch` · `Warm Keys` · `Noise Riser FX` · `Cyber Arp` · `Init`

## 🗺️ Roadmap

- [ ] Wavetable oscillators (load custom WAV banks)
- [ ] Modulation matrix (any source → any destination)
- [ ] MIDI input via Web MIDI API
- [ ] Preset save/load to `localStorage` + JSON export
- [ ] Per-voice unison detune in cents (currently spread)

## 📜 License

MIT — see [LICENSE](LICENSE).
