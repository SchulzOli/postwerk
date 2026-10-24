import Link from 'next/link';
import { listCampaigns, listMembers } from '@maas/core';
import { listStudioRuns, studioSetup } from '@maas/core/studio';
import { getDb } from '@maas/db';
import { DOCS_URL } from '@maas/providers';
import { LocalTime } from '@/components/local-time';
import { StudioForm } from '@/components/studio-form';
import { getLocale, getMessages } from '@/lib/i18n-server';
import { requireSession } from '@/lib/session';
import { campaignsMessages } from '@/messages/campaigns';
import { commonMessages } from '@/messages/common';
import { studioMessages } from '@/messages/studio';

export async function generateMetadata() {
  const [t, common] = await Promise.all([getMessages(studioMessages), getMessages(commonMessages)]);
  return { title: common.title(t.pageTitle) };
}

export default async function StudioPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { workspace } = await requireSession();
  const { campaign } = await searchParams;
  const db = getDb();
  const [campaigns, runs, members, t, c, locale] = await Promise.all([
    listCampaigns(db, workspace.id),
    listStudioRuns(db, workspace.id),
    listMembers(db, workspace.id),
    getMessages(studioMessages),
    getMessages(campaignsMessages),
    getLocale(),
  ]);
  const setup = studioSetup();
  const open = campaigns.filter((item) => item.status !== 'done' || item.id === campaign);
  const nameOf = new Map(members.map((member) => [member.userId, member.name]));
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);

  return (
    <div className="stack-lg">
      <h1>{t.pageTitle}</h1>
      <p className="muted">{t.intro}</p>

      {!setup ? (
        <div className="card stack-sm">
          <p>{t.off}</p>
          <a href={`${DOCS_URL}/marketing/ai-studio#turn-it-on`} target="_blank" rel="noreferrer">{t.setupGuide}</a>
        </div>
      ) : open.length === 0 ? (
        <div className="card stack-sm">
          <p>{t.noCampaign}</p>
          <Link href="/campaigns" className="button secondary">{t.toCampaigns}</Link>
        </div>
      ) : (
        <>
          <p className="muted small">
            {t.brandTip} <Link href="/brand">{t.toBrand}</Link>
          </p>
          <StudioForm campaigns={open.map((item) => ({ id: item.id, name: item.name }))} campaignId={open.some((item) => item.id === campaign) ? campaign : undefined} language={locale} model={setup.model} />
        </>
      )}

      {runs.length > 0 && (
        <section className="stack">
          <h2>{t.runs}</h2>
          <ul className="stack">
            {runs.map(({ run, campaignName, pieces }) => (
              <li key={run.id} className="card stack-sm">
                <div className="row">
                  <Link href={`/campaigns/${run.campaignId}`} className="campaign-name grow">{campaignName}</Link>
                  <span className="muted small">
                    <LocalTime iso={run.createdAt.toISOString()} />
                    {run.createdBy && nameOf.get(run.createdBy) && <> · {t.by(nameOf.get(run.createdBy)!)}</>}
                  </span>
                </div>
                {run.notes && <p className="muted small clip">{run.notes}</p>}
                {run.pieceIds.length > 0 && (
                  <div className="stack-sm">
                    <strong className="small">{t.pieces}</strong>
                    <ul className="list">
                      {pieces.map((piece) => (
                        <li key={piece.id} className="row">
                          <Link href={`/campaigns/${run.campaignId}/pieces/${piece.id}`} className="grow piece-link">{piece.title}</Link>
                          <span className="muted small">{c.formats[piece.format] ?? piece.format}</span>
                        </li>
                      ))}
                      {pieces.length < run.pieceIds.length && <li className="muted small">+ {run.pieceIds.length - pieces.length} {t.deleted}</li>}
                    </ul>
                  </div>
                )}
                {run.postIdeas.length > 0 && (
                  <div className="stack-sm">
                    <strong className="small">{t.postIdeas}</strong>
                    <ul className="list">
                      {run.postIdeas.map((idea, index) => (
                        <li key={index} className="stack-sm">
                          <p className="post-idea">{idea}</p>
                          <Link href={`/posts/new?${new URLSearchParams({ campaign: run.campaignId, text: idea })}`} className="small-link">{t.writePost}</Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {run.failures.length > 0 && (
                  <div className="stack-sm">
                    <strong className="small">{t.failed}</strong>
                    <ul className="list">
                      {run.failures.map((failure) => (
                        <li key={failure.format} className="small">
                          {failure.format === 'posts' ? t.posts : (c.formats[failure.format.split(':')[1]!] ?? failure.format)}: <span className="muted">{t.reasons[failure.reason] ?? t.reasons.failed}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <small className="muted">
                  {run.model} · {t.tokens(number(run.usage.inputTokens + run.usage.cacheReadTokens + run.usage.cacheWriteTokens), number(run.usage.outputTokens), number(run.usage.cacheReadTokens))}
                </small>
              </li>
            ))}
          </ul>
        </section>
      )}
      {runs.length === 0 && setup && open.length > 0 && <p className="muted">{t.noRuns}</p>}
    </div>
  );
}
