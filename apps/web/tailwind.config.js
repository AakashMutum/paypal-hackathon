// Every colour, radius, shadow and size comes from src/styles/tokens.css, so a theme change is a
// change of CSS variables and nothing in a component needs to know which theme is active.
const token = (name) => ({ opacityValue }) =>
  opacityValue === undefined
    ? `var(--${name})`
    : `color-mix(in srgb, var(--${name}) calc(${opacityValue} * 100%), transparent)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: token('bg'),
        surface: { DEFAULT: token('surface'), 2: token('surface-2') },
        line: { DEFAULT: token('border'), strong: token('border-strong') },
        content: token('text'),
        muted: token('muted'),
        navy: { DEFAULT: token('navy'), on: token('on-navy') },
        link: token('link'),
        brand: token('brand'),
        action: { DEFAULT: token('action'), hover: token('action-hover'), on: token('on-action') },
        success: { DEFAULT: token('success'), bg: token('success-bg') },
        warning: { DEFAULT: token('warn'), bg: token('warn-bg') },
        danger: { DEFAULT: token('danger'), bg: token('danger-bg') },
        focus: token('focus'),
        // Older class names, kept so screens not yet redesigned keep working in both themes.
        canvas: token('bg'),
        ink: token('text'),
        tint: token('surface-2'),
        electric: { DEFAULT: token('action'), hover: token('action-hover') },
        accent: token('action'),
        ok: { DEFAULT: token('success'), bg: token('success-bg') },
        warn: { DEFAULT: token('warn'), bg: token('warn-bg') },
        bad: { DEFAULT: token('danger'), bg: token('danger-bg'), deep: token('danger'), hover: token('danger') },
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'],
        // Only for domains, ids and amounts.
        mono: ['"JetBrains Mono Variable"', '"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        xs: ['var(--text-xs)', { lineHeight: '1.5' }],
        sm: ['var(--text-sm)', { lineHeight: '1.5' }],
        base: ['var(--text-base)', { lineHeight: '1.5' }],
        lg: ['var(--text-lg)', { lineHeight: '1.4' }],
        xl: ['var(--text-xl)', { lineHeight: '1.25' }],
        '2xl': ['var(--text-2xl)', { lineHeight: '1.15' }],
      },
      borderRadius: { sm: 'var(--radius-sm)', DEFAULT: 'var(--radius-sm)', md: 'var(--radius-md)', lg: 'var(--radius-md)', xl: 'var(--radius-lg)', '2xl': 'var(--radius-lg)' },
      boxShadow: { l1: 'var(--shadow-1)', l2: 'var(--shadow-2)', l3: 'var(--shadow-2)', glow: 'none' },
      transitionDuration: { fast: 'var(--motion-fast)', base: 'var(--motion-base)', DEFAULT: 'var(--motion-base)' },
      transitionTimingFunction: { DEFAULT: 'var(--ease)' },
    },
  },
};
