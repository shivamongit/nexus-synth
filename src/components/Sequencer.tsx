import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface SeqCell {
  active: boolean;
  midi: number;
  velocity: number;
}

export const NUM_STEPS = 16;
export const NUM_ROWS = 16;
export const GRID_BASE = 48; // C3

function emptyGrid(): SeqCell[][] {
  return Array.from({ length: NUM_STEPS }, () =>
    Array.from({ length: NUM_ROWS }, (_, row) => ({
      active: false,
      midi: GRID_BASE + (NUM_ROWS - 1 - row),
      velocity: 0.8,
    })),
  );
}

function midiName(m: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${names[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

interface SequencerProps {
  onNoteOn: (note: number, velocity: number) => void;
  onNoteOff: (note: number) => void;
  baseOctave: number;
  audioTime?: () => number;
  pattern?: SeqCell[][] | null;
  patternId?: number;
  onBpm?: (bpm: number) => void;
}

const Sequencer: React.FC<SequencerProps> = ({
  onNoteOn, onNoteOff, baseOctave, audioTime, pattern, patternId, onBpm,
}) => {
  const [steps, setSteps] = useState<SeqCell[][]>(emptyGrid);
  const [playing, setPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [bpm, setBpm] = useState(120);
  const [swing, setSwing] = useState(0);

  const stepRef = useRef(-1);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const lastNoteRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const nextTimeRef = useRef(0);

  useEffect(() => {
    if (!pattern) return;
    setSteps(pattern);
  }, [pattern, patternId]);

  const tick = useCallback(() => {
    const nextStep = (stepRef.current + 1) % NUM_STEPS;
    stepRef.current = nextStep;
    setCurrentStep(nextStep);
    if (lastNoteRef.current !== null) {
      onNoteOff(lastNoteRef.current);
      lastNoteRef.current = null;
    }
    const col = stepsRef.current[nextStep];
    const base = GRID_BASE + baseOctave * 12;
    for (let row = 0; row < NUM_ROWS; row++) {
      if (col[row].active) {
        const note = col[row].midi || base + (NUM_ROWS - 1 - row);
        onNoteOn(note, col[row].velocity || 0.8);
        lastNoteRef.current = note;
        break;
      }
    }
  }, [onNoteOn, onNoteOff, baseOctave]);

  useEffect(() => {
    if (!playing) {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      stepRef.current = -1;
      setCurrentStep(-1);
      if (lastNoteRef.current !== null) {
        onNoteOff(lastNoteRef.current);
        lastNoteRef.current = null;
      }
      return;
    }

    const sixteenth = () => 60 / bpm / 4;
    const now = audioTime?.() ?? performance.now() / 1000;
    nextTimeRef.current = now;

    const loop = () => {
      tick();
      const stepIndex = stepRef.current;
      const swingAmt = (swing / 100) * 0.5;
      const dur = sixteenth() * (stepIndex % 2 === 1 ? 1 + swingAmt : 1 - swingAmt * 0.5);
      nextTimeRef.current += dur;
      const t = audioTime?.() ?? performance.now() / 1000;
      const wait = Math.max(10, (nextTimeRef.current - t) * 1000);
      timerRef.current = window.setTimeout(loop, wait);
    };
    loop();
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [playing, bpm, swing, tick, onNoteOff, audioTime]);

  const toggleCell = (stepIdx: number, rowIdx: number) => {
    setSteps((prev) => {
      const next = prev.map((col) => col.map((cell) => ({ ...cell })));
      next[stepIdx][rowIdx].active = !next[stepIdx][rowIdx].active;
      next[stepIdx][rowIdx].midi = GRID_BASE + baseOctave * 12 + (NUM_ROWS - 1 - rowIdx);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 px-1">
        <button
          onClick={() => setPlaying(!playing)}
          className={`text-[10px] font-semibold px-3 py-1.5 rounded transition-all ${
            playing
              ? 'bg-nexus-accent/20 text-nexus-accent border border-nexus-accent/40 shadow-glow'
              : 'bg-nexus-surface text-nexus-text-dim border border-nexus-border hover:text-nexus-accent'
          }`}
        >
          {playing ? 'STOP' : 'PLAY'}
        </button>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] uppercase tracking-wider text-nexus-text-dim">BPM</span>
          <input
            type="number"
            value={bpm}
            onChange={(e) => {
              const v = Math.max(40, Math.min(300, Number(e.target.value)));
              setBpm(v);
              onBpm?.(v);
            }}
            className="w-12 bg-nexus-surface border border-nexus-border rounded px-1.5 py-0.5 text-[11px] font-mono text-nexus-text text-center focus:outline-none focus:border-nexus-accent/50"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] uppercase tracking-wider text-nexus-text-dim">SWING</span>
          <input
            type="range"
            min={0}
            max={100}
            value={swing}
            onChange={(e) => setSwing(Number(e.target.value))}
            className="w-16 h-1 accent-[#00d4ff]"
          />
          <span className="text-[9px] font-mono text-nexus-text-dim w-6">{swing}%</span>
        </div>
        <div className="ml-auto flex gap-1.5">
          <button
            onClick={() => setSteps(
              Array.from({ length: NUM_STEPS }, () =>
                Array.from({ length: NUM_ROWS }, (_, row) => ({
                  active: Math.random() < 0.12,
                  midi: GRID_BASE + baseOctave * 12 + (NUM_ROWS - 1 - row),
                  velocity: 0.5 + Math.random() * 0.5,
                })),
              ),
            )}
            className="text-[9px] px-2 py-1 rounded bg-nexus-surface border border-nexus-border text-nexus-text-dim hover:text-nexus-warm"
          >
            RANDOM
          </button>
          <button
            onClick={() => setSteps(emptyGrid())}
            className="text-[9px] px-2 py-1 rounded bg-nexus-surface border border-nexus-border text-nexus-text-dim hover:text-nexus-pink"
          >
            CLEAR
          </button>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-md border border-nexus-border flex">
        <div className="flex flex-col w-8 flex-shrink-0 border-r border-nexus-border">
          {Array.from({ length: NUM_ROWS }, (_, rowIdx) => (
            <div key={rowIdx} className="flex-1 text-[7px] font-mono text-nexus-text-muted px-0.5 flex items-center">
              {midiName(GRID_BASE + baseOctave * 12 + (NUM_ROWS - 1 - rowIdx))}
            </div>
          ))}
        </div>
        <div className="flex-1 grid" style={{ gridTemplateRows: `repeat(${NUM_ROWS}, 1fr)` }}>
          {Array.from({ length: NUM_ROWS }, (_, rowIdx) => (
            <div key={rowIdx} className="flex">
              {Array.from({ length: NUM_STEPS }, (_, stepIdx) => {
                const isActive = steps[stepIdx][rowIdx].active;
                const isCurrent = stepIdx === currentStep;
                const isBeat = stepIdx % 4 === 0;
                return (
                  <div
                    key={stepIdx}
                    onClick={() => toggleCell(stepIdx, rowIdx)}
                    className={`
                      w-full cursor-pointer transition-all duration-75 border-r border-b border-[#0e0e16]
                      ${isBeat ? 'border-l border-l-[#1a1a2a]' : ''}
                      ${isActive
                        ? isCurrent ? 'bg-nexus-accent' : 'bg-nexus-accent/60 hover:bg-nexus-accent/80'
                        : isCurrent ? 'bg-[#1a1a28]' : 'bg-[#0c0c14] hover:bg-[#151522]'}
                    `}
                    style={{ minWidth: '14px', minHeight: '11px' }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Sequencer;
export { emptyGrid };
