import { getMessages } from '@/lib/i18n-server';
import { legalLinks } from '@/lib/legal';
import { legalMessages } from '@/messages/legal';

/** Links to the server's about and legal pages (only those that are set up). */
export async function LegalFooter() {
  const links = legalLinks();
  if (links.length === 0) return null;
  const t = await getMessages(legalMessages);
  return (
    <footer className="legal-footer">
      {links.map((link) => (
        <a key={link.page} href={link.href}>
          {t.links[link.page]}
        </a>
      ))}
    </footer>
  );
}
