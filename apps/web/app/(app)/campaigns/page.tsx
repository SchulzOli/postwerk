import Link from 'next/link';
import { adsSetup, formatMoney, listAdAccounts, listCampaigns } from '@maas/core';
import { AD_PLATFORMS, DOCS_URL } from '@maas/providers';
import { getDb } from '@maas/db';
import { RemoveAdAccountButton } from '@/components/ad-editor';
import { NewCampaignForm } from '@/components/campaign-forms';
import { formatDay } from '@/lib/dates';
import { getLocale, getMessages } from '@/lib/i18n-server';
import { requireSession } from '@/lib/session';
import { adsMessages } from '@/messages/ads';
import { campaignsMessages } from '@/messages/campaigns';
import { commonMessages } from '@/messages/common';
import { startAdConnectAction } from './ad-actions';

export async function generateMetadata() {
  const [t, common] = await Promise.all([getMessages(campaignsMessages), getMessages(commonMessages)]);
  return { title: common.title(t.pageTitle) };
}

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { workspace, role } = await requireSession();
  const { notice, error } = await searchParams;
  const db = getDb();
  const [campaigns, adAccounts, t, a, locale] = await Promise.all([listCampaigns(db, workspace.id), listAdAccounts(db, workspace.id), getMessages(campaignsMessages), getMessages(adsMessages), getLocale()]);
  const setup = adsSetup();
  const canManage = role !== 'editor';
  const day = (value: string | null) => (value ? formatDay(value, locale) : '…');

  return (
    <div className="stack-lg">
      <h1>{t.pageTitle}</h1>
      <p className="muted">{t.intro}</p>
      {notice && <p className="success" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {campaigns.length === 0 ? (
        <div className="card">
          <p className="muted">{t.empty}</p>
        </div>
      ) : (
        <ul className="stack">
          {campaigns.map((campaign) => (
            <li key={campaign.id} className="card stack-sm">
              <div className="row">
                <Link href={`/campaigns/${campaign.id}`} className="campaign-name grow">{campaign.name}</Link>
                <span className={`badge campaign-${campaign.status}`}>{t.statuses[campaign.status]}</span>
              </div>
              {campaign.message && <p>{campaign.message}</p>}
              <p className="muted small">
                {t.goals[campaign.goal]} · {campaign.startsOn || campaign.endsOn ? t.dates(day(campaign.startsOn), day(campaign.endsOn)) : t.noDates} ·{' '}
                {t.counts(campaign.pieceCount, campaign.postCount)}
                {campaign.budgetCents > 0 && <> · {t.spentOf(formatMoney(campaign.spendCents, campaign.currency, locale), formatMoney(campaign.budgetCents, campaign.currency, locale))}</>}
              </p>
            </li>
          ))}
        </ul>
      )}

      <NewCampaignForm />

      <section className="card stack" id="ad-accounts">
        <h2>{a.accounts}</h2>
        <p className="muted">{a.accountsIntro}</p>
        {adAccounts.length === 0 ? (
          <p className="muted">{a.noAccounts}</p>
        ) : (
          <ul className="list">
            {adAccounts.map((account) => (
              <li key={account.id} className="row">
                <span className="grow">
                  <strong>{account.name}</strong>
                  <span className="muted">
                    {' '}
                    · {a.platforms[account.platform]} · {account.currency}
                    {account.test && ` · ${a.test}`}
                  </span>
                  {account.status === 'needs_reauth' && <span className="badge badge-warn">{a.reconnect}</span>}
                </span>
                {canManage && <RemoveAdAccountButton adAccountId={account.id} />}
              </li>
            ))}
          </ul>
        )}
        {canManage ? (
          <div className="row">
            {AD_PLATFORMS.map((platform) =>
              setup[platform] ? (
                <form key={platform} action={startAdConnectAction.bind(null, platform)}>
                  <button type="submit" className="secondary">{a.connect(a.platforms[platform])}</button>
                </form>
              ) : (
                <small key={platform} className="muted">
                  {a.notSetUp(a.platforms[platform])}{' '}
                  <a href={`${DOCS_URL}/marketing/ads#${platform === 'google_ads' ? 'set-up-google-ads' : 'set-up-meta-ads'}`} target="_blank" rel="noreferrer">{a.setupGuide}</a>
                </small>
              ),
            )}
          </div>
        ) : (
          <small className="muted">{a.adminsOnly}</small>
        )}
      </section>
    </div>
  );
}
