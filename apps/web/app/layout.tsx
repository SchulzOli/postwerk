import type { Metadata } from 'next';
import { themeCss } from '@postwerk/core/theme';
import { getAppearance } from '@/lib/appearance';
import { LocaleProvider } from '@/lib/i18n';
import { getLocale } from '@/lib/i18n-server';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: 'Postwerk',
    description: locale === 'de' ? 'Social-Media-Beiträge an einem Ort planen und veröffentlichen.' : 'Plan and publish social media posts from one place.',
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [{ mode, theme }, locale] = await Promise.all([getAppearance(), getLocale()]);
  return (
    <html lang={locale} data-mode={mode} data-theme={theme?.id}>
      <head>
        {/* After the base stylesheet, so theme CSS wins ties. Validated on install: no "<", no remote URLs. */}
        {theme && <style id="postwerk-theme">{themeCss(theme)}</style>}
      </head>
      <body>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
