import type { Locale } from '@postwerk/core/i18n';

/** Cookie that remembers the language for visitors who are not signed in (and follows the user's choice). */
export const LOCALE_COOKIE = 'postwerk_locale';

/**
 * The locale for dates and numbers: the browser's regional variant of the UI
 * language when it has one (en-GB keeps its 24-hour clock), else the language.
 */
export function intlLocale(locale: Locale): string {
  if (typeof navigator === 'undefined') return locale;
  return navigator.languages?.find((tag) => tag.toLowerCase().split('-')[0] === locale) ?? locale;
}
