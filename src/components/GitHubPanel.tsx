import React from 'react';
import { GITHUB_REPO } from '../lib/config';

const GitHubPanel: React.FC = () => (
  <div className="github-panel">
    <div className="github-panel-inner">
      <p className="pl-eyebrow">Open source</p>
      <h2 className="github-title">Nexus Synth on GitHub</h2>
      <p className="github-desc">
        Voice-to-MIDI, stem tracing, dual-filter synth, and step sequencer — all in the browser.
        Star the repo, report issues, or contribute.
      </p>
      <div className="github-actions">
        <a
          href={GITHUB_REPO}
          target="_blank"
          rel="noopener noreferrer"
          className="github-btn github-btn-primary"
        >
          View repository
        </a>
        <a
          href={`${GITHUB_REPO}/issues`}
          target="_blank"
          rel="noopener noreferrer"
          className="github-btn"
        >
          Issues
        </a>
      </div>
      <p className="github-hint">
        Track Rack stem separation (Demucs) runs as a local Python worker — not bundled on Render static deploy.
        Audio → MIDI works fully in the cloud.
      </p>
    </div>
  </div>
);

export default GitHubPanel;
