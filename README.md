<div align="center">

# NEXUS

**Browser-based music workstation — audio transcription, stem analysis, spectral synthesis, and sequencing.**

[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)](https://vitejs.dev)
[![Web Audio](https://img.shields.io/badge/Web%20Audio-API-F38020)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[Live demo](https://nexus-synth.onrender.com) · [Repository](https://github.com/shivamongit/nexus-synth)

</div>

---

## Overview

NEXUS is a full-stack-in-the-browser music production environment. It combines **neural audio-to-MIDI transcription**, optional **four-stem source separation**, a **dual-oscillator subtractive synthesizer** with zero-Delay-feedback (ZDF) filtering, and a **16-step chromatic sequencer** — all driven by the Web Audio API, Web MIDI API, and TensorFlow.js.

The application is designed for musicians, producers, and developers who want to capture ideas quickly: hum a melody, upload a recording, split a mix into stems, trace each part to MIDI, audition it on curated synth patches, and export results — without installing a DAW.

---

## Capabilities

### Audio → MIDI

Convert microphone input or uploaded audio files into editable MIDI note data.

| Feature | Description |
|--------|-------------|
| **Live capture** | Record from the device microphone with level metering and optional auto-stop |
| **File import** | Drag-and-drop or file picker; supports WAV, MP3, OGG, FLAC, M4A, AAC, WebM, AIFF |
| **Polyphonic & monophonic modes** | Uploaded files use full polyphonic transcription; live voice uses monophonic optimization |
| **Piano roll** | Visual note editor with playhead and waveform preview |
| **Scale tools** | Chromatic, major, minor, and pentatonic snap; optional grid quantization |
| **Playback** | Audition original audio or synthesized MIDI through the built-in engine |
| **Export** | Download standard MIDI files; send patterns to the step sequencer |
| **Sensitivity controls** | Adjustable onset and frame thresholds for note detection tuning |

Runs **entirely in the browser** after the neural model is loaded — no server required.

---

### Track Rack

Import a full song and receive four isolated stems (vocals, drums, bass, other), each with its own MIDI trace, synth patch assignment, and transport controls.

| Feature | Description |
|--------|-------------|
| **Stem separation** | Four-stem demixing via Demucs (`htdemucs` / `htdemucs_ft`) |
| **Fast & Quality modes** | Trade speed for separation fidelity; vocals always re-isolated with a high-quality pass |
| **Parallel MIDI tracing** | All stems transcribed concurrently after separation |
| **Per-stem playback** | Independent audio and MIDI play/stop per lane |
| **Mute / solo / patch** | Mix stems and load matched factory presets per lane |
| **Progress pipeline** | Step-by-step import status with cancel support |
| **Export** | Combined or per-stem MIDI export |

**Requires a local or self-hosted Demucs worker** (see [Track Rack setup](#track-rack-setup-optional)). This is **not included** in the default Render static deployment.

---

### Spectral Synthesizer

A performance-oriented subtractive synth comparable in scope to modern web and desktop instruments.

| Module | Details |
|--------|---------|
| **Oscillators** | Dual oscillators — sine, saw, square, triangle; octave/semitone/detune; up to 7-voice unison with stereo spread |
| **Filters** | Dual multimode filters (lowpass, highpass, bandpass, notch, peak); 12/24 dB slopes; SVF or ladder models; serial/parallel routing; key tracking |
| **Envelopes** | Independent ADSR for amplitude and filter cutoff |
| **LFOs** | Two LFOs with routable targets (filter, pitch, amplitude, drive, resonance) |
| **Mod matrix** | Four assignable routes (LFO1, LFO2, mod wheel, envelope follower → cutoff, resonance, pitch, amp, drive) |
| **Effects** | Reverb, stereo delay, chorus, phaser, 3-band EQ, distortion, stereo width |
| **Master** | Compressor, brick-wall limiter, stereo peak meter |
| **Voices** | 12-voice polyphony with oldest-note stealing |
| **Presets** | 19 factory patches across Lead, Bass, Pad, Pluck, Keys, FX, and Init categories |

Real-time **oscilloscope** and **64-band FFT spectrum** analyzer included.

---

### Step Sequencer

- 16 steps × 16 chromatic rows (C3 base)
- Adjustable BPM, swing, and transport
- Pattern randomize; accepts patterns from Audio → MIDI
- Drives the synth engine with sample-accurate scheduling

---

### MIDI & Integration

- **Web MIDI API** — USB controllers, virtual ports, pitch bend (±2 semitones), mod wheel, sustain
- **Embed mode** — `?embed=1` for iframe integration
- **postMessage API** — remote note, preset, and parameter control from a host page
- **Analytics** — optional Plausible, Umami, GoatCounter, Cloudflare, or GA4 (env-configured)

---

## Algorithms & Signal Processing

NEXUS composes established research models with custom DSP pipelines. Below is a concise technical reference.

### Audio → MIDI transcription

| Stage | Method |
|-------|--------|
| **Neural transcription** | Basic Pitch — lightweight CNN-based onset + pitch estimation, executed in TensorFlow.js (WebGL with CPU fallback) at 22.05 kHz |
| **Monophonic fallback** | McLeod Pitch Method (MPM) with autocorrelation peak picking and adaptive note segmentation |
| **Note post-processing** | Gap merging, overlap resolution, short-note rejection, vocal range clamping, quality scoring for neural vs. contour selection |
| **Audio conditioning** | High-pass filtering, peak normalization, optional leading/trailing silence trim with time-offset preservation |
| **MIDI export** | Standard Type-0 MIDI file generation with velocity and timing |

For **uploaded files**, polyphonic neural output is used directly. For **live microphone** input, monophonic cleanup is applied and the higher-scoring result (neural or contour) is selected automatically.

### Track Rack pipeline

```
Upload → Decode → Demucs separation → Per-stem DSP prep → MIDI trace → Preset match → Playback
```

| Stage | Method |
|-------|--------|
| **Source separation** | [Demucs](https://github.com/facebookresearch/demucs) hybrid Transformer demixing (`htdemucs` fast path; `htdemucs_ft` quality path; dedicated fine-tuned pass for vocals) |
| **Stem conditioning** | Per-stem band-limiting (bass low-pass, drums high-pass, other band-pass) and peak normalization before tracing |
| **Harmonic stems** | Basic Pitch with stem-specific frequency bounds and mono/poly post-processing |
| **Drums** | Spectral-flux onset detection; hit classification by band energy ratio into kick, snare, and hi-hat (General MIDI map) |
| **Preset matching** | Heuristic scoring using stem category, spectral centroid, average MIDI pitch, and filter/noise characteristics |
| **Separation API** | Async job queue with polling; supports cancellation; stereo enforcement for mono uploads |

### Synthesizer DSP

| Component | Implementation |
|-----------|----------------|
| **Filter** | ZDF state-variable and ladder models in an AudioWorklet; biquad fallback when worklet unavailable |
| **Drive** | Tanh soft-clip waveshaping per voice |
| **Distortion** | Polynomial waveshaper with oversampling |
| **Reverb** | Procedural impulse response — early reflections + exponentially decaying diffuse tail |
| **Chorus / delay / phaser** | Native Web Audio nodes with stereo routing |
| **Compression / limiting** | Dynamics processing on the master bus |

---

## Requirements

### Browser (all features except Track Rack separation)

| Requirement | Notes |
|-------------|-------|
| **Modern browser** | Chrome, Edge, Firefox, or Safari (recent versions) |
| **Web Audio API** | Required |
| **WebGL** | Recommended for neural model inference (CPU fallback available) |
| **User gesture** | Required once to unlock audio playback (browser autoplay policy) |
| **Microphone** | Optional; needed for live recording in Audio → MIDI |

### Frontend development

| Tool | Version |
|------|---------|
| Node.js | 18+ recommended |
| npm | 9+ |

### Track Rack (optional — stem separation)

| Tool | Version |
|------|---------|
| Python | 3.10+ |
| PyTorch | 2.0+ (CUDA, Apple MPS, or CPU) |
| Demucs | 4.0+ |
| Disk space | ~2 GB for model weights on first run |
| RAM | 8 GB minimum; 16 GB recommended for longer tracks |

**Song length limit:** 6 minutes per import (configurable in `stemSeparate.ts` and `workers/demucs-api/main.py`).

---

## Quick Start

### Frontend only (Audio → MIDI, Synth, Sequencer)

```bash
git clone https://github.com/shivamongit/nexus-synth.git
cd nexus-synth
npm install
npm run dev        # → http://localhost:5173
```

Click **Enter studio** to initialize the audio context, then open the **Audio → MIDI** tab.

```bash
npm run build      # production build → dist/
npm run preview    # serve dist/ locally
```

### Track Rack setup (optional)

Stem separation runs as a separate Python service.

**Terminal 1 — Demucs API**

```bash
cd workers/demucs-api
pip install -r requirements.txt
cd ../..
npm run stem-api   # listens on http://localhost:8765
```

**Terminal 2 — Frontend**

Create `.env` in the project root:

```env
VITE_STEM_API_URL=http://localhost:8765
```

```bash
npm run dev
```

Open the **Track Rack** tab and import a song. The first separation run downloads Demucs model weights and may take several minutes on CPU.

---

## Environment Variables

Copy [`.env.example`](.env.example) to `.env` for local development.

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_STEM_API_URL` | No | URL of the Demucs worker (e.g. `http://localhost:8765`). Omit on static deploy if Track Rack separation is not needed. |
| `VITE_PLAUSIBLE_DOMAIN` | No | Plausible analytics domain |
| `VITE_UMAMI_WEBSITE_ID` | No | Umami website ID |
| `VITE_UMAMI_SRC` | No | Umami script URL |
| `VITE_GOATCOUNTER_SITE` | No | GoatCounter site code |
| `VITE_CF_BEACON_TOKEN` | No | Cloudflare Web Analytics token |
| `VITE_GA4_ID` | No | Google Analytics 4 measurement ID |
| `VITE_COUNTER_NAMESPACE` | No | Public session counter namespace override |
| `VITE_DISABLE_PUBLIC_COUNTER` | No | Set to `1` to disable the built-in anonymous session counter |

---

## Deploy to Render

The included [`render.yaml`](render.yaml) configures a **static site** deployment:

- **Build:** `npm install && npm run build`
- **Publish:** `./dist`
- **SPA routing:** all paths rewrite to `index.html`
- **Headers:** long-lived cache on hashed assets; `Permissions-Policy: midi=*` for Web MIDI

### What works on Render

| Module | Cloud-ready |
|--------|-------------|
| Audio → MIDI | Yes — full in-browser transcription |
| Synthesizer & Sequencer | Yes |
| Track Rack (separation) | No — requires a separate compute service running Demucs |

To enable Track Rack in production, deploy `workers/demucs-api` as an independent web service (CPU instances are slow; GPU instances are faster but costly), then set `VITE_STEM_API_URL` to that service URL at build time.

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `A S D F G H J K L ;` | White keys |
| `W E T Y U O P` | Black keys |
| `Z` / `X` | Octave down / up |
| `Space` | Panic — all notes off |

---

## Embed & Host API

### Iframe

```html
<iframe
  src="https://nexus-synth.onrender.com/?embed=1&preset=10"
  width="1200"
  height="560"
  allow="midi; autoplay"
  style="border: 0; border-radius: 12px;"
></iframe>
```

| Query param | Effect |
|-------------|--------|
| `embed=1` | Compact layout |
| `preset=<index>` | Load factory preset on boot |

### postMessage

```js
const win = document.querySelector('iframe').contentWindow;

win.postMessage({ type: 'nexus:noteOn',  note: 60, velocity: 0.9 }, '*');
win.postMessage({ type: 'nexus:noteOff', note: 60 }, '*');
win.postMessage({ type: 'nexus:loadPreset', index: 10 }, '*');
win.postMessage({ type: 'nexus:panic' }, '*');
win.postMessage({ type: 'nexus:setParam', section: 'filter', key: 'frequency', value: 2000 }, '*');

window.addEventListener('message', (e) => {
  if (!e.data?.type?.startsWith('nexus:')) return;
  console.log(e.data);
  // { type: 'nexus:ready', version: '1.3.0' }
  // { type: 'nexus:noteOn', note: 60, velocity: 0.9, source: 'midi' }
});
```

---

## Project Structure

```
nexus-synth/
├── render.yaml                    # Render static site blueprint
├── public/basic-pitch/            # TensorFlow.js model weights (Audio → MIDI)
├── workers/demucs-api/            # Optional FastAPI Demucs separation service
│   ├── main.py
│   └── requirements.txt
└── src/
    ├── App.tsx                    # Shell, navigation, view routing
    ├── audio/
    │   ├── AudioEngine.ts         # Synth voices, FX chain, ZDF worklet
    │   ├── MidiEngine.ts          # Web MIDI input
    │   ├── presets.ts             # Factory patches
    │   └── analysis/
    │       ├── basicPitchTranscribe.ts   # Neural transcription (TF.js)
    │       ├── pitchlineTranscribe.ts    # Audio → MIDI orchestration
    │       ├── voiceToMidi.ts            # MPM contour tracker
    │       ├── noteCleanup.ts            # Note merging & monophonic enforcement
    │       ├── drumTranscribe.ts         # Onset-based drum MIDI
    │       ├── stemSeparate.ts           # Demucs API client
    │       ├── stemPipeline.ts           # Track Rack end-to-end pipeline
    │       ├── stemPrep.ts               # Per-stem conditioning
    │       ├── presetMatcher.ts          # Stem → synth patch heuristic
    │       └── stemExport.ts             # MIDI / WAV export helpers
    ├── components/
    │   ├── CaptureStudio.tsx      # Audio → MIDI UI
    │   ├── TrackRack.tsx          # Track Rack UI
    │   ├── TrackRackAgentProgress.tsx
    │   ├── GitHubPanel.tsx
    │   ├── Sequencer.tsx
    │   ├── Knob.tsx
    │   ├── Keyboard.tsx
    │   ├── Visualizer.tsx
    │   └── PresetBrowser.tsx
    └── lib/
        ├── config.ts              # Navigation, deploy detection
        ├── analytics.ts
        └── embed.ts
```

---

## Signal Flow (Synthesizer)

```
[OSC1 + unison] ─┐
                 ├─→ [Drive] → [Filter 1] ⇄ [Filter 2] → [Amp Env] ─┐
[OSC2 + unison] ─┤         ↑ LFO1 / LFO2 / Mod Matrix / MIDI         │
[Noise]─────────┘                                                    ▼
                    [Distortion] → [Delay] → [Reverb] → [Chorus] → [Phaser]
                              → [EQ] → [Compressor] → [Limiter] → Output
```

---

## Acknowledgements

NEXUS builds on open-source research and libraries:

- **Basic Pitch** — neural audio-to-MIDI transcription (browser inference via TensorFlow.js)
- **Demucs** — hybrid Transformer source separation ([facebookresearch/demucs](https://github.com/facebookresearch/demucs))
- **TensorFlow.js** — in-browser machine learning runtime
- **Web Audio API** & **Web MIDI API** — W3C browser standards

---

## License

MIT — see [LICENSE](LICENSE).
