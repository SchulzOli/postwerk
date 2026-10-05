import { describe, expect, it } from 'vitest';
import { builtinThemes, parseThemeManifest, requiredTokens, ThemeError, themeCss, type ThemeManifest } from '../src/theme';

const colors = Object.fromEntries(requiredTokens.map((name) => [name, '#123456']));
const minimal = { kind: 'theme', id: 'mine', name: 'Mine', light: colors, dark: colors };

function rejects(patch: Record<string, unknown>, message: RegExp) {
  expect(() => parseThemeManifest({ ...minimal, ...patch })).toThrow(ThemeError);
  expect(() => parseThemeManifest({ ...minimal, ...patch })).toThrow(message);
}

describe('built-in themes', () => {
  it('ships three valid themes that survive a round trip unchanged', () => {
    expect(builtinThemes.map((theme) => theme.id)).toEqual(['aurora', 'paper', 'blueprint']);
    for (const theme of builtinThemes) {
      expect(parseThemeManifest(JSON.stringify(theme))).toEqual({ ...theme, css: theme.css.trim() });
    }
  });

  it('produce a stylesheet for every theme', () => {
    for (const theme of builtinThemes) expect(themeCss(theme)).toContain(`:root[data-theme="${theme.id}"]`);
  });
});

describe('parseThemeManifest', () => {
  it('accepts a minimal theme and fills in defaults', () => {
    const theme = parseThemeManifest(minimal);
    expect(theme).toMatchObject({ id: 'mine', version: '1.0.0', author: 'Unknown', description: '', base: {}, css: '' });
    expect(theme.canvas).toEqual({ pattern: 'dots', gap: 24, size: 1.2, edges: 'smoothstep' });
  });

  it('accepts JSON text and tokens written with a leading --', () => {
    const theme = parseThemeManifest(JSON.stringify({ ...minimal, base: { '--radius': '4px' } }));
    expect(theme.base).toEqual({ radius: '4px' });
  });

  it('explains invalid JSON and wrong kinds', () => {
    expect(() => parseThemeManifest('{ nope')).toThrow(/not valid JSON/);
    rejects({ kind: 'widget' }, /Only theme plugins/);
    rejects({ id: 'Not OK!' }, /lowercase letters/);
    rejects({ name: '' }, /Add a “name”/);
  });

  it('requires every color in both modes', () => {
    const { accent: _, ...withoutAccent } = colors;
    rejects({ dark: withoutAccent }, /“dark” is missing “accent”/);
    // Shared colors may live in base instead.
    expect(parseThemeManifest({ ...minimal, base: { accent: '#000' }, dark: withoutAccent }).base.accent).toBe('#000');
  });

  it('rejects tokens that only exist in one mode', () => {
    rejects({ light: { ...colors, glow: 'red' } }, /“light.glow” has no dark value/);
  });

  it('rejects token values that could escape their declaration', () => {
    rejects({ base: { bg: 'red; } body { color: red' } }, /single CSS value/);
    rejects({ base: { bg: 'rgb(0 0 0' } }, /single CSS value/);
    rejects({ base: { bg: 'red /* hi' } }, /single CSS value/);
    rejects({ base: { bg: '</style><script>' } }, /“<”/);
    rejects({ base: { bg: 'url(https://example.com/x.png)' } }, /data: URLs/);
    rejects({ base: { 'Bad Name': 'red' } }, /not a valid token name/);
  });

  it('keeps extra CSS self-contained', () => {
    rejects({ css: '@import "https://example.com/x.css";' }, /cannot import/);
    rejects({ css: 'body { background: url(https://example.com/track.gif) }' }, /data: URLs/);
    rejects({ css: "body { background: url( 'http://example.com' ) }" }, /data: URLs/);
    rejects({ css: 'input[value^="a"] { background-image: image-set("https://example.com/a" 1x) }' }, /url\(data/);
    rejects({ css: 'body { background: u\\72l(https://example.com) }' }, /backslash/);
    rejects({ css: '</style><script>alert(1)</script>' }, /“<”/);
    rejects({ css: 'a { color: red' }, /unbalanced/);
    expect(parseThemeManifest({ ...minimal, css: '.region { background: url("data:image/png;base64,AAAA") }' }).css).toContain('data:image/png');
  });

  it('drops comments so nothing hides inside them', () => {
    expect(parseThemeManifest({ ...minimal, css: '/* note */ .x { color: red }' }).css).toBe('.x { color: red }');
    rejects({ css: '.x { background: ur/**/l(https://example.com) }' }, /data: URLs/);
  });

  it('validates canvas options', () => {
    rejects({ canvas: { pattern: 'stripes' } }, /canvas.pattern/);
    rejects({ canvas: { gap: 9000 } }, /canvas.gap/);
    expect(parseThemeManifest({ ...minimal, canvas: { edges: 'step' } }).canvas.edges).toBe('step');
  });
});

describe('themeCss', () => {
  const theme: ThemeManifest = parseThemeManifest({
    ...minimal,
    base: { radius: '3px' },
    light: { ...colors, bg: '#fff' },
    dark: { ...colors, bg: '#000' },
    css: '.region { border-width: 3px; }',
  });
  const css = themeCss(theme);

  it('sets light tokens by default and dark tokens for dark or system-dark', () => {
    expect(css).toContain(':root[data-theme="mine"]{--radius:3px;');
    expect(css).toMatch(/:root\[data-theme="mine"\]\{[^}]*--bg:#fff;[^}]*color-scheme:light;\}/);
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\)\{:root\[data-theme="mine"\]:not\(\[data-mode="light"\]\)\{[^}]*--bg:#000;/);
    expect(css).toMatch(/:root\[data-theme="mine"\]\[data-mode="dark"\]\{[^}]*--radius:3px;[^}]*--bg:#000;[^}]*color-scheme:dark;\}/);
  });

  it('appends the theme CSS', () => {
    expect(css.endsWith('.region { border-width: 3px; }')).toBe(true);
  });
});
