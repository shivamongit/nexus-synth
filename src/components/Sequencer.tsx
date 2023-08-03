import React, { useState, useEffect, useRef, useCallback } from 'react';

interface Step {
  active: boolean;
  note: number;
  velocity: number;
}

interface SequencerProps {
  onNoteOn: (note: number, velocity: number) => void;
  onNoteOff: (note: number) => void;
  baseOctave: number;
}

const SCALE_NOTES = [0, 2, 3, 5, 7, 8, 10, 12, 14, 15, 17, 19, 20, 22, 24];
const NUM_STEPS = 16;
const NUM_ROWS = 13;

const Sequencer: React.FC<SequencerProps> = ({ onNoteOn, onNoteOff, baseOctave }) => {
  const [steps, setSteps] = useState<Step[][]>(() =>
    Array.from({ length: NUM_STEPS }, () =>
      Array.from({ length: NUM_ROWS }, () => ({ active: false, note: 0, velocity: 0.8 }))
    )
  );
  const [playing, setPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [bpm, setBpm] = useState(128);
  const [swing, setSwing] = useState(0);

  const intervalRef = useRef<number | null>(null);
  const stepRef = useRef(-1);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  const lastNoteRef = useRef<number | null>(null);

  const tick = useCallback(() => {
    const nextStep = (stepRef.current + 1) % NUM_STEPS;
    stepRef.current = nextStep;
    setCurrentStep(nextStep);

    if (lastNoteRef.current !== null) {
      onNoteOff(lastNoteRef.current);
      lastNoteRef.current = null;
    }

    const col = stepsRef.current[nextStep];
    for (let row = 0; row < NUM_ROWS; row++) {
      if (col[row].active) {
        const noteOffset = SCALE_NOTES[NUM_ROWS - 1 - row];
        const note = 48 + baseOctave * 12 + noteOffset;
        onNoteOn(note, col[row].velocity);
        lastNoteRef.current = note;
        break;
      }
    }
  }, [onNoteOn, onNoteOff, baseOctave]);

  useEffect(() => {
    if (playing) {
      const msPerStep = (60000 / bpm) / 4;
      intervalRef.current = window.setInterval(tick, msPerStep);
    } else {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
      stepRef.current = -1;
      setCurrentStep(-1);
      if (lastNoteRef.current !== null) {
        onNoteOff(lastNoteRef.current);
        lastNoteRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, [playing, bpm, tick, onNoteOff]);

  const toggleCell = (stepIdx: number, rowIdx: number) => {
    setSteps(prev => {
      const next = prev.map(col => col.map(cell => ({ ...cell })));
      next[stepIdx][rowIdx].active = !next[stepIdx][rowIdx].active;
      return next;
    });
  };

  const clearAll = () => {
    setSteps(
      Array.from({ length: NUM_STEPS }, () =>
        Array.from({ length: NUM_ROWS }, () => ({ active: false, note: 0, velocity: 0.8 }))
      )
    );
  };

  const randomize = () => {
    setSteps(
      Array.from({ length: NUM_STEPS }, () =>
        Array.from({ length: NUM_ROWS }, () => ({
          active: Math.random() < 0.15,
          note: 0,
          velocity: 0.5 + Math.random() * 0.5,
        }))
      )
    );
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
          {playing ? '■ STOP' : '▶ PLAY'}
        </button>

        <div className="flex items-center gap-1.5">
          <span className="text-[9px] uppercase tracking-wider text-nexus-text-dim">BPM</span>
          <input
            type="number"
            value={bpm}
            onChange={e => setBpm(Math.max(40, Math.min(300, Number(e.target.value))))}
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
            onChange={e => setSwing(Number(e.target.value))}
            className="w-16 h-1 accent-[#00d4ff]"
          />
          <span className="text-[9px] font-mono text-nexus-text-dim w-6">{swing}%</span>
        </div>

        <div className="ml-auto flex gap-1.5">
          <button
            onClick={randomize}
            className="text-[9px] px-2 py-1 rounded bg-nexus-surface border border-nexus-border text-nexus-text-dim hover:text-nexus-warm hover:border-nexus-warm/30 transition-colors"
          >
            RANDOM
          </button>
          <button
            onClick={clearAll}
            className="text-[9px] px-2 py-1 rounded bg-nexus-surface border border-nexus-border text-nexus-text-dim hover:text-nexus-pink hover:border-nexus-pink/30 transition-colors"
          >
            CLEAR
          </button>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-md border border-nexus-border">
        <div className="grid" style={{ gridTemplateRows: `repeat(${NUM_ROWS}, 1fr)` }}>
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
                      w-full aspect-square cursor-pointer transition-all duration-75
                      border-r border-b border-[#0e0e16]
                      ${isBeat ? 'border-l border-l-[#1a1a2a]' : ''}
                      ${isActive
                        ? isCurrent
                          ? 'bg-nexus-accent shadow-[inset_0_0_8px_#00d4ff60]'
                          : 'bg-nexus-accent/60 hover:bg-nexus-accent/80'
                        : isCurrent
                          ? 'bg-[#1a1a28]'
                          : 'bg-[#0c0c14] hover:bg-[#151522]'
                      }
                    `}
                    style={{
                      minWidth: '16px',
                      minHeight: '10px',
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>

        {/* Playhead overlay */}
        {currentStep >= 0 && (
          <div
            className="absolute top-0 bottom-0 pointer-events-none border-l-2 border-nexus-accent/60 transition-[left] duration-75"
            style={{
              left: `${(currentStep / NUM_STEPS) * 100}%`,
              width: `${100 / NUM_STEPS}%`,
              background: 'rgba(0, 212, 255, 0.04)',
            }}
          />
        )}
      </div>
    </div>
  );
};

export default Sequencer;
