'use client';

import { useLocale } from '@/lib/i18n';
import { intlLocale } from '@/lib/locale';

/** Renders a timestamp in the viewer's time zone (the server does not know it). */
export function LocalTime({ iso }: { iso: string }) {
  const locale = useLocale();
  const formatted = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {formatted}
    </time>
  );
}
