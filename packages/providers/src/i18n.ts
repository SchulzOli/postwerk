/**
 * Languages of the UI and of the messages core produces. Browser-safe.
 *
 * Messages are plain objects per language: strings, or functions for text
 * with values. `defineMessages` makes sure German has every English message
 * with the same parameters.
 */

export const locales = ['en', 'de'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';

export const localeNames: Record<Locale, string> = { en: 'English', de: 'Deutsch' };

export const isLocale = (value: unknown): value is Locale => locales.includes(value as Locale);

/** The best supported language of an Accept-Language header, if any. */
export function matchLocale(header: string | null | undefined): Locale | undefined {
  const ranked = (header ?? '')
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((param) => param.trim()).find((param) => param.startsWith('q='));
      return { language: tag.trim().toLowerCase().split('-')[0], q: q ? Number(q.slice(2)) : 1 };
    })
    .filter((entry) => entry.language && entry.q > 0)
    .sort((a, b) => b.q - a.q);
  return ranked.map((entry) => entry.language).find(isLocale);
}

export type Messages = Record<string, unknown>;
export type Catalog<T extends Messages> = Record<Locale, T>;

/** Message types with literal strings widened ("Draft" → string), so other languages fit. */
export type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => Widen<R>
    : T extends Record<string, unknown>
      ? { [K in keyof T]: Widen<T[K]> }
      : T;

export function defineMessages<T extends Messages>(catalog: { en: T; de: NoInfer<Widen<T>> }): Catalog<Widen<T>> {
  return catalog as Catalog<Widen<T>>;
}

/**
 * An error whose message can be shown in any language. `message` is the
 * English text (for logs); the UI calls `localize(locale)`.
 */
export class LocalizedError extends Error {
  constructor(
    private readonly render: (locale: Locale) => string,
    options?: { cause?: unknown },
  ) {
    super(render('en'), options);
    this.name = new.target.name;
  }

  localize(locale: Locale): string {
    return this.render(locale);
  }
}

/** The text of any error in a language: localized when it can be, else its message. */
export function errorText(error: unknown, locale: Locale): string {
  return error instanceof LocalizedError ? error.localize(locale) : (error as Error).message;
}

/** "a, b and c" / "a, b und c". */
export function joinList(items: string[], locale: Locale): string {
  return new Intl.ListFormat(locale, { type: 'conjunction' }).format(items);
}
