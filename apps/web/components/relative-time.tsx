'use client';

import type { Locale } from '@postwerk/core/i18n';
import { useLocale } from '@/lib/i18n';
import { intlLocale } from '@/lib/locale';

const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400_000],
  ['month', 30 * 86_400_000],
  ['week', 7 * 86_400_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

export function relativeTime(iso: string, locale: Locale, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  const format = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: 'auto' });
  for (const [unit, ms] of units) if (Math.abs(diff) >= ms) return format.format(Math.round(diff / ms), unit);
  return format.format(0, 'minute');
}

/** "5 minutes ago", with the exact time on hover. */
export function RelativeTime({ iso }: { iso: string }) {
  const locale = useLocale();
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString(intlLocale(locale))} suppressHydrationWarning>
      {relativeTime(iso, locale)}
    </time>
  );
}
