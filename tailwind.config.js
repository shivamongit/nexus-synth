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
          bg: '#03050a',
          surface: '#0b121a',
          panel: '#0c121c',
          border: '#163044',
          accent: '#00f0ff',
          'accent-dim': '#00a8b8',
          warm: '#ff6b35',
          green: '#3dffb0',
          pink: '#ff2d7b',
          text: '#e8f6ff',
          'text-dim': '#7a93a8',
          'text-muted': '#4d6478',
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        display: ['Oxanium', 'Outfit', 'sans-serif'],
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
