/** A calendar day ("2026-11-02") in the reader's language; days have no time zone, so it is formatted in UTC. */
export function formatDay(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
}
