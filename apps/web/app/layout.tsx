import type { Metadata } from 'next';
import { themeCss } from '@postwerk/core/theme';
import { getAppearance } from '@/lib/appearance';
import './globals.css';

export const metadata: Metadata = {
  title: 'Postwerk',
  description: 'Plan and publish social media posts from one place.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { mode, theme } = await getAppearance();
  return (
    <html lang="en" data-mode={mode} data-theme={theme?.id}>
      <head>
        {/* After the base stylesheet, so theme CSS wins ties. Validated on install: no "<", no remote URLs. */}
        {theme && <style id="postwerk-theme">{themeCss(theme)}</style>}
      </head>
      <body>{children}</body>
    </html>
  );
}
