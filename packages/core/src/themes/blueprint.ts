import type { ThemeManifest } from '../theme';

/** A technical drawing: drafting grid, monospace labels, square corners and right-angled connections. */
export const blueprint: ThemeManifest = {
  kind: 'theme',
  id: 'blueprint',
  name: 'Blueprint',
  version: '1.1.0',
  author: 'Postwerk',
  description: 'Your publishing plan as a technical drawing: drafting grid, monospace labels, square corners and right-angled connections.',
  base: {
    font: '"IBM Plex Sans", "Segoe UI", system-ui, -apple-system, sans-serif',
    'font-heading': '"IBM Plex Mono", "JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace',
    'font-mono': '"IBM Plex Mono", "JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace',
    radius: '2px',
    'radius-card': '3px',
    'radius-region': '0px',
    shadow: 'none',
  },
  light: {
    bg: '#eef3f9',
    canvas: '#f4f8fc',
    surface: '#ffffff',
    text: '#0f2a47',
    muted: '#4d6684',
    border: '#b8cbe0',
    accent: '#1d5fbf',
    'accent-text': '#ffffff',
    success: '#0f7a55',
    warn: '#b25e00',
    error: '#c81e3a',
    'tint-network': '#1d5fbf',
    'tint-account': '#0f8b8d',
    'tint-flow': '#c27400',
    'tint-step': '#7048b8',
    'tint-composer': '#b8327a',
    'tint-posts': '#2b7bb9',
    'tint-plugin': '#4a5f78',
    grid: 'rgb(29 95 191 / 0.12)',
    edge: '#5d83b3',
    field: '#f6f9fc',
    'region-bg': 'rgb(255 255 255 / 0.45)',
    'shadow-lg': '0 0 0 1px rgb(29 95 191 / 0.18), 0 12px 28px rgb(15 42 71 / 0.12)',
    line: 'rgb(29 95 191 / 0.55)',
  },
  dark: {
    bg: '#0a2342',
    canvas: '#0c2a4f',
    surface: '#0f3160',
    text: '#e8f2ff',
    muted: '#9bb7d8',
    border: '#2a5487',
    accent: '#7cc7ff',
    'accent-text': '#04172e',
    success: '#6ee0b0',
    warn: '#ffc670',
    error: '#ff8a9a',
    'tint-network': '#7cc7ff',
    'tint-account': '#63e2d3',
    'tint-flow': '#ffcf6e',
    'tint-step': '#c5a5ff',
    'tint-composer': '#ff9fd0',
    'tint-posts': '#8fb8ff',
    'tint-plugin': '#b8c9dd',
    grid: 'rgb(173 216 255 / 0.11)',
    edge: '#8dbbe8',
    field: '#0b2a52',
    'region-bg': 'rgb(15 49 96 / 0.35)',
    'shadow-lg': '0 0 0 1px rgb(124 199 255 / 0.2), 0 16px 36px rgb(0 0 0 / 0.4)',
    line: 'rgb(124 199 255 / 0.55)',
  },
  canvas: { pattern: 'lines', gap: 24, size: 1, edges: 'step' },
  css: `
.brand { font-family: var(--font-heading); text-transform: uppercase; letter-spacing: 0.14em; font-size: 1rem; }
.region { border: 1.5px solid var(--line); }
.region header { margin: 0 24px; padding: 18px 0 10px; border-bottom: 1px solid var(--line); }
.region h2 { font-size: 24px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.14em; }
.region p { font-family: var(--font-mono); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
.region::after {
  position: absolute; right: 0; bottom: 0; padding: 6px 14px;
  border-top: 1px solid var(--line); border-left: 1px solid var(--line);
  font: 11px var(--font-mono); letter-spacing: 0.12em; color: var(--muted);
}
.region-networks::after { content: "POSTWERK · SHEET 1 / 8"; }
.region-accounts::after { content: "POSTWERK · SHEET 2 / 8"; }
.region-compose::after { content: "POSTWERK · SHEET 3 / 8"; }
.region-posts::after { content: "POSTWERK · SHEET 4 / 8"; }
.region-team::after { content: "POSTWERK · SHEET 5 / 8"; }
.region-flows::after { content: "POSTWERK · SHEET 6 / 8"; }
.region-plugins::after { content: "POSTWERK · SHEET 7 / 8"; }
.region-calendar::after { content: "POSTWERK · SHEET 8 / 8"; }
.world-card strong, .world-panel > header, .inspector h2, .inspector h3, .flow-name { font-family: var(--font-mono); }
.world-card strong { font-size: 12.5px; text-transform: uppercase; letter-spacing: 0.06em; }
button:where(:not(.link)), .button { font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.78rem; }
.is-selected { outline: 1.5px dashed var(--accent); outline-offset: 4px; }
.flow-frame { border: 1.5px dashed var(--line); background: var(--region-bg); }
`,
};
