import type { Config } from 'tailwindcss';

// The "terminal" design system. Dense, dark, monospaced — Bloomberg-adjacent.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        term: {
          bg: '#0a0e14', // near-black canvas
          panel: '#111722', // panel surface
          border: '#1c2534', // hairline borders
          muted: '#5b6b82', // secondary text
          text: '#c7d2e0', // primary text
          up: '#26d07c', // price up
          down: '#ff5470', // price down
          accent: '#f5a623', // amber highlight
          live: '#26d07c',
        },
      },
      fontFamily: {
        mono: [
          'JetBrains Mono',
          'IBM Plex Mono',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
      keyframes: {
        flashUp: {
          '0%': { backgroundColor: 'rgba(38, 208, 124, 0.35)' },
          '100%': { backgroundColor: 'transparent' },
        },
        flashDown: {
          '0%': { backgroundColor: 'rgba(255, 84, 112, 0.35)' },
          '100%': { backgroundColor: 'transparent' },
        },
        pulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
      },
      animation: {
        flashUp: 'flashUp 0.5s ease-out',
        flashDown: 'flashDown 0.5s ease-out',
        pulse: 'pulse 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
