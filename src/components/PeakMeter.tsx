import React, { useEffect, useRef } from 'react';
import type { AudioEngine } from '../audio/AudioEngine';

interface Props {
  engine: AudioEngine | null;
  width?: number;
  height?: number;
}

const PeakMeter: React.FC<Props> = ({ engine, width = 10, height = 60 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const peakHoldL = useRef({ value: 0, time: 0 });
  const peakHoldR = useRef({ value: 0, time: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * 2 * dpr + 2 * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width * 2 + 2}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      if (!engine) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }
      const { l, r } = engine.getPeakLevels();
      const now = performance.now();

      // Peak hold — 1.2s then drop
      if (l > peakHoldL.current.value || now - peakHoldL.current.time > 1200) {
        peakHoldL.current = { value: l, time: now };
      }
      if (r > peakHoldR.current.value || now - peakHoldR.current.time > 1200) {
        peakHoldR.current = { value: r, time: now };
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const drawChannel = (x: number, level: number, peak: number) => {
        const barHeight = Math.min(1, level) * height;
        const peakY = (1 - Math.min(1, peak)) * height;

        // Gradient: green → yellow → red
        const grad = ctx.createLinearGradient(0, 0, 0, height);
        grad.addColorStop(0, '#ff2d2d');
        grad.addColorStop(0.12, '#ff6b35');
        grad.addColorStop(0.35, '#ffbf3f');
        grad.addColorStop(0.6, '#00ff88');
        grad.addColorStop(1, '#00b870');

        // Background
        ctx.fillStyle = '#0a0a0f';
        ctx.fillRect(x, 0, width, height);
        // Bar
        ctx.fillStyle = grad;
        ctx.fillRect(x, height - barHeight, width, barHeight);
        // Peak hold line
        ctx.fillStyle = peak > 0.95 ? '#ff2d2d' : '#e0e0e8';
        ctx.fillRect(x, Math.max(0, peakY - 1), width, 2);
      };

      drawChannel(0, l, peakHoldL.current.value);
      drawChannel(width + 2, r, peakHoldR.current.value);
    };

    draw();
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [engine, width, height]);

  return <canvas ref={canvasRef} />;
};

export default PeakMeter;
