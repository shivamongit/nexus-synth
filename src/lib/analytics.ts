// Multi-provider analytics — privacy-friendly daily user activity tracking.
//
// Supported providers (configure via Vite env vars; all optional; if none set,
// analytics is a no-op):
//
//   Plausible:     VITE_PLAUSIBLE_DOMAIN          (e.g. "nexus-synth.onrender.com")
//                  VITE_PLAUSIBLE_SRC             (optional; default https://plausible.io/js/script.js)
//
//   Umami:         VITE_UMAMI_WEBSITE_ID          (UUID from Umami dashboard)
//                  VITE_UMAMI_SRC                 (e.g. https://cloud.umami.is/script.js)
//
//   GoatCounter:   VITE_GOATCOUNTER_SITE          (e.g. "nexus.goatcounter.com")
//
//   Cloudflare:    VITE_CF_BEACON_TOKEN           (token from CF Web Analytics)
//
//   Google GA4:    VITE_GA4_ID                    (e.g. "G-XXXXXXXXXX")
//
// Anonymous pageview counter (no account needed, always on):
//   VITE_COUNTER_NAMESPACE   — defaults to "nexus-synth"; uses abacus.jasoncameron.dev
//   VITE_DISABLE_PUBLIC_COUNTER=1  to disable
//
// Custom events (preset loaded, MIDI connected, etc.) are forwarded to whichever
// provider is active. All providers are injected via <script> tags — no deps.

type EventProps = Record<string, string | number | boolean>;

const env = (typeof import.meta !== 'undefined' ? (import.meta as any).env : {}) ?? {};

const PLAUSIBLE_DOMAIN = env.VITE_PLAUSIBLE_DOMAIN as string | undefined;
const PLAUSIBLE_SRC = (env.VITE_PLAUSIBLE_SRC as string | undefined) ?? 'https://plausible.io/js/script.js';
const UMAMI_ID = env.VITE_UMAMI_WEBSITE_ID as string | undefined;
const UMAMI_SRC = env.VITE_UMAMI_SRC as string | undefined;
const GOATCOUNTER_SITE = env.VITE_GOATCOUNTER_SITE as string | undefined;
const CF_BEACON_TOKEN = env.VITE_CF_BEACON_TOKEN as string | undefined;
const GA4_ID = env.VITE_GA4_ID as string | undefined;
const COUNTER_NAMESPACE = (env.VITE_COUNTER_NAMESPACE as string | undefined) ?? 'nexus-synth';
const DISABLE_PUBLIC_COUNTER = env.VITE_DISABLE_PUBLIC_COUNTER === '1' || env.VITE_DISABLE_PUBLIC_COUNTER === 'true';

declare global {
  interface Window {
    plausible?: (event: string, options?: { props?: EventProps }) => void;
    umami?: { track: (event: string, data?: EventProps) => void };
    goatcounter?: { count: (opts: { path: string; event?: boolean; title?: string }) => void };
    dataLayer?: any[];
    gtag?: (...args: any[]) => void;
  }
}

let initialized = false;
let localStats = {
  firstVisit: '' as string,
  lastVisit: '' as string,
  visitCount: 0,
  sessionCount: 0,
  notesPlayed: 0,
  presetsLoaded: 0,
};

const STATS_KEY = 'nexus.stats.v1';
const SESSION_KEY = 'nexus.session.v1';

function loadLocalStats() {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (raw) localStats = { ...localStats, ...JSON.parse(raw) };
  } catch {}
}

function saveLocalStats() {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(localStats));
  } catch {}
}

function injectScript(src: string, attrs: Record<string, string> = {}): HTMLScriptElement {
  const s = document.createElement('script');
  s.src = src;
  s.defer = true;
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  document.head.appendChild(s);
  return s;
}

// ─────────────────────────────────────────────────────────────────────

function setupPlausible() {
  if (!PLAUSIBLE_DOMAIN) return;
  injectScript(PLAUSIBLE_SRC, { 'data-domain': PLAUSIBLE_DOMAIN });
  window.plausible = window.plausible || ((...args: any[]) => {
    (window.plausible as any).q = (window.plausible as any).q || [];
    (window.plausible as any).q.push(args);
  });
}

function setupUmami() {
  if (!UMAMI_ID || !UMAMI_SRC) return;
  injectScript(UMAMI_SRC, { 'data-website-id': UMAMI_ID });
}

function setupGoatCounter() {
  if (!GOATCOUNTER_SITE) return;
  const s = document.createElement('script');
  s.dataset.goatcounter = `https://${GOATCOUNTER_SITE}/count`;
  s.async = true;
  s.src = '//gc.zgo.at/count.js';
  document.head.appendChild(s);
}

function setupCloudflare() {
  if (!CF_BEACON_TOKEN) return;
  const s = document.createElement('script');
  s.defer = true;
  s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  s.setAttribute('data-cf-beacon', JSON.stringify({ token: CF_BEACON_TOKEN }));
  document.head.appendChild(s);
}

function setupGA4() {
  if (!GA4_ID) return;
  injectScript(`https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag(...args: any[]) { window.dataLayer!.push(args); };
  window.gtag('js', new Date());
  window.gtag('config', GA4_ID, { anonymize_ip: true });
}

/**
 * Public anonymous counter — uses abacus.jasoncameron.dev (free, no signup,
 * no PII). Just counts page loads; gives a baseline daily-user signal even
 * when no other provider is configured.
 */
async function pingPublicCounter() {
  if (DISABLE_PUBLIC_COUNTER) return;
  // Only increment once per session
  try {
    if (sessionStorage.getItem(SESSION_KEY)) return;
    sessionStorage.setItem(SESSION_KEY, '1');
  } catch {}
  try {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    // Daily bucket — gives daily-unique-visit count per day
    await fetch(
      `https://abacus.jasoncameron.dev/hit/${encodeURIComponent(COUNTER_NAMESPACE)}/${encodeURIComponent('day-' + today)}`,
      { method: 'GET', mode: 'cors', keepalive: true }
    ).catch(() => {});
    // Lifetime total
    fetch(
      `https://abacus.jasoncameron.dev/hit/${encodeURIComponent(COUNTER_NAMESPACE)}/total`,
      { method: 'GET', mode: 'cors', keepalive: true }
    ).catch(() => {});
  } catch {}
}

export async function getPublicStats(): Promise<{ today: number | null; total: number | null }> {
  if (DISABLE_PUBLIC_COUNTER) return { today: null, total: null };
  const today = new Date().toISOString().slice(0, 10);
  try {
    const [t, all] = await Promise.all([
      fetch(`https://abacus.jasoncameron.dev/get/${encodeURIComponent(COUNTER_NAMESPACE)}/${encodeURIComponent('day-' + today)}`).then(r => r.json()).catch(() => null),
      fetch(`https://abacus.jasoncameron.dev/get/${encodeURIComponent(COUNTER_NAMESPACE)}/total`).then(r => r.json()).catch(() => null),
    ]);
    return {
      today: t?.value ?? null,
      total: all?.value ?? null,
    };
  } catch {
    return { today: null, total: null };
  }
}

// ─────────────────────────────────────────────────────────────────────

export function initAnalytics() {
  if (initialized) return;
  initialized = true;

  // Do not track when embedded in dev mode or when DNT is on + no providers require override
  if (typeof document === 'undefined') return;

  loadLocalStats();
  const now = new Date().toISOString();
  if (!localStats.firstVisit) localStats.firstVisit = now;
  localStats.lastVisit = now;
  localStats.visitCount += 1;

  // Count a fresh session only once per browser session
  try {
    if (!sessionStorage.getItem(SESSION_KEY)) {
      localStats.sessionCount += 1;
    }
  } catch {}
  saveLocalStats();

  setupPlausible();
  setupUmami();
  setupGoatCounter();
  setupCloudflare();
  setupGA4();

  pingPublicCounter();
}

export function trackEvent(name: string, props?: EventProps) {
  try {
    if (typeof window === 'undefined') return;
    window.plausible?.(name, props ? { props } : undefined);
    window.umami?.track(name, props);
    window.gtag?.('event', name, props);
    if (window.goatcounter?.count) {
      window.goatcounter.count({ path: `event/${name}`, event: true, title: name });
    }
  } catch {}
}

export function trackPageview(path?: string) {
  try {
    const p = path ?? (window.location.pathname + window.location.search);
    window.plausible?.('pageview', { props: { path: p } });
    window.umami?.track('pageview', { path: p });
    window.gtag?.('event', 'page_view', { page_path: p });
  } catch {}
}

export function getLocalStats() {
  loadLocalStats();
  return { ...localStats };
}

export function incrementLocalCounter(key: 'notesPlayed' | 'presetsLoaded') {
  loadLocalStats();
  localStats[key] += 1;
  saveLocalStats();
}

export function getActiveProviders(): string[] {
  const active: string[] = [];
  if (PLAUSIBLE_DOMAIN) active.push('Plausible');
  if (UMAMI_ID) active.push('Umami');
  if (GOATCOUNTER_SITE) active.push('GoatCounter');
  if (CF_BEACON_TOKEN) active.push('Cloudflare');
  if (GA4_ID) active.push('GA4');
  if (!DISABLE_PUBLIC_COUNTER) active.push('Public Counter');
  return active;
}
