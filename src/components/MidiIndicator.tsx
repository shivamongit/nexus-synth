import React, { useEffect, useRef, useState } from 'react';
import type { MidiDevice } from '../audio/MidiEngine';

interface Props {
  supported: boolean;
  enabled: boolean;
  onToggle: () => void;
  devices: MidiDevice[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  activityTick: number;      // increments on every MIDI message
  pitchBend: number;         // semitones -2..+2
  modWheel: number;          // 0..1
}

const MidiIndicator: React.FC<Props> = ({
  supported, enabled, onToggle, devices, selectedId, onSelect,
  activityTick, pitchBend, modWheel,
}) => {
  const [active, setActive] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    setActive(true);
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => setActive(false), 90);
    return () => { if (timeoutRef.current) window.clearTimeout(timeoutRef.current); };
  }, [activityTick]);

  if (!supported) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded text-[9px] uppercase tracking-wider text-nexus-text-muted border border-nexus-border">
        <span className="w-1.5 h-1.5 rounded-full bg-nexus-text-muted" />
        MIDI N/A
      </div>
    );
  }

  if (!enabled) {
    return (
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 px-2 py-1 rounded text-[9px] uppercase tracking-wider text-nexus-text-dim hover:text-nexus-accent border border-nexus-border hover:border-nexus-accent/40 transition-colors"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-nexus-text-muted" />
        Enable MIDI
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded text-[9px] uppercase tracking-wider border border-nexus-border bg-nexus-surface">
      <span
        className="w-1.5 h-1.5 rounded-full transition-all"
        style={{
          background: active ? '#00ff88' : devices.length > 0 ? '#00d4ff' : '#3a3a4a',
          boxShadow: active ? '0 0 8px #00ff88' : devices.length > 0 ? '0 0 4px rgba(0,212,255,0.5)' : 'none',
        }}
      />
      <span className="text-nexus-text-dim">MIDI</span>
      <select
        value={selectedId ?? ''}
        onChange={(e) => onSelect(e.target.value || null)}
        className="bg-transparent text-nexus-text text-[9px] outline-none border-l border-nexus-border pl-2 max-w-[120px] truncate cursor-pointer"
      >
        {devices.length === 0 && <option value="">No devices</option>}
        {devices.map((d) => (
          <option key={d.id} value={d.id}>{d.name}</option>
        ))}
      </select>
      {/* Pitch bend + mod wheel mini indicators */}
      <span className="text-nexus-text-muted border-l border-nexus-border pl-2" title="Pitch bend">
        PB:
        <span className="text-nexus-accent ml-0.5 font-mono w-8 inline-block">
          {pitchBend > 0 ? `+${pitchBend.toFixed(1)}` : pitchBend.toFixed(1)}
        </span>
      </span>
      <span className="text-nexus-text-muted" title="Mod wheel">
        MOD:
        <span className="text-nexus-pink ml-0.5 font-mono w-6 inline-block">
          {Math.round(modWheel * 100)}
        </span>
      </span>
    </div>
  );
};

export default MidiIndicator;
