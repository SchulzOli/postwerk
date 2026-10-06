import { notFound } from 'next/navigation';
import { bridgeSetup, offeredNetworks, operatorDetails } from '@postwerk/core';
import { getMessages } from '@/lib/i18n-server';
import { siteName } from '@/lib/legal';
import { commonMessages } from '@/messages/common';
import { legalMessages } from '@/messages/legal';

export async function generateMetadata() {
  const [t, common] = await Promise.all([getMessages(legalMessages), getMessages(commonMessages)]);
  return { title: common.title(t.titles.about), description: t.about.how };
}

/**
 * The server's public home page: who runs it and what it does. The networks'
 * app reviews ask for such a page (with links to the privacy policy) as the
 * app's website.
 */
export default async function AboutPage() {
  const operator = operatorDetails();
  if (!operator) notFound();
  const t = await getMessages(legalMessages);
  const networks = offeredNetworks();
  const bridge = bridgeSetup()?.bridge.name ?? '';
  return (
    <>
      <h1>{siteName}</h1>
      <p>{t.about.intro({ site: siteName, operator: operator.name })}</p>
      <p>{t.about.how}</p>
      <section className="stack-sm">
        <h2>{t.about.networks}</h2>
        {networks.length === 0 ? (
          <p className="muted">{t.about.noNetworks}</p>
        ) : (
          <ul>
            {networks.map(({ info, viaBridge }) => (
              <li key={info.id}>
                {info.name}
                {viaBridge && <span className="muted"> · {t.about.viaBridge(bridge)}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <p>
        <a href="/login" className="button">
          {t.about.signIn}
        </a>
      </p>
      <p className="muted">
        {t.contactLine} <a href={`mailto:${operator.email}`}>{operator.email}</a>. {t.sourceCode}:{' '}
        <a href="https://github.com/SchulzOli/postwerk">github.com/SchulzOli/postwerk</a>
      </p>
    </>
  );
}
