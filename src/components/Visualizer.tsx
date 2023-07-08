import React, { useRef, useEffect, useCallback } from 'react';
import type { AudioEngine } from '../audio/AudioEngine';

interface VisualizerProps {
  engine: AudioEngine | null;
  mode: 'oscilloscope' | 'spectrum';
  width?: number;
  height?: number;
  color?: string;
}

const Visualizer: React.FC<VisualizerProps> = ({
  engine, mode, width = 400, height = 120, color = '#00d4ff',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !engine) {
      animRef.current = requestAnimationFrame(draw);
      return;
    }
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    // Background gradient
    const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
    bgGrad.addColorStop(0, 'rgba(10, 10, 15, 0.6)');
    bgGrad.addColorStop(1, 'rgba(10, 10, 15, 0.9)');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // Grid lines
    ctx.strokeStyle = 'rgba(30, 30, 42, 0.5)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 5; i++) {
      const y = (height / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    for (let i = 0; i < 8; i++) {
      const x = (width / 7) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    if (mode === 'oscilloscope') {
      const data = engine.getTimeDomainData();
      const sliceWidth = width / data.length;

      // Glow effect
      ctx.shadowBlur = 8;
      ctx.shadowColor = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();

      for (let i = 0; i < data.length; i++) {
        const x = i * sliceWidth;
        const y = (1 - data[i]) * height * 0.5;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Fill below
      ctx.shadowBlur = 0;
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      const fillGrad = ctx.createLinearGradient(0, 0, 0, height);
      fillGrad.addColorStop(0, `${color}15`);
      fillGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = fillGrad;
      ctx.fill();
    } else {
      const data = engine.getFrequencyData();
      const barCount = 64;
      const binsPerBar = Math.floor(data.length / barCount);
      const barWidth = width / barCount - 1;

      for (let i = 0; i < barCount; i++) {
        let sum = 0;
        for (let j = 0; j < binsPerBar; j++) {
          sum += data[i * binsPerBar + j];
        }
        const avg = sum / binsPerBar;
        const barHeight = (avg / 255) * height * 0.9;

        const x = i * (barWidth + 1);
        const y = height - barHeight;

        const grad = ctx.createLinearGradient(x, height, x, y);
        grad.addColorStop(0, `${color}40`);
        grad.addColorStop(0.5, `${color}90`);
        grad.addColorStop(1, color);

        ctx.fillStyle = grad;
        ctx.shadowBlur = 3;
        ctx.shadowColor = `${color}40`;
        ctx.fillRect(x, y, barWidth, barHeight);
      }
      ctx.shadowBlur = 0;
    }

    // Border glow
    ctx.strokeStyle = `${color}20`;
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, width, height);

    animRef.current = requestAnimationFrame(draw);
  }, [engine, mode, width, height, color]);

  useEffect(() => {
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height }}
      className="rounded-md"
    />
  );
};

export default Visualizer;
