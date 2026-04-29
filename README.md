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
- **Chorus** — stereo dual-delay modulation, dedicated L/R LFOs for wide motion
- **Reverb** — algorithmic IR convolution with early reflections + diffused tail
- **Delay** — stereo with tempo-adjustable time, feedback, and high-cut filtering
- **Distortion** — 4× oversampled waveshaper with drive + wet/dry mix
- **Analog-style Drive** per-voice soft-clip saturation before the filter

### Master Bus
- **Compressor** — gentle 2.5:1 glue (threshold –18 dB, soft knee)
- **Brick-wall Limiter** — transparent safety at –1 dB ceiling
- **Stereo Peak VU Meter** — 1.2 s peak hold, gradient green → red

### 🎹 MIDI (Web MIDI API)
- **Works with any MIDI device** — USB controllers, IAC Driver, virtual ports
- **Live device picker** — switch inputs without restart
- **Full message set** — Note On/Off, Velocity, **Pitch Bend** (±2 st), **Mod Wheel** (CC1 → vibrato), **Sustain Pedal** (CC64), All-Notes-Off (CC123)
- **Activity LED** — visual confirmation of incoming MIDI

### UI Features
- **Real-time Oscilloscope + 64-band Spectrum Analyzer**
- **SVG Rotary Knobs** — drag, shift-fine, double-click reset
- **Piano Keyboard** — 2+ octaves, velocity-sensitive, computer-key mapping
- **16-Step Sequencer** — chromatic grid with play/stop, BPM, swing, randomize
- **Categorised Preset Browser** — grouped grid with colour-coded categories
- **18 Factory Presets** — Lead · Bass · Pad · Pluck · Keys · FX (Trance Supersaw, Wobble Bass, Dubstep Growl, Ambient Drone, FM Bell, Phaser Pluck, Vintage Brass, Future Pluck, Hypersaw Lead, Deep Sub, Ethereal Pad, Crystal Pluck, Reese, Acid, Warm Keys, Noise Riser, Cyber Arp, Init)
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
[OSC1 + unison + stereo spread] ─┐
                                 ├─→ [Drive] ─→ [Multimode Filter] ─→ [Amp Env] ─┐
[OSC2 + unison + stereo spread] ─┤                     ▲                          │
                                 │                     │                          │
[Noise]─────────────────────────┘            [Filter Env + LFO]                  │
                                                                                  ▼
[Distortion] → [Delay + feedback] → [Reverb + ER] → [Chorus (stereo LR)] → [Compressor] → [Limiter] → Master
                                                                                  ▲
                                                                         [MIDI: pitch bend, mod wheel vibrato, sustain]
```

## 🏗️ Architecture

```
nexus-synth/
├── render.yaml                # One-click Render static deploy config
├── src/
│   ├── App.tsx                # Main UI + state + host message API
│   ├── audio/
│   │   ├── AudioEngine.ts     # Voice allocator, FX chain, master bus, MIDI-reactive
│   │   ├── MidiEngine.ts      # Web MIDI wrapper (note / bend / mod / sustain)
│   │   └── presets.ts         # 18 factory presets
│   ├── components/
│   │   ├── Knob.tsx           # SVG rotary with shift-fine + reset
│   │   ├── Keyboard.tsx       # Velocity-sensitive piano
│   │   ├── Visualizer.tsx     # Oscilloscope + FFT spectrum
│   │   ├── PeakMeter.tsx      # Stereo VU with 1.2s peak hold
│   │   ├── PresetBrowser.tsx  # Categorised preset grid
│   │   ├── MidiIndicator.tsx  # Device picker + activity LED + PB/MOD readout
│   │   └── Sequencer.tsx      # 16-step chromatic sequencer
│   ├── lib/
│   │   ├── analytics.ts       # Multi-provider analytics (Plausible/Umami/...)
│   │   └── embed.ts           # ?embed=1 + postMessage host API
│   └── index.css              # Tailwind + theme tokens
└── ...
```

## 🌐 Deploy to Render (one-click static site)

The repo ships a ready-to-deploy [`render.yaml`](render.yaml) — create a new **Static Site** service on [render.com](https://render.com), point it at this repo, and it'll auto-detect the config:

- **Build:** `npm install && npm run build`
- **Publish:** `./dist`
- **SPA rewrite** (`/* → /index.html`)
- Long-lived cache headers on hashed assets
- `Permissions-Policy: midi=*` header so **Web MIDI works on the deployed URL**

No Node process, no sleeping services, no cold starts.

## � Daily User Activity Tracking

Analytics is opt-in per provider via environment variables — set any of these in your Render dashboard and redeploy:

| Env var | Provider | Signup |
|---|---|---|
| `VITE_PLAUSIBLE_DOMAIN` | [Plausible](https://plausible.io) | paid, privacy-first |
| `VITE_UMAMI_WEBSITE_ID` + `VITE_UMAMI_SRC` | [Umami Cloud](https://umami.is) | free tier |
| `VITE_GOATCOUNTER_SITE` | [GoatCounter](https://goatcounter.com) | **free for non-commercial** |
| `VITE_CF_BEACON_TOKEN` | [Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/) | **free** |
| `VITE_GA4_ID` | Google Analytics 4 | free |

### Zero-config daily counter (always on)

Out of the box — with **no setup** — Nexus pings [`abacus.jasoncameron.dev`](https://abacus.jasoncameron.dev) (an anonymous public counter, no PII, no cookies) once per browser session with today's date as the bucket. Check your daily numbers without signing up for anything:

```bash
# Today's unique sessions
curl https://abacus.jasoncameron.dev/get/nexus-synth/day-$(date +%F)

# Lifetime sessions
curl https://abacus.jasoncameron.dev/get/nexus-synth/total
```

Set `VITE_COUNTER_NAMESPACE=your-name` if you want a unique bucket for your deployment, or `VITE_DISABLE_PUBLIC_COUNTER=1` to disable it.

### Custom events tracked

- `app_loaded` (w/ embedded flag)
- `audio_started` (sample rate)
- `preset_loaded` (preset name, category)
- `midi_enabled` (device count)

All events forward to whichever provider(s) you've configured.

## 🧩 Embed Anywhere

### Iframe embed

```html
<iframe
  src="https://nexus-synth.onrender.com/?embed=1&preset=10"
  width="1200"
  height="560"
  allow="midi; autoplay"
  style="border: 0; border-radius: 12px;"
></iframe>
```

Query params:
- `?embed=1` — compact layout (hides tab bar, keeps all controls)
- `?preset=<index>` — auto-load preset by index on boot

### postMessage API

Control the synth from the host page:

```js
const iframe = document.querySelector('iframe').contentWindow;

iframe.postMessage({ type: 'nexus:noteOn',  note: 60, velocity: 0.9 }, '*');
iframe.postMessage({ type: 'nexus:noteOff', note: 60 },               '*');
iframe.postMessage({ type: 'nexus:loadPreset', index: 10 },           '*');
iframe.postMessage({ type: 'nexus:panic' },                           '*');
iframe.postMessage({
  type: 'nexus:setParam', section: 'filter', key: 'frequency', value: 2000,
}, '*');
```

Listen for events from the synth:

```js
window.addEventListener('message', (e) => {
  if (!e.data?.type?.startsWith('nexus:')) return;
  console.log(e.data);
  // { type: 'nexus:ready', version: '1.1.0' }
  // { type: 'nexus:noteOn', note: 60, velocity: 0.9, source: 'midi' }
  // { type: 'nexus:presetLoaded', index: 10, name: 'Trance Supersaw' }
});
```

## ��️ Roadmap

- [ ] Wavetable oscillators (load custom WAV banks)
- [ ] Modulation matrix (any source → any destination)
- [x] ~~MIDI input via Web MIDI API~~ ✅ v1.1.0
- [x] ~~Master compressor + limiter~~ ✅ v1.1.0
- [x] ~~Chorus effect~~ ✅ v1.1.0
- [x] ~~Stereo peak VU meter~~ ✅ v1.1.0
- [x] ~~Embed mode + postMessage API~~ ✅ v1.1.0
- [ ] Preset save/load to `localStorage` + JSON export
- [ ] Per-voice unison detune in cents (currently spread)
- [ ] Audio Worklet voices for sample-accurate timing

## 📜 License

MIT — see [LICENSE](LICENSE).
