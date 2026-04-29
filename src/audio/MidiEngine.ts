// Web MIDI engine — standard MIDI message handling
// Supports: Note On/Off, Velocity, Pitch Bend, Modulation (CC1), Sustain (CC64),
// All Notes Off (CC123), All Sound Off (CC120), Channel Volume (CC7).

export interface MidiDevice {
  id: string;
  name: string;
  manufacturer: string;
  state: 'connected' | 'disconnected';
}

export interface MidiEvents {
  onNoteOn?: (note: number, velocity: number, channel: number) => void;
  onNoteOff?: (note: number, channel: number) => void;
  onPitchBend?: (semitones: number, channel: number) => void;
  onModWheel?: (value: number, channel: number) => void;
  onSustain?: (on: boolean, channel: number) => void;
  onAllNotesOff?: (channel: number) => void;
  onCC?: (controller: number, value: number, channel: number) => void;
  onDeviceChange?: (devices: MidiDevice[]) => void;
  onActivity?: () => void;
}

export class MidiEngine {
  private access: MIDIAccess | null = null;
  private inputs: Map<string, MIDIInput> = new Map();
  private selectedInputId: string | null = null;
  private events: MidiEvents = {};
  private pitchBendRangeSemi = 2; // Standard default

  get supported(): boolean {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  }

  async init(events: MidiEvents = {}): Promise<boolean> {
    this.events = events;
    if (!this.supported) return false;

    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      this.refreshInputs();

      this.access.onstatechange = () => this.refreshInputs();
      return true;
    } catch (err) {
      console.warn('[MIDI] requestMIDIAccess failed:', err);
      return false;
    }
  }

  setEvents(events: MidiEvents) {
    this.events = { ...this.events, ...events };
  }

  private refreshInputs() {
    if (!this.access) return;
    this.inputs.clear();
    this.access.inputs.forEach((input) => {
      this.inputs.set(input.id, input);
    });

    const devices: MidiDevice[] = Array.from(this.inputs.values()).map((i) => ({
      id: i.id,
      name: i.name ?? 'Unknown',
      manufacturer: i.manufacturer ?? '',
      state: i.state as 'connected' | 'disconnected',
    }));
    this.events.onDeviceChange?.(devices);

    // Auto-select first input if none selected, otherwise verify selection still exists
    if (!this.selectedInputId && devices.length > 0) {
      this.selectInput(devices[0].id);
    } else if (this.selectedInputId && !this.inputs.has(this.selectedInputId)) {
      const first = devices[0]?.id ?? null;
      this.selectInput(first);
    } else if (this.selectedInputId) {
      // Re-bind listener in case the input was re-created
      this.selectInput(this.selectedInputId);
    }
  }

  getDevices(): MidiDevice[] {
    return Array.from(this.inputs.values()).map((i) => ({
      id: i.id,
      name: i.name ?? 'Unknown',
      manufacturer: i.manufacturer ?? '',
      state: i.state as 'connected' | 'disconnected',
    }));
  }

  getSelectedId(): string | null {
    return this.selectedInputId;
  }

  /** Select (or re-bind to) a MIDI input by ID. Pass null to listen to all inputs. */
  selectInput(id: string | null) {
    // Unbind all inputs first
    this.inputs.forEach((input) => { input.onmidimessage = null; });

    this.selectedInputId = id;
    if (id && this.inputs.has(id)) {
      const input = this.inputs.get(id)!;
      input.onmidimessage = (e) => this.handleMessage(e);
    } else if (id === null) {
      // Listen to all inputs
      this.inputs.forEach((input) => {
        input.onmidimessage = (e) => this.handleMessage(e);
      });
    }
  }

  private handleMessage(e: MIDIMessageEvent) {
    const data = e.data;
    if (!data || data.length < 1) return;
    this.events.onActivity?.();

    const status = data[0] & 0xf0;
    const channel = data[0] & 0x0f;
    const d1 = data[1] ?? 0;
    const d2 = data[2] ?? 0;

    switch (status) {
      case 0x90: // Note On
        if (d2 > 0) {
          this.events.onNoteOn?.(d1, d2 / 127, channel);
        } else {
          // Note On with velocity 0 == Note Off
          this.events.onNoteOff?.(d1, channel);
        }
        break;

      case 0x80: // Note Off
        this.events.onNoteOff?.(d1, channel);
        break;

      case 0xe0: {
        // Pitch bend: 14-bit value, center = 0x2000 (8192)
        const value = (d2 << 7) | d1;
        const norm = (value - 8192) / 8192; // -1..+1
        this.events.onPitchBend?.(norm * this.pitchBendRangeSemi, channel);
        break;
      }

      case 0xb0: // Control Change
        this.handleCC(d1, d2, channel);
        break;

      default:
        // 0xA0 Poly Aftertouch, 0xC0 Program Change, 0xD0 Channel Pressure, 0xF0 System
        break;
    }
  }

  private handleCC(cc: number, value: number, channel: number) {
    const norm = value / 127;
    this.events.onCC?.(cc, norm, channel);

    switch (cc) {
      case 1: // Modulation wheel
        this.events.onModWheel?.(norm, channel);
        break;
      case 64: // Sustain pedal
        this.events.onSustain?.(value >= 64, channel);
        break;
      case 120: // All Sound Off
      case 123: // All Notes Off
        this.events.onAllNotesOff?.(channel);
        break;
      case 101: // RPN MSB
      case 100: // RPN LSB
      case 6: // Data Entry MSB — could listen for pitch bend range changes here
        break;
    }
  }

  setPitchBendRange(semis: number) {
    this.pitchBendRangeSemi = Math.max(0, semis);
  }

  dispose() {
    this.inputs.forEach((input) => { input.onmidimessage = null; });
    if (this.access) this.access.onstatechange = null;
    this.inputs.clear();
    this.access = null;
  }
}
