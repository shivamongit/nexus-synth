/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        nexus: {
          bg: '#0a0a0f',
          surface: '#111118',
          panel: '#16161f',
          border: '#1e1e2a',
          accent: '#00d4ff',
          'accent-dim': '#00a5c7',
          warm: '#ff6b35',
          green: '#00ff88',
          pink: '#ff2d7b',
          text: '#e0e0e8',
          'text-dim': '#6b6b80',
          'text-muted': '#3a3a4a',
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        display: ['Outfit', 'sans-serif'],
      },
      boxShadow: {
        'glow': '0 0 20px rgba(0, 212, 255, 0.15)',
        'glow-accent': '0 0 30px rgba(0, 212, 255, 0.25)',
        'glow-warm': '0 0 20px rgba(255, 107, 53, 0.15)',
        'inner-glow': 'inset 0 0 20px rgba(0, 212, 255, 0.05)',
      }
    },
  },
  plugins: [],
}
