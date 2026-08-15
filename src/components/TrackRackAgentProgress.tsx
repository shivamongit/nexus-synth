import React from 'react';
import type { StemKind } from '../audio/analysis/stemTypes';
import { STEM_LABELS, STEM_ORDER } from '../audio/analysis/stemTypes';
import type { TrackRackProgressUpdate } from '../audio/analysis/stemPipeline';

type StepStatus = 'pending' | 'active' | 'done';

interface AgentStep {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;
}

function stepStatus(pct: number, start: number, end: number): StepStatus {
  if (pct >= end) return 'done';
  if (pct >= start) return 'active';
  return 'pending';
}

function stemStepStatus(
  kind: StemKind,
  pct: number,
  stemTrace?: Partial<Record<StemKind, number>>,
): StepStatus {
  if (pct >= 1) return 'done';
  if (pct < 0.45) return 'pending';
  const stemPct = stemTrace?.[kind] ?? 0;
  if (stemPct >= 1) return 'done';
  if (stemPct > 0) return 'active';
  const firstOpen = STEM_ORDER.find((k) => (stemTrace?.[k] ?? 0) < 1);
  return firstOpen === kind ? 'active' : 'pending';
}

function buildSteps(update: TrackRackProgressUpdate): AgentStep[] {
  const { pct, label, detail, stemTrace } = update;
  const steps: AgentStep[] = [
    {
      id: 'decode',
      label: 'Decode audio file',
      status: stepStatus(pct, 0, 0.08),
      detail: pct < 0.08 ? (detail ?? label) : undefined,
    },
    {
      id: 'separate',
      label: 'Separate stems (Demucs)',
      status: stepStatus(pct, 0.08, 0.42),
      detail: pct >= 0.08 && pct < 0.42 ? (detail ?? label) : undefined,
    },
    {
      id: 'model',
      label: 'Load MIDI trace model',
      status: stepStatus(pct, 0.42, 0.45),
    },
  ];

  for (const kind of STEM_ORDER) {
    const status = stemStepStatus(kind, pct, stemTrace);
    const stemPct = stemTrace?.[kind] ?? 0;
    steps.push({
      id: `trace-${kind}`,
      label: `Trace ${STEM_LABELS[kind]} → MIDI`,
      status,
      detail: status === 'active' && stemPct > 0 ? `${Math.round(stemPct * 100)}%` : undefined,
    });
  }

  steps.push({
    id: 'done',
    label: 'Ready',
    status: pct >= 1 ? 'done' : 'pending',
    detail: pct >= 1 ? detail : undefined,
  });

  return steps;
}

interface Props {
  progress: TrackRackProgressUpdate;
  onStop: () => void;
}

const TrackRackAgentProgress: React.FC<Props> = ({ progress, onStop }) => {
  const steps = buildSteps(progress);
  const pct = Math.round(progress.pct * 100);

  return (
    <div className="tr-agent" role="status" aria-live="polite">
      <div className="tr-agent-head">
        <div className="tr-agent-avatar" aria-hidden>
          <span className="tr-agent-pulse" />
          <span className="tr-agent-core">◈</span>
        </div>
        <div className="tr-agent-head-text">
          <span className="tr-agent-title">Processing</span>
          <span className="tr-agent-sub">{progress.detail ?? progress.label}</span>
        </div>
        <span className="tr-agent-pct">{pct}%</span>
      </div>

      <div className="tr-agent-bar">
        <div className="tr-agent-bar-fill" style={{ width: `${pct}%` }} />
      </div>

      <ol className="tr-agent-steps">
        {steps.map((step) => (
          <li key={step.id} className={`tr-agent-step tr-agent-step--${step.status}`}>
            <span className="tr-agent-step-icon" aria-hidden>
              {step.status === 'done' ? '✓' : step.status === 'active' ? '●' : '○'}
            </span>
            <span className="tr-agent-step-label">{step.label}</span>
            {step.detail && step.status === 'active' && (
              <span className="tr-agent-step-detail">{step.detail}</span>
            )}
          </li>
        ))}
      </ol>

      <button type="button" className="pl-btn tr-stop-btn tr-agent-stop" onClick={onStop}>
        Stop
      </button>
    </div>
  );
};

export default TrackRackAgentProgress;
