/** GitHub repository — shown in nav & GitHub tab */
export const GITHUB_REPO = 'https://github.com/shivamongit/nexus-synth';

export const APP_NAME = 'NEXUS';

export const NAV_MODES = ['voice', 'tracks', 'synth', 'sequencer'] as const;
export type NavMode = (typeof NAV_MODES)[number];

export const NAV_LABELS: Record<NavMode, string> = {
  voice: 'Audio → MIDI',
  tracks: 'Track Rack',
  synth: 'Synth',
  sequencer: 'Sequencer',
};

/** True when deployed without a stem-separator backend (e.g. Render static site). */
export function isStemSeparationCloudDisabled(): boolean {
  return import.meta.env.PROD && !import.meta.env.VITE_STEM_API_URL;
}
