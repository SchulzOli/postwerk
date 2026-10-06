'use client';

import { createContext, useContext } from 'react';
import type { Catalog, Locale, Messages } from '@postwerk/core/i18n';

const LocaleContext = createContext<Locale>('en');

export function LocaleProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/** A catalog's messages in the UI language: `const t = useMessages(postsMessages)`. */
export function useMessages<T extends Messages>(catalog: Catalog<T>): T {
  return catalog[useLocale()];
}
