'use client';

import { useState } from 'react';
import type { ColorMode } from '@postwerk/core/theme';
import { MODE_COOKIE } from '@/lib/color-mode';

const options: { mode: ColorMode; label: string; icon: string }[] = [
  { mode: 'light', label: 'Light', icon: '☀' },
  { mode: 'system', label: 'Same as system', icon: '◐' },
  { mode: 'dark', label: 'Dark', icon: '☾' },
];

/** Light / system / dark. Applies instantly and is remembered in this browser. */
export function ModeSwitch({ mode, onChange }: { mode: ColorMode; onChange?(mode: ColorMode): void }) {
  const [current, setCurrent] = useState(mode);
  function choose(next: ColorMode) {
    setCurrent(next);
    document.documentElement.dataset.mode = next;
    document.cookie = `${MODE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    onChange?.(next);
  }
  return (
    <div className="mode-switch" role="radiogroup" aria-label="Color mode">
      {options.map((option) => (
        <button
          key={option.mode}
          type="button"
          role="radio"
          aria-checked={current === option.mode}
          aria-label={option.label}
          title={option.label}
          onClick={() => choose(option.mode)}
        >
          {option.icon}
        </button>
      ))}
    </div>
  );
}
