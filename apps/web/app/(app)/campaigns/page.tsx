import Link from 'next/link';
import { formatMoney, listCampaigns } from '@maas/core';
import { getDb } from '@maas/db';
import { NewCampaignForm } from '@/components/campaign-forms';
import { formatDay } from '@/lib/dates';
import { getLocale, getMessages } from '@/lib/i18n-server';
import { requireSession } from '@/lib/session';
import { campaignsMessages } from '@/messages/campaigns';
import { commonMessages } from '@/messages/common';

export async function generateMetadata() {
  const [t, common] = await Promise.all([getMessages(campaignsMessages), getMessages(commonMessages)]);
  return { title: common.title(t.pageTitle) };
}

export default async function CampaignsPage() {
  const { workspace } = await requireSession();
  const [campaigns, t, locale] = await Promise.all([listCampaigns(getDb(), workspace.id), getMessages(campaignsMessages), getLocale()]);
  const day = (value: string | null) => (value ? formatDay(value, locale) : '…');

  return (
    <div className="stack-lg">
      <h1>{t.pageTitle}</h1>
      <p className="muted">{t.intro}</p>

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
    </div>
  );
}
