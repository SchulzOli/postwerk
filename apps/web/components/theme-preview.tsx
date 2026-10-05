import type { CSSProperties } from 'react';
import { modeTokens, type ThemeManifest } from '@postwerk/core/theme';

const tints = ['network', 'account', 'flow', 'step', 'composer', 'posts', 'plugin'];

/** A miniature of the canvas drawn with the theme's own tokens (its extra CSS only applies once it is in use). */
function Swatch({ theme, mode }: { theme: ThemeManifest; mode: 'light' | 'dark' }) {
  const style = Object.fromEntries(Object.entries(modeTokens(theme, mode)).map(([name, value]) => [`--${name}`, value])) as CSSProperties;
  return (
    <div className="swatch theme-scope" style={style} role="img" aria-label={`${theme.name} in ${mode} mode`}>
      {theme.canvas.pattern !== 'none' && <span className={`swatch-grid swatch-${theme.canvas.pattern}`} />}
      <span className="swatch-mode" aria-hidden>{mode === 'light' ? '☀' : '☾'}</span>
      <span className="swatch-title">{theme.name}</span>
      <span className="swatch-card">
        <span className="dot dot-connected" /> Post <span className="swatch-muted">· 9:30</span>
      </span>
      <span className="swatch-button">Publish</span>
      <span className="swatch-tints">
        {tints.map((tint) => (
          <span key={tint} style={{ background: `var(--tint-${tint})` }} />
        ))}
      </span>
    </div>
  );
}

export function ThemePreview({ theme, large = false }: { theme: ThemeManifest; large?: boolean }) {
  return (
    <div className={large ? 'theme-previews theme-previews-lg' : 'theme-previews'}>
      <Swatch theme={theme} mode="light" />
      <Swatch theme={theme} mode="dark" />
    </div>
  );
}
