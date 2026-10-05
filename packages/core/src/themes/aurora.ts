import type { ThemeManifest } from '../theme';

/** Frosted glass over soft northern-lights gradients, with rounded type and gradient accents. */
export const aurora: ThemeManifest = {
  kind: 'theme',
  id: 'aurora',
  name: 'Aurora',
  version: '1.0.0',
  author: 'Postwerk',
  description: 'Frosted glass over soft northern-lights gradients. Rounded type, gradient buttons and a glow on whatever you select.',
  base: {
    font: '"Inter", "SF Pro Text", system-ui, -apple-system, "Segoe UI", sans-serif',
    'font-heading': 'ui-rounded, "SF Pro Rounded", "Nunito", "Quicksand", "Varela Round", system-ui, sans-serif',
    radius: '12px',
    'radius-card': '18px',
    'radius-region': '32px',
    canvas: 'transparent',
  },
  light: {
    bg: '#f6f4ff',
    backdrop:
      'radial-gradient(55% 60% at 8% 0%, rgb(167 139 250 / 0.38), transparent 70%), radial-gradient(45% 50% at 95% 8%, rgb(244 114 182 / 0.26), transparent 70%), radial-gradient(60% 55% at 60% 105%, rgb(45 212 191 / 0.24), transparent 70%)',
    surface: 'rgb(255 255 255 / 0.74)',
    text: '#1e1b3a',
    muted: '#67648a',
    border: 'rgb(124 58 237 / 0.16)',
    accent: '#7c3aed',
    'accent-2': '#db2777',
    'accent-text': '#ffffff',
    success: '#059669',
    warn: '#d97706',
    error: '#e11d48',
    'tint-network': '#6366f1',
    'tint-account': '#14b8a6',
    'tint-flow': '#f59e0b',
    'tint-step': '#f97316',
    'tint-composer': '#ec4899',
    'tint-posts': '#0ea5e9',
    'tint-plugin': '#a855f7',
    grid: 'rgb(99 102 241 / 0.22)',
    edge: 'rgb(124 58 237 / 0.45)',
    field: 'rgb(255 255 255 / 0.62)',
    'region-bg': 'rgb(255 255 255 / 0.3)',
    shadow: '0 1px 2px rgb(76 29 149 / 0.06), 0 6px 20px rgb(76 29 149 / 0.08)',
    'shadow-lg': '0 20px 50px rgb(76 29 149 / 0.18)',
    glow: 'rgb(124 58 237 / 0.16)',
  },
  dark: {
    bg: '#0c0a1d',
    backdrop:
      'radial-gradient(55% 60% at 8% 0%, rgb(124 58 237 / 0.36), transparent 70%), radial-gradient(45% 50% at 95% 8%, rgb(219 39 119 / 0.22), transparent 70%), radial-gradient(60% 55% at 60% 105%, rgb(13 148 136 / 0.26), transparent 70%)',
    surface: 'rgb(28 24 56 / 0.74)',
    text: '#ece9ff',
    muted: '#a19dc8',
    border: 'rgb(167 139 250 / 0.2)',
    accent: '#a78bfa',
    'accent-2': '#f472b6',
    'accent-text': '#14082e',
    success: '#34d399',
    warn: '#fbbf24',
    error: '#fb7185',
    'tint-network': '#818cf8',
    'tint-account': '#2dd4bf',
    'tint-flow': '#fbbf24',
    'tint-step': '#fb923c',
    'tint-composer': '#f472b6',
    'tint-posts': '#38bdf8',
    'tint-plugin': '#c084fc',
    grid: 'rgb(167 139 250 / 0.16)',
    edge: 'rgb(167 139 250 / 0.5)',
    field: 'rgb(12 10 29 / 0.55)',
    'region-bg': 'rgb(28 24 56 / 0.32)',
    shadow: '0 1px 2px rgb(0 0 0 / 0.3), 0 8px 24px rgb(0 0 0 / 0.35)',
    'shadow-lg': '0 24px 60px rgb(0 0 0 / 0.55)',
    glow: 'rgb(167 139 250 / 0.24)',
  },
  canvas: { pattern: 'dots', gap: 28, size: 1.6, edges: 'bezier' },
  css: `
h1, h2, .brand { font-weight: 800; letter-spacing: -0.02em; }
.brand, .region h2 {
  background: linear-gradient(90deg, var(--accent), var(--accent-2));
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.region { border: 1px solid var(--border); }
.world-toolbar, .world-account, .world-notice, .inspector, .world-panel {
  -webkit-backdrop-filter: blur(18px) saturate(1.5); backdrop-filter: blur(18px) saturate(1.5);
}
button:where(:not(.secondary, .link, .icon-button)), .button:where(:not(.secondary)) {
  background-image: linear-gradient(135deg, var(--accent), var(--accent-2));
  border-color: transparent;
  box-shadow: 0 6px 18px -8px var(--accent);
}
.is-selected { outline: 2px solid var(--accent); outline-offset: 2px; box-shadow: 0 0 0 8px var(--glow), var(--shadow); }
.flow-frame { border-color: var(--border); }
`,
};
