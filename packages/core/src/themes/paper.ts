import type { ThemeManifest } from '../theme';

/** Warm paper and ink: serif headings, index-card nodes, a quiet ruled canvas. */
export const paper: ThemeManifest = {
  kind: 'theme',
  id: 'paper',
  name: 'Paper',
  version: '1.0.0',
  author: 'Postwerk',
  description: 'Warm paper and ink. Serif headings, index-card nodes and a quietly ruled canvas — dark mode turns it into ink on charcoal.',
  base: {
    font: '"Avenir Next", Avenir, "Segoe UI", "Noto Sans", system-ui, sans-serif',
    'font-heading': '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", "Noto Serif", Georgia, serif',
    'font-mono': '"SF Mono", ui-monospace, Menlo, Consolas, monospace',
    radius: '6px',
    'radius-card': '10px',
    'radius-region': '18px',
  },
  light: {
    bg: '#f4efe6',
    surface: '#fffcf6',
    text: '#2a241c',
    muted: '#786c5c',
    border: '#e2d8c6',
    accent: '#b4532a',
    'accent-text': '#fffaf2',
    success: '#3d7a3a',
    warn: '#a65f00',
    error: '#b3261e',
    'tint-network': '#4a6a8a',
    'tint-account': '#4f7d5c',
    'tint-flow': '#c28a1e',
    'tint-step': '#b4532a',
    'tint-composer': '#8b5a86',
    'tint-posts': '#2f7c8a',
    'tint-plugin': '#6d5b9a',
    grid: 'rgb(120 100 70 / 0.1)',
    edge: '#b8a68a',
    field: '#fbf7ef',
    'region-bg': 'rgb(255 252 246 / 0.55)',
    shadow: '0 1px 0 rgb(80 60 30 / 0.05), 0 2px 6px rgb(80 60 30 / 0.06)',
    'shadow-lg': '0 12px 32px rgb(80 60 30 / 0.14)',
  },
  dark: {
    bg: '#1b1814',
    surface: '#25211b',
    text: '#efe7d8',
    muted: '#a89a85',
    border: '#3b342a',
    accent: '#e5946b',
    'accent-text': '#1e140e',
    success: '#93c98a',
    warn: '#e8b05c',
    error: '#f2897c',
    'tint-network': '#8fb0d4',
    'tint-account': '#8cc49b',
    'tint-flow': '#e6bd5c',
    'tint-step': '#e5946b',
    'tint-composer': '#c79bd0',
    'tint-posts': '#7fc4cf',
    'tint-plugin': '#a99be0',
    grid: 'rgb(239 231 216 / 0.06)',
    edge: '#6e6253',
    field: '#1f1c17',
    'region-bg': 'rgb(37 33 27 / 0.55)',
    shadow: '0 1px 0 rgb(0 0 0 / 0.25), 0 2px 8px rgb(0 0 0 / 0.25)',
    'shadow-lg': '0 16px 40px rgb(0 0 0 / 0.45)',
  },
  canvas: { pattern: 'lines', gap: 32, size: 1, edges: 'bezier' },
  css: `
h1, h2 { font-weight: 600; letter-spacing: -0.01em; }
.brand { font-family: var(--font-heading); font-style: italic; font-weight: 600; letter-spacing: 0; }
.region { border: 1px solid var(--border); box-shadow: var(--shadow); }
.region header { margin: 0 28px; padding: 18px 4px 8px; border-bottom: 1px solid var(--border); }
.region p { font-family: var(--font-heading); font-style: italic; }
.world-card { border-top: 3px solid var(--border); }
.network-node { border-top-color: var(--tint-network); }
.account-node { border-top-color: var(--tint-account); }
.plugin-node { border-top-color: var(--tint-plugin); }
.step-node { border-top-color: var(--tint-step); }
.step-trigger { border-top-color: var(--accent); }
.step-target { border-top-color: var(--tint-account); }
.flow-frame { border-style: dashed; }
.world-panel > header, .inspector h2 { font-family: var(--font-heading); font-size: 1.1rem; font-weight: 600; }
.is-selected { outline-offset: 3px; }
`,
};
