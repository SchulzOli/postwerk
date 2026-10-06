import { localeNames } from '@postwerk/core/i18n';
import { setLocaleAction } from '@/app/actions/locale';
import { LegalFooter } from '@/components/legal-footer';
import { getLocale } from '@/lib/i18n-server';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const other = (await getLocale()) === 'de' ? 'en' : 'de';
  return (
    <main className="auth">
      <p className="brand">Postwerk</p>
      {children}
      <form action={setLocaleAction.bind(null, other)}>
        <button type="submit" className="link small-link" lang={other}>
          {localeNames[other]}
        </button>
      </form>
      <LegalFooter />
    </main>
  );
}
