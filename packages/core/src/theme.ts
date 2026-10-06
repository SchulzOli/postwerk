/**
 * Theme plugins: a theme is a JSON manifest that sets the app's design tokens
 * (CSS variables) for light and dark mode, a few canvas options and optional
 * extra CSS. Pure and browser-safe so the install panel can preview themes.
 *
 * Themes are self-contained: they cannot load files from other sites (no
 * remote url(), @import or fonts), so a theme can never track or leak data.
 * Format reference: docs/themes.md.
 */

import { LocalizedError } from './i18n';
import { themeMessages, type UnsafeReason } from './messages';

export type ColorMode = 'system' | 'light' | 'dark';
export const colorModes: ColorMode[] = ['light', 'system', 'dark'];

export type CanvasPattern = 'dots' | 'lines' | 'cross' | 'none';
export type EdgeStyle = 'smoothstep' | 'bezier' | 'step' | 'straight';

export interface ThemeCanvas {
  pattern: CanvasPattern;
  /** Distance between grid dots/lines in px. */
  gap: number;
  /** Dot size or line width in px. */
  size: number;
  /** How connections between canvas nodes are drawn. */
  edges: EdgeStyle;
}

/** CSS variable name (without "--") → value. */
export type ThemeTokens = Record<string, string>;

export interface ThemeManifest {
  kind: 'theme';
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  /** Tokens shared by both modes (fonts, radii…). */
  base: ThemeTokens;
  light: ThemeTokens;
  dark: ThemeTokens;
  canvas: ThemeCanvas;
  /** Extra CSS, applied while the theme is active. Use tokens for anything that differs per mode. */
  css: string;
}

/** Colors every theme sets for both modes (in light and dark, or shared in base). */
export const requiredTokens = [
  'bg',
  'surface',
  'text',
  'muted',
  'border',
  'accent',
  'accent-text',
  'success',
  'warn',
  'error',
  'tint-network',
  'tint-account',
  'tint-flow',
  'tint-step',
  'tint-composer',
  'tint-posts',
  'tint-plugin',
] as const;

export const defaultCanvas: ThemeCanvas = { pattern: 'dots', gap: 24, size: 1.2, edges: 'smoothstep' };

export class ThemeError extends LocalizedError {
  constructor(pick: (m: (typeof themeMessages)['en']) => string) {
    super((locale) => pick(themeMessages[locale]));
  }
}

const ID = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const TOKEN_NAME = /^[a-z][a-z0-9-]{0,47}$/;
const MAX = { manifest: 300_000, css: 200_000, token: 400, tokens: 120 };
const patterns: CanvasPattern[] = ['dots', 'lines', 'cross', 'none'];
const edgeStyles: EdgeStyle[] = ['smoothstep', 'bezier', 'step', 'straight'];

/** Anything that could fetch from another site, run script or break out of the <style> element. */
const UNSAFE: [RegExp, UnsafeReason][] = [
  [/</, 'lessThan'],
  [/\\/, 'backslash'],
  [/@import|@namespace/i, 'import'],
  [/url\(\s*(?!["']?data:)/i, 'remoteUrl'],
  [/image-set\(|(?:^|[^a-z0-9_-])src\(/i, 'fileReference'],
  [/expression\(|javascript:|-moz-binding|behavior\s*:/i, 'script'],
];

function unsafeReason(css: string): UnsafeReason | undefined {
  return UNSAFE.find(([pattern]) => pattern.test(css))?.[1];
}

function balanced(value: string): boolean {
  let depth = 0;
  for (const char of value) {
    if (char === '(') depth++;
    else if (char === ')' && --depth < 0) return false;
  }
  return depth === 0 && (value.match(/"/g)?.length ?? 0) % 2 === 0 && (value.match(/'/g)?.length ?? 0) % 2 === 0;
}

function text(value: unknown, field: string, max: number, fallback?: string): string {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result) {
    if (fallback !== undefined) return fallback;
    throw new ThemeError((m) => m.add(field));
  }
  if (result.length > max) throw new ThemeError((m) => m.tooLong({ field, max }));
  return result;
}

function tokens(value: unknown, field: string): ThemeTokens {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ThemeError((m) => m.tokensObject(field));
  const entries = Object.entries(value);
  if (entries.length > MAX.tokens) throw new ThemeError((m) => m.tooManyTokens({ field, max: MAX.tokens }));
  const result: ThemeTokens = {};
  for (const [rawName, rawValue] of entries) {
    const name = rawName.replace(/^--/, '');
    if (!TOKEN_NAME.test(name)) throw new ThemeError((m) => m.tokenName(`${field}.${rawName}`));
    if (typeof rawValue !== 'string' && typeof rawValue !== 'number') throw new ThemeError((m) => m.cssValue(`${field}.${name}`));
    const css = String(rawValue).trim();
    if (!css || css.length > MAX.token) throw new ThemeError((m) => m.cssValueLength({ name: `${field}.${name}`, max: MAX.token }));
    if (/[;{}@]|\/\*/.test(css) || !balanced(css)) throw new ThemeError((m) => m.singleValue(`${field}.${name}`));
    const unsafe = unsafeReason(css);
    if (unsafe) throw new ThemeError((m) => m.unsafe({ name: `${field}.${name}`, reason: unsafe }));
    result[name] = css;
  }
  return result;
}

function canvas(value: unknown): ThemeCanvas {
  if (value === undefined) return { ...defaultCanvas };
  if (!value || typeof value !== 'object') throw new ThemeError((m) => m.canvasObject);
  const input = value as Record<string, unknown>;
  const pick = <T extends string>(key: string, allowed: T[], fallback: T): T => {
    if (input[key] === undefined) return fallback;
    if (!allowed.includes(input[key] as T)) throw new ThemeError((m) => m.canvasChoice({ key, allowed: allowed.join(', ') }));
    return input[key] as T;
  };
  const number = (key: string, min: number, max: number, fallback: number): number => {
    if (input[key] === undefined) return fallback;
    const n = Number(input[key]);
    if (!Number.isFinite(n) || n < min || n > max) throw new ThemeError((m) => m.canvasNumber({ key, min, max }));
    return n;
  };
  return {
    pattern: pick('pattern', patterns, defaultCanvas.pattern),
    gap: number('gap', 4, 200, defaultCanvas.gap),
    size: number('size', 0.2, 10, defaultCanvas.size),
    edges: pick('edges', edgeStyles, defaultCanvas.edges),
  };
}

function stylesheet(value: unknown): string {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string') throw new ThemeError((m) => m.cssString);
  if (value.length > MAX.css) throw new ThemeError((m) => m.cssTooLong(MAX.css / 1000));
  // Comments are dropped before checking, so nothing can hide inside them.
  const css = value.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const unsafe = unsafeReason(css);
  if (unsafe) throw new ThemeError((m) => m.unsafe({ name: 'css', reason: unsafe }));
  let depth = 0;
  for (const char of css) {
    if (char === '{') depth++;
    else if (char === '}' && --depth < 0) break;
  }
  if (depth !== 0) throw new ThemeError((m) => m.cssUnbalanced);
  return css;
}

/**
 * Validates a theme manifest (an object or its JSON text) and returns it in
 * canonical form. Throws ThemeError with a message meant for the user.
 */
export function parseThemeManifest(input: unknown): ThemeManifest {
  let raw = input;
  if (typeof input === 'string') {
    if (input.length > MAX.manifest) throw new ThemeError((m) => m.tooBig(MAX.manifest / 1000));
    try {
      raw = JSON.parse(input);
    } catch (error) {
      throw new ThemeError((m) => m.notJson((error as Error).message));
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ThemeError((m) => m.notObject);
  const manifest = raw as Record<string, unknown>;
  if (manifest.kind !== 'theme') throw new ThemeError((m) => m.onlyThemes);

  const id = text(manifest.id, 'id', 40);
  if (!ID.test(id)) throw new ThemeError((m) => m.idFormat);
  const base = tokens(manifest.base, 'base');
  const light = tokens(manifest.light, 'light');
  const dark = tokens(manifest.dark, 'dark');

  // Every theme works in both modes: whatever one mode sets, the other must set too.
  const modes = [
    ['light', light, dark, 'dark'],
    ['dark', dark, light, 'light'],
  ] as const;
  for (const [mode, own] of modes) {
    const missing = requiredTokens.filter((name) => !(name in base) && !(name in own));
    if (missing.length) throw new ThemeError((m) => m.missing({ mode, names: missing.map((name) => `“${name}”`).join(', ') }));
  }
  for (const [mode, own, other, otherName] of modes) {
    const unmatched = Object.keys(own).find((name) => !(name in other) && !(name in base));
    if (unmatched) throw new ThemeError((m) => m.unmatched({ mode, name: unmatched, other: otherName }));
  }

  return {
    kind: 'theme',
    id,
    name: text(manifest.name, 'name', 40),
    version: text(manifest.version, 'version', 20, '1.0.0'),
    author: text(manifest.author, 'author', 60, 'Unknown'),
    description: text(manifest.description, 'description', 300, ''),
    base,
    light,
    dark,
    canvas: canvas(manifest.canvas),
    css: stylesheet(manifest.css),
  };
}

const declarations = (tokens: ThemeTokens, scheme: 'light' | 'dark') =>
  `${Object.entries(tokens)
    .map(([name, value]) => `--${name}:${value};`)
    .join('')}color-scheme:${scheme};`;

/** The tokens a theme sets in one mode (base merged in). */
export function modeTokens(theme: ThemeManifest, mode: 'light' | 'dark'): ThemeTokens {
  return { ...theme.base, ...theme[mode] };
}

/**
 * The stylesheet for an active theme. `<html data-mode>` picks the mode:
 * "light" or "dark" force one, anything else follows the system setting.
 */
export function themeCss(theme: ThemeManifest): string {
  const root = `:root[data-theme="${theme.id}"]`;
  const dark = declarations(modeTokens(theme, 'dark'), 'dark');
  const css = [
    `${root}{${declarations(modeTokens(theme, 'light'), 'light')}}`,
    `@media (prefers-color-scheme: dark){${root}:not([data-mode="light"]){${dark}}}`,
    `${root}[data-mode="dark"]{${dark}}`,
    theme.css,
  ].join('\n');
  // Manifests are validated on install; this guards against anything stored before a rule existed.
  return unsafeReason(css) ? '' : css;
}

export { builtinThemes, builtinTheme } from './themes';
