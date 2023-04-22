import React, { useCallback, useEffect, useState, useRef } from 'react';

interface KeyboardProps {
  onNoteOn: (note: number, velocity: number) => void;
  onNoteOff: (note: number) => void;
  octave: number;
  onOctaveChange: (octave: number) => void;
  activeNotes: Set<number>;
}

const KEY_MAP: Record<string, number> = {
  'a': 0, 'w': 1, 's': 2, 'e': 3, 'd': 4, 'f': 5,
  't': 6, 'g': 7, 'y': 8, 'h': 9, 'u': 10, 'j': 11,
  'k': 12, 'o': 13, 'l': 14, 'p': 15, ';': 16,
};

const isBlackKey = (noteInOctave: number) => [1, 3, 6, 8, 10].includes(noteInOctave);

const Keyboard: React.FC<KeyboardProps> = ({
  onNoteOn, onNoteOff, octave, onOctaveChange, activeNotes,
}) => {
  const [heldKeys, setHeldKeys] = useState<Set<string>>(new Set());
  const keyMapRef = useRef(KEY_MAP);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.repeat) return;
    const key = e.key.toLowerCase();

    if (key === 'z') {
      onOctaveChange(Math.max(-2, octave - 1));
      return;
    }
    if (key === 'x') {
      onOctaveChange(Math.min(4, octave + 1));
      return;
    }

    const offset = keyMapRef.current[key];
    if (offset !== undefined) {
      const note = 60 + octave * 12 + offset;
      onNoteOn(note, 0.8);
      setHeldKeys(prev => new Set(prev).add(key));
    }
  }, [octave, onNoteOn, onOctaveChange]);

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    const offset = keyMapRef.current[key];
    if (offset !== undefined) {
      const note = 60 + octave * 12 + offset;
      onNoteOff(note);
      setHeldKeys(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [octave, onNoteOff]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  const startNote = 60 + octave * 12 - 12;
  const numKeys = 29;
  const whiteKeys: number[] = [];
  const blackKeys: { note: number; position: number }[] = [];

  let whiteIndex = 0;
  for (let i = 0; i < numKeys; i++) {
    const note = startNote + i;
    const noteInOctave = note % 12;
    if (!isBlackKey(noteInOctave)) {
      whiteKeys.push(note);
      whiteIndex++;
    } else {
      blackKeys.push({ note, position: whiteIndex - 1 });
    }
  }

  const whiteKeyWidth = 100 / whiteKeys.length;

  const handleMouseDown = (note: number, e: React.MouseEvent) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const velocity = Math.min(1, Math.max(0.3, (e.clientY - rect.top) / rect.height));
    onNoteOn(note, velocity);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 px-2">
        <button
          onClick={() => onOctaveChange(Math.max(-2, octave - 1))}
          className="text-[10px] px-2 py-1 rounded bg-nexus-surface border border-nexus-border text-nexus-text-dim hover:text-nexus-accent hover:border-nexus-accent/30 transition-colors"
        >
          OCT -
        </button>
        <span className="text-[11px] font-mono text-nexus-text min-w-[36px] text-center">
          C{octave + 4}
        </span>
        <button
          onClick={() => onOctaveChange(Math.min(4, octave + 1))}
          className="text-[10px] px-2 py-1 rounded bg-nexus-surface border border-nexus-border text-nexus-text-dim hover:text-nexus-accent hover:border-nexus-accent/30 transition-colors"
        >
          OCT +
        </button>
        <span className="text-[9px] text-nexus-text-muted ml-auto">
          Z/X: octave &nbsp; A-L: play
        </span>
      </div>

      <div className="relative h-[80px] select-none" style={{ touchAction: 'none' }}>
        {/* White keys */}
        <div className="absolute inset-0 flex">
          {whiteKeys.map((note) => {
            const active = activeNotes.has(note);
            return (
              <div
                key={note}
                style={{ width: `${whiteKeyWidth}%` }}
                className={`
                  relative h-full border-r border-[#1a1a24] rounded-b-[3px] cursor-pointer
                  transition-all duration-75
                  ${active
                    ? 'bg-gradient-to-b from-[#00d4ff22] to-[#00d4ff08] border-b-2 border-b-[#00d4ff]'
                    : 'bg-gradient-to-b from-[#1c1c28] to-[#14141e] hover:from-[#222230] hover:to-[#18182a]'
                  }
                `}
                onMouseDown={(e) => handleMouseDown(note, e)}
                onMouseUp={() => onNoteOff(note)}
                onMouseLeave={() => onNoteOff(note)}
              >
                {active && (
                  <div className="absolute bottom-0 left-0 right-0 h-1 bg-[#00d4ff] rounded-b-[3px]"
                    style={{ boxShadow: '0 0 8px #00d4ff' }}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Black keys */}
        {blackKeys.map(({ note, position }) => {
          const active = activeNotes.has(note);
          const left = (position + 0.65) * whiteKeyWidth;
          return (
            <div
              key={note}
              style={{
                position: 'absolute',
                left: `${left}%`,
                width: `${whiteKeyWidth * 0.65}%`,
                height: '55%',
                zIndex: 10,
              }}
              className={`
                rounded-b-[3px] cursor-pointer transition-all duration-75
                ${active
                  ? 'bg-gradient-to-b from-[#00d4ff33] to-[#0a0a12] shadow-[0_0_10px_#00d4ff40]'
                  : 'bg-gradient-to-b from-[#0e0e16] to-[#080810] hover:from-[#151520] hover:to-[#0c0c14]'
                }
                border border-[#0a0a12]
              `}
              onMouseDown={(e) => handleMouseDown(note, e)}
              onMouseUp={() => onNoteOff(note)}
              onMouseLeave={() => onNoteOff(note)}
            />
          );
        })}
      </div>
    </div>
  );
};

export default Keyboard;
