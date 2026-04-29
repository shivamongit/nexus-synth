// Embed / integration layer.
// Supports:
//   1. ?embed=1 query param → compact layout (set via isEmbedded())
//   2. ?preset=<index> → auto-loads a preset on boot
//   3. window.postMessage API for host pages:
//        { type: 'nexus:noteOn', note, velocity }
//        { type: 'nexus:noteOff', note }
//        { type: 'nexus:loadPreset', index }
//        { type: 'nexus:panic' }
//        { type: 'nexus:setParam', section, key, value }
//   4. Emits events outbound:
//        { type: 'nexus:ready' }
//        { type: 'nexus:noteOn', note, velocity, source: 'midi' | 'ui' | 'host' }
//        { type: 'nexus:presetLoaded', index, name }

export type EmbedIncomingMessage =
  | { type: 'nexus:noteOn'; note: number; velocity?: number }
  | { type: 'nexus:noteOff'; note: number }
  | { type: 'nexus:loadPreset'; index: number }
  | { type: 'nexus:panic' }
  | { type: 'nexus:setParam'; section: string; key: string; value: number | string };

export type EmbedOutgoingMessage =
  | { type: 'nexus:ready'; version: string }
  | { type: 'nexus:noteOn'; note: number; velocity: number; source: 'midi' | 'ui' | 'host' }
  | { type: 'nexus:noteOff'; note: number; source: 'midi' | 'ui' | 'host' }
  | { type: 'nexus:presetLoaded'; index: number; name: string }
  | { type: 'nexus:panic' };

export function isEmbedded(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('embed') === '1' || params.get('embed') === 'true' || window.self !== window.top;
}

export function getBootPreset(): number | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const p = params.get('preset');
  if (p === null) return null;
  const n = parseInt(p, 10);
  return Number.isFinite(n) ? n : null;
}

export function listenHost(handler: (msg: EmbedIncomingMessage) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onMsg = (e: MessageEvent) => {
    const data = e.data;
    if (!data || typeof data !== 'object') return;
    if (typeof data.type !== 'string' || !data.type.startsWith('nexus:')) return;
    handler(data as EmbedIncomingMessage);
  };
  window.addEventListener('message', onMsg);
  return () => window.removeEventListener('message', onMsg);
}

export function postToHost(message: EmbedOutgoingMessage) {
  if (typeof window === 'undefined') return;
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(message, '*');
    }
    // Also dispatch on window so same-page listeners (web components) can react
    window.dispatchEvent(new CustomEvent(message.type, { detail: message }));
  } catch {}
}
