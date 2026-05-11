import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
      },
      colors: {
        bg:     { DEFAULT: '#080A0C', panel: '#0D1117', row: '#111620' },
        border: { DEFAULT: 'rgba(255,255,255,0.07)', strong: 'rgba(255,255,255,0.14)' },
        tx:     { DEFAULT: '#E2E8F0', muted: '#64748B', faint: '#334155' },
        bid:    { DEFAULT: '#22C55E', dim: 'rgba(34,197,94,0.12)' },
        ask:    { DEFAULT: '#EF4444', dim: 'rgba(239,68,68,0.12)' },
        amber:  { DEFAULT: '#F59E0B', dim: 'rgba(245,158,11,0.15)' },
        violet: { DEFAULT: '#8B5CF6', dim: 'rgba(139,92,246,0.15)' },
        sky:    { DEFAULT: '#38BDF8', dim: 'rgba(56,189,248,0.12)' },
      },
      animation: {
        'pulse-fast': 'pulse 0.8s cubic-bezier(0.4,0,0.6,1) infinite',
        'flash-bid': 'flash-bid 0.4s ease-out',
        'flash-ask': 'flash-ask 0.4s ease-out',
      },
      keyframes: {
        'flash-bid': { '0%': { backgroundColor: 'rgba(34,197,94,0.35)' }, '100%': { backgroundColor: 'transparent' } },
        'flash-ask': { '0%': { backgroundColor: 'rgba(239,68,68,0.35)' }, '100%': { backgroundColor: 'transparent' } },
      },
    },
  },
  plugins: [],
};

export default config;
