import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatMoney, getBrandKit, getCampaign, listMembers, pieceChannel, summarizeCampaign, type PieceKind, type PieceStatus } from '@maas/core';
import { getDb } from '@maas/db';
import { AddPieceForm, DeleteButton, PieceStatusButtons, PlanForm, ResultForm } from '@/components/campaign-forms';
import { LocalTime } from '@/components/local-time';
import { formatDay } from '@/lib/dates';
import { getLocale, getMessages } from '@/lib/i18n-server';
import { requireSession } from '@/lib/session';
import { campaignsMessages } from '@/messages/campaigns';
import { commonMessages } from '@/messages/common';
import { deletePieceAction, deleteResultAction } from '../actions';

type Params = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(id: string) {
  const { workspace } = await requireSession();
  return UUID.test(id) ? getCampaign(getDb(), workspace.id, id) : null;
}

export async function generateMetadata({ params }: Params) {
  const [detail, t, common] = await Promise.all([load((await params).id), getMessages(campaignsMessages), getMessages(commonMessages)]);
  return { title: common.title(detail?.campaign.name ?? t.pageTitle) };
}

export default async function CampaignPage({ params }: Params) {
  const { id } = await params;
  const session = await requireSession();
  const db = getDb();
  const [detail, brand, members, t, common, locale] = await Promise.all([
    load(id),
    getBrandKit(db, session.workspace),
    listMembers(db, session.workspace.id),
    getMessages(campaignsMessages),
    getMessages(commonMessages),
    getLocale(),
  ]);
  if (!detail) notFound();
  const { campaign, pieces, posts, results } = detail;
  const canManage = session.role !== 'editor';
  const money = (cents: number) => formatMoney(cents, campaign.currency, locale);
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const nameOf = new Map(members.map((member) => [member.userId, member.name]));
  const summary = summarizeCampaign(campaign, results, pieces);
  const channelName = (channel: string) => t.channelNames[channel as keyof typeof t.channelNames] ?? channel;

  return (
    <div className="stack-lg">
      <div className="stack-sm">
        <Link href="/campaigns" className="small-link">{t.back}</Link>
        <div className="row">
          <h1 className="grow">{campaign.name}</h1>
          <span className={`badge campaign-${campaign.status}`}>{t.statuses[campaign.status]}</span>
        </div>
      </div>

      <PlanForm
        campaign={{
          id: campaign.id,
          name: campaign.name,
          goal: campaign.goal,
          status: campaign.status,
          audience: campaign.audience,
          message: campaign.message,
          startsOn: campaign.startsOn,
          endsOn: campaign.endsOn,
          currency: campaign.currency,
          budgetCents: campaign.budgetCents,
          channels: campaign.channels,
          notes: campaign.notes,
        }}
        brandAudience={brand.audience}
        canDelete={canManage}
      />

      <section className="card stack">
        <h2>{t.pieces}</h2>
        <p className="muted">{t.piecesIntro}</p>
        {pieces.length === 0 ? (
          <p className="muted">{t.noPieces}</p>
        ) : (
          <ul className="list">
            {pieces.map((piece) => (
              <li key={piece.id} className="stack-sm">
                <div className="row">
                  {piece.kind !== 'ad' ? (
                    <Link href={`/campaigns/${campaign.id}/pieces/${piece.id}`} className="grow piece-link">{piece.title}</Link>
                  ) : (
                    <strong className="grow">{piece.title}</strong>
                  )}
                  {piece.source === 'ai' && <span className="badge">{t.fromAi}</span>}
                  <span className={`badge piece-${piece.status}`}>{t.pieceStatuses[piece.status]}</span>
                </div>
                <div className="row">
                  <span className="muted small grow">
                    {t.formats[piece.format] ?? piece.format} · {channelName(pieceChannel(piece.kind as PieceKind, piece.format))}
                    {piece.approvedBy && piece.status !== 'draft' && <> · {t.approvedBy(nameOf.get(piece.approvedBy) ?? '?')}</>}
                  </span>
                  <PieceStatusButtons pieceId={piece.id} status={piece.status as PieceStatus} canApprove={canManage} />
                  {(piece.status === 'draft' || canManage) && <DeleteButton action={deletePieceAction.bind(null, piece.id)} />}
                </div>
              </li>
            ))}
          </ul>
        )}
        {!canManage && <small className="muted">{t.adminsApprove}</small>}
        <AddPieceForm campaignId={campaign.id} />
      </section>

      <section className="card stack">
        <div className="row">
          <h2 className="grow">{t.posts}</h2>
          <Link href={`/posts/new?campaign=${campaign.id}`} className="button secondary">{t.newPost}</Link>
        </div>
        <p className="muted">{t.postsIntro}</p>
        {posts.length === 0 ? (
          <p className="muted">{t.noPosts}</p>
        ) : (
          <ul className="list">
            {posts.map((post) => (
              <li key={post.id} className="row">
                <span className={`badge status-${post.status}`}>{common.status[post.status as keyof typeof common.status]}</span>
                <span className="clip grow">{post.text || common.mediaOnly}</span>
                <span className="muted small">{post.scheduledAt && <LocalTime iso={post.scheduledAt.toISOString()} />}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card stack">
        <h2>{t.results}</h2>
        <p className="muted">{t.resultsIntro}</p>
        {summary.channels.length > 0 && (
          <div className="table-scroll">
            <table className="usage-table results-table">
              <thead>
                <tr>
                  <th>{t.channel}</th>
                  <th>{t.planned}</th>
                  <th>{t.spend}</th>
                  <th>{t.reach}</th>
                  <th>{t.clicks}</th>
                  <th>{t.leads}</th>
                  <th>{t.costPerLead}</th>
                  <th>{t.revenue}</th>
                  <th>{t.roas}</th>
                </tr>
              </thead>
              <tbody>
                {[...summary.channels, summary.total].map((row) => (
                  <tr key={row.channel} className={row.channel === 'total' ? 'total-row' : undefined}>
                    <td>{row.channel === 'total' ? t.total : channelName(row.channel)}</td>
                    <td>{row.plannedCents ? money(row.plannedCents) : '–'}</td>
                    <td className={row.plannedCents > 0 && row.spendCents > row.plannedCents ? 'warn-text' : undefined}>{money(row.spendCents)}</td>
                    <td>{number(row.reach)}</td>
                    <td>{number(row.clicks)}</td>
                    <td>{number(row.leads)}</td>
                    <td>{row.costPerLeadCents === null ? '–' : money(row.costPerLeadCents)}</td>
                    <td>{money(row.revenueCents)}</td>
                    <td>{row.roas === null ? '–' : new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(row.roas)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {campaign.budgetCents > 0 && summary.total.spendCents > 0 && <small className="muted">{t.spentOf(money(summary.total.spendCents), money(campaign.budgetCents))}</small>}

        <ResultForm campaignId={campaign.id} channels={summary.channels.map((row) => row.channel)} />

        {results.length === 0 ? (
          <p className="muted">{t.noResults}</p>
        ) : (
          <details>
            <summary>
              {t.entries} ({results.length})
            </summary>
            <ul className="list">
              {results.map((result) => (
                <li key={result.id} className="row">
                  <span className="grow">
                    {formatDay(result.day, locale)} · {channelName(result.channel)} · {money(result.spendCents)}
                    {result.leads > 0 && <> · {number(result.leads)} {t.leads}</>}
                    {result.note && <span className="muted"> · {result.note}</span>}
                  </span>
                  {result.source === 'manual' && <DeleteButton action={deleteResultAction.bind(null, campaign.id, result.id)} />}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
