import { notFound, redirect } from 'next/navigation';
import {
  AUDIT_IP_DAYS,
  bridgeSetup,
  dataProcessors,
  isLegalPage,
  legalPages,
  offeredNetworks,
  operatorDetails,
  type LegalPage,
  type Operator,
} from '@postwerk/core';
import { getMessages } from '@/lib/i18n-server';
import { siteName } from '@/lib/legal';
import { commonMessages } from '@/messages/common';
import { legalMessages } from '@/messages/legal';

type Texts = (typeof legalMessages)['en'];

const GOOGLE_PRIVACY = 'https://policies.google.com/privacy';
const YOUTUBE_TERMS = 'https://www.youtube.com/t/terms';
const GOOGLE_PERMISSIONS = 'https://myaccount.google.com/permissions';

export async function generateMetadata({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  const [t, common] = await Promise.all([getMessages(legalMessages), getMessages(commonMessages)]);
  return isLegalPage(page) ? { title: common.title(t.titles[page]) } : {};
}

export default async function LegalPageView({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  if (!isLegalPage(page)) notFound();
  const entry = legalPages()[page];
  if (!entry) notFound();
  if (!entry.builtIn) redirect(entry.href);
  const operator = operatorDetails()!;
  const t = await getMessages(legalMessages);
  const views: Record<LegalPage, React.ReactNode> = {
    privacy: <Privacy t={t} operator={operator} />,
    terms: <Terms t={t} operator={operator} />,
    imprint: <Imprint t={t} operator={operator} />,
    'data-deletion': <DataDeletion t={t} operator={operator} />,
  };
  return (
    <>
      <h1>{t.titles[page]}</h1>
      {views[page]}
    </>
  );
}

function Mail({ email }: { email: string }) {
  return <a href={`mailto:${email}`}>{email}</a>;
}

function Address({ operator }: { operator: Operator }) {
  return (
    <address>
      <strong>{operator.name}</strong>
      {operator.address.map((line) => (
        <span key={line}>
          <br />
          {line}
        </span>
      ))}
    </address>
  );
}

function Contact({ t, operator }: { t: Texts; operator: Operator }) {
  return (
    <p>
      {t.contactLine} <Mail email={operator.email} />.
    </p>
  );
}

/** Networks offered here, grouped by privacy policy (LinkedIn profile and page share one). */
function networkPolicies() {
  const groups = new Map<string, string[]>();
  let mastodon = false;
  for (const { info } of offeredNetworks()) {
    if (!info.privacyUrl) {
      mastodon ||= info.id === 'mastodon';
      continue;
    }
    groups.set(info.privacyUrl, [...(groups.get(info.privacyUrl) ?? []), info.name]);
  }
  return { groups: [...groups].map(([url, names]) => ({ url, names: names.join(', ') })), mastodon };
}

const offers = (id: string) => offeredNetworks().some(({ info }) => info.id === id);

function Privacy({ t, operator }: { t: Texts; operator: Operator }) {
  const text = t.privacy;
  const { groups, mastodon } = networkPolicies();
  const processors = dataProcessors();
  const bridged = offeredNetworks()
    .filter((network) => network.viaBridge)
    .map(({ info }) => info.name)
    .join(', ');
  const deletion = legalPages()['data-deletion'];
  return (
    <>
      <p>{text.intro(siteName)}</p>
      <section className="stack-sm">
        <h2>{text.controller}</h2>
        <Address operator={operator} />
        <p>
          <Mail email={operator.email} />
        </p>
      </section>
      <section className="stack-sm">
        <h2>{text.stored}</h2>
        <ul>
          <li>{text.account}</li>
          <li>{text.content}</li>
          <li>{text.accounts}</li>
          <li>{text.security(AUDIT_IP_DAYS)}</li>
          <li>{text.cookies}</li>
          <li>{text.emails}</li>
        </ul>
      </section>
      {(groups.length > 0 || mastodon) && (
        <section className="stack-sm">
          <h2>{text.networks}</h2>
          <p>{text.networksIntro}</p>
          <ul>
            {groups.map((group) => (
              <li key={group.url}>
                {group.names}: <a href={group.url}>{text.privacyPolicy}</a>
              </li>
            ))}
            {mastodon && <li>{text.mastodon}</li>}
          </ul>
          {offers('youtube') && (
            <p>
              {text.youtube} <a href={GOOGLE_PRIVACY}>{text.googlePrivacy}</a> · <a href={YOUTUBE_TERMS}>{text.youtubeTerms}</a> ·{' '}
              <a href={GOOGLE_PERMISSIONS}>{text.googlePermissions}</a>
            </p>
          )}
        </section>
      )}
      {processors.length > 0 && (
        <section className="stack-sm">
          <h2>{text.processors}</h2>
          <p>{text.processorsIntro}</p>
          <ul>
            {processors.map((processor) => (
              <li key={processor.kind}>
                {processor.kind === 'bridge' ? text.processor.bridge({ name: processor.name, networks: bridged }) : text.processor[processor.kind](processor.name)}
                {processor.privacyUrl && (
                  <>
                    {' '}
                    <a href={processor.privacyUrl}>{text.privacyPolicy}</a>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="stack-sm">
        <h2>{text.retention}</h2>
        <p>{text.retentionText}</p>
      </section>
      <section className="stack-sm">
        <h2>{text.rights}</h2>
        <p>{text.rightsText}</p>
        <Contact t={t} operator={operator} />
        {deletion && (
          <p>
            <a href={deletion.href}>{text.deleteLink}</a>
          </p>
        )}
      </section>
    </>
  );
}

function Terms({ t, operator }: { t: Texts; operator: Operator }) {
  const text = t.terms;
  const sections: [string, string][] = [
    [text.service, text.serviceText],
    [text.account, text.accountText],
    [text.content, text.contentText],
    [text.liability, text.liabilityText],
    [text.ending, text.endingText],
    [text.changes, text.changesText],
  ];
  return (
    <>
      <p>{text.intro({ site: siteName, operator: operator.name })}</p>
      {sections.map(([title, body]) => (
        <section key={title} className="stack-sm">
          <h2>{title}</h2>
          <p>{body}</p>
          {title === text.content && offers('youtube') && (
            <p>
              {text.youtube} <a href={YOUTUBE_TERMS}>{t.privacy.youtubeTerms}</a>
            </p>
          )}
        </section>
      ))}
      <Contact t={t} operator={operator} />
    </>
  );
}

function Imprint({ t, operator }: { t: Texts; operator: Operator }) {
  return (
    <>
      <p>{t.imprint.intro}</p>
      <Address operator={operator} />
      <section className="stack-sm">
        <h2>{t.imprint.contact}</h2>
        <p>
          {t.imprint.email}: <Mail email={operator.email} />
          {operator.phone && (
            <>
              <br />
              {t.imprint.phone}: {operator.phone}
            </>
          )}
        </p>
      </section>
    </>
  );
}

function DataDeletion({ t, operator }: { t: Texts; operator: Operator }) {
  const text = t.deletion;
  const bridge = bridgeSetup()?.bridge.name;
  return (
    <>
      <p>{text.intro}</p>
      <section className="stack-sm">
        <h2>{text.disconnect}</h2>
        <p>
          {text.disconnectText}
          {bridge && ` ${text.bridge(bridge)}`}
        </p>
      </section>
      <section className="stack-sm">
        <h2>{text.atNetwork}</h2>
        <p>
          {text.atNetworkText}
          {(offers('youtube') || offers('google_business')) && (
            <>
              {' '}
              <a href={GOOGLE_PERMISSIONS}>{t.privacy.googlePermissions}</a>
            </>
          )}
        </p>
      </section>
      <section className="stack-sm">
        <h2>{text.everything}</h2>
        <p>
          {text.everythingText} <Mail email={operator.email} />
        </p>
      </section>
    </>
  );
}
