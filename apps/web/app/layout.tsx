import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Postwerk',
  description: 'Plan and publish social media posts from one place.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
