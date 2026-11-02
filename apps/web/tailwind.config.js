export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {
    colors: {
      navy: { DEFAULT: '#101B33', hover: '#1E2D4F' }, electric: { DEFAULT: '#356DFF', hover: '#2558E5' },
      accent: '#19C6D8', muted: '#718096', canvas: '#F5F7FB', ink: '#17243B', tint: '#EFF4FF',
      ok: { DEFAULT: '#16A36A', bg: '#E8F7F0' }, warn: { DEFAULT: '#F0A52B', bg: '#FEF6EA' },
      bad: { DEFAULT: '#E34D59', bg: '#FDF0F1', deep: '#BA1A1A', hover: '#CF3945' },
    },
    fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'], mono: ['JetBrains Mono', 'ui-monospace', 'monospace'] },
    boxShadow: {
      l1: '0px 2px 8px -2px rgba(16,27,51,.04), 0px 1px 3px -1px rgba(16,27,51,.02)',
      l2: '0px 8px 24px -4px rgba(16,27,51,.08), 0px 2px 6px -1px rgba(16,27,51,.04)',
      l3: '0px 20px 48px -8px rgba(16,27,51,.18), 0px 4px 12px -2px rgba(16,27,51,.06)',
      glow: '0px 0px 12px rgba(53,109,255,.35)',
    },
  } },
};
