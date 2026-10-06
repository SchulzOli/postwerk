import Link from 'next/link';
import { localeNames } from '@postwerk/core/i18n';
import { setLocaleAction } from '@/app/actions/locale';
import { LegalFooter } from '@/components/legal-footer';
import { getLocale } from '@/lib/i18n-server';

/** Public pages about the server (about, privacy, terms, imprint, data deletion): readable without signing in. */
export default async function LegalLayout({ children }: { children: React.ReactNode }) {
  const other = (await getLocale()) === 'de' ? 'en' : 'de';
  return (
    <div className="legal">
      <header className="row-tight">
        <Link href="/" className="brand grow">
          Postwerk
        </Link>
        <form action={setLocaleAction.bind(null, other)}>
          <button type="submit" className="link small-link" lang={other}>
            {localeNames[other]}
          </button>
        </form>
      </header>
      <main className="legal-page stack">{children}</main>
      <LegalFooter />
    </div>
  );
}
