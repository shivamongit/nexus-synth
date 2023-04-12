import React, { useCallback, useRef, useState, useEffect } from 'react';

interface KnobProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  label: string;
  unit?: string;
  size?: number;
  color?: string;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
}

const Knob: React.FC<KnobProps> = ({
  value, min, max, step = 0.01, label, unit = '',
  size = 48, color = '#00d4ff', onChange, formatValue,
}) => {
  const knobRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ dragging: false, startY: 0, startVal: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);

  const normalizedValue = (value - min) / (max - min);
  const startAngle = -135;
  const endAngle = 135;
  const angle = startAngle + normalizedValue * (endAngle - startAngle);

  const radius = size / 2 - 4;
  const arcRadius = size / 2 - 2;
  const cx = size / 2;
  const cy = size / 2;

  const polarToCartesian = (cx: number, cy: number, r: number, deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };

  const describeArc = (cx: number, cy: number, r: number, start: number, end: number) => {
    const s = polarToCartesian(cx, cy, r, end);
    const e = polarToCartesian(cx, cy, r, start);
    const largeArc = end - start <= 180 ? 0 : 1;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${largeArc} 0 ${e.x} ${e.y}`;
  };

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { dragging: true, startY: e.clientY, startVal: value };
    setIsDragging(true);
    setShowTooltip(true);
  }, [value]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current.dragging) return;
      const dy = dragRef.current.startY - e.clientY;
      const sensitivity = e.shiftKey ? 0.001 : 0.005;
      const range = max - min;
      const newVal = Math.min(max, Math.max(min, dragRef.current.startVal + dy * sensitivity * range));
      const quantized = Math.round(newVal / step) * step;
      onChange(quantized);
    };

    const handleMouseUp = () => {
      dragRef.current.dragging = false;
      setIsDragging(false);
      setTimeout(() => setShowTooltip(false), 600);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [max, min, step, onChange]);

  const handleDoubleClick = () => {
    onChange((min + max) / 2);
  };

  const displayValue = formatValue
    ? formatValue(value)
    : value >= 1000
    ? `${(value / 1000).toFixed(1)}k`
    : value >= 100
    ? Math.round(value).toString()
    : value >= 10
    ? value.toFixed(1)
    : value.toFixed(2);

  const indicatorEnd = polarToCartesian(cx, cy, radius - 6, angle);
  const indicatorStart = polarToCartesian(cx, cy, radius - 14, angle);

  return (
    <div className="flex flex-col items-center gap-0.5 select-none" style={{ width: size + 12 }}>
      {(showTooltip || isDragging) && (
        <div
          className="absolute -top-6 px-1.5 py-0.5 rounded text-[9px] font-mono z-50 whitespace-nowrap"
          style={{
            background: 'rgba(0,0,0,0.9)',
            border: `1px solid ${color}33`,
            color,
          }}
        >
          {displayValue}{unit}
        </div>
      )}

      <div
        ref={knobRef}
        className="relative cursor-ns-resize"
        style={{ width: size, height: size }}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => !isDragging && setShowTooltip(false)}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {/* Track background */}
          <path
            d={describeArc(cx, cy, arcRadius, startAngle, endAngle)}
            fill="none"
            stroke="#1e1e2a"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
          {/* Active arc */}
          {normalizedValue > 0.005 && (
            <path
              d={describeArc(cx, cy, arcRadius, startAngle, angle)}
              fill="none"
              stroke={color}
              strokeWidth={2.5}
              strokeLinecap="round"
              style={{
                filter: isDragging ? `drop-shadow(0 0 4px ${color})` : 'none',
              }}
            />
          )}
          {/* Knob body */}
          <circle
            cx={cx}
            cy={cy}
            r={radius - 4}
            fill="url(#knobGrad)"
            stroke={isDragging ? color : '#2a2a3a'}
            strokeWidth={1}
          />
          {/* Indicator line */}
          <line
            x1={indicatorStart.x}
            y1={indicatorStart.y}
            x2={indicatorEnd.x}
            y2={indicatorEnd.y}
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            style={{
              filter: `drop-shadow(0 0 3px ${color}88)`,
            }}
          />
          <defs>
            <radialGradient id="knobGrad" cx="35%" cy="35%">
              <stop offset="0%" stopColor="#2a2a38" />
              <stop offset="100%" stopColor="#151520" />
            </radialGradient>
          </defs>
        </svg>
      </div>

      <span className="knob-value">{displayValue}{unit}</span>
      <span className="knob-label">{label}</span>
    </div>
  );
};

export default Knob;
