import React, { useState, useRef, useEffect } from 'react';
import type { Preset } from '../audio/presets';

interface Props {
  presets: Preset[];
  currentIndex: number;
  onLoad: (index: number) => void;
}

const CATEGORY_COLOR: Record<string, string> = {
  Lead: '#00d4ff',
  Bass: '#ff2d7b',
  Pad: '#a855f7',
  Pluck: '#00ff88',
  Keys: '#ffbf3f',
  FX: '#ff6b35',
  Init: '#6b6b80',
};

const PresetBrowser: React.FC<Props> = ({ presets, currentIndex, onLoad }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const current = presets[currentIndex];
  const cats = Array.from(new Set(presets.map(p => p.category)));

  return (
    <div className="relative" ref={ref}>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onLoad(Math.max(0, currentIndex - 1))}
          className="text-nexus-text-dim hover:text-nexus-accent text-sm px-1 transition-colors"
          title="Previous preset"
        >
          ◀
        </button>

        <button
          onClick={() => setOpen(o => !o)}
          className="min-w-[180px] px-3 py-1 rounded bg-nexus-surface border border-nexus-border hover:border-nexus-accent/40 transition-colors text-left"
        >
          <div className="flex items-center gap-2">
            <span
              className="w-1 h-3 rounded-sm"
              style={{ background: CATEGORY_COLOR[current.category] ?? '#6b6b80' }}
            />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-mono text-nexus-text truncate">{current.name}</div>
              <div className="text-[8px] uppercase tracking-wider text-nexus-text-muted">{current.category}</div>
            </div>
            <span className="text-nexus-text-muted text-[10px]">▼</span>
          </div>
        </button>

        <button
          onClick={() => onLoad(Math.min(presets.length - 1, currentIndex + 1))}
          className="text-nexus-text-dim hover:text-nexus-accent text-sm px-1 transition-colors"
          title="Next preset"
        >
          ▶
        </button>
      </div>

      {open && (
        <div
          className="absolute z-50 top-full mt-1 left-0 right-0 min-w-[360px] max-h-[60vh] overflow-y-auto rounded border border-nexus-border bg-nexus-bg/98 backdrop-blur-xl shadow-2xl"
          style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.6), 0 0 1px rgba(0,212,255,0.2)' }}
        >
          {cats.map(cat => (
            <div key={cat}>
              <div className="px-3 py-1.5 text-[8px] uppercase tracking-[0.2em] text-nexus-text-muted border-b border-nexus-border bg-nexus-surface/50 flex items-center gap-2 sticky top-0 backdrop-blur-xl">
                <span
                  className="w-1.5 h-1.5 rounded-sm"
                  style={{ background: CATEGORY_COLOR[cat] ?? '#6b6b80' }}
                />
                {cat}
              </div>
              {presets
                .map((p, i) => ({ p, i }))
                .filter(({ p }) => p.category === cat)
                .map(({ p, i }) => (
                  <button
                    key={i}
                    onClick={() => { onLoad(i); setOpen(false); }}
                    className={`w-full text-left px-3 py-1.5 text-[10px] font-mono transition-colors flex items-center justify-between gap-2 ${
                      i === currentIndex
                        ? 'bg-nexus-accent/10 text-nexus-accent'
                        : 'text-nexus-text hover:bg-nexus-surface'
                    }`}
                  >
                    <span>{p.name}</span>
                    <span className="text-[8px] text-nexus-text-muted">
                      {p.params.osc1.unison > 1 ? `U${p.params.osc1.unison}` : ''}
                      {p.params.lfo.depth > 0 ? ' LFO' : ''}
                    </span>
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PresetBrowser;
