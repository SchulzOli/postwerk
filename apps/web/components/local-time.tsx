'use client';

/** Renders a timestamp in the viewer's time zone (the server does not know it). */
export function LocalTime({ iso }: { iso: string }) {
  const formatted = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {formatted}
    </time>
  );
}
