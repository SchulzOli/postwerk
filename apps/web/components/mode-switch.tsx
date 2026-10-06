'use client';

import { useState } from 'react';
import type { ColorMode } from '@postwerk/core/theme';
import { MODE_COOKIE } from '@/lib/color-mode';
import { useMessages } from '@/lib/i18n';
import { commonMessages } from '@/messages/common';

const options: { mode: ColorMode; icon: string }[] = [
  { mode: 'light', icon: '☀' },
  { mode: 'system', icon: '◐' },
  { mode: 'dark', icon: '☾' },
];

/** Light / system / dark. Applies instantly and is remembered in this browser. */
export function ModeSwitch({ mode, onChange }: { mode: ColorMode; onChange?(mode: ColorMode): void }) {
  const [current, setCurrent] = useState(mode);
  const t = useMessages(commonMessages).mode;
  function choose(next: ColorMode) {
    setCurrent(next);
    document.documentElement.dataset.mode = next;
    document.cookie = `${MODE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    onChange?.(next);
  }
  return (
    <div className="mode-switch" role="radiogroup" aria-label={t.label}>
      {options.map((option) => (
        <button
          key={option.mode}
          type="button"
          role="radio"
          aria-checked={current === option.mode}
          aria-label={t[option.mode]}
          title={t[option.mode]}
          onClick={() => choose(option.mode)}
        >
          {option.icon}
        </button>
      ))}
    </div>
  );
}
