import Link from 'next/link';
import { notFound } from 'next/navigation';
import { findMedia, formatMoney, getBrandKit, getCampaign, isMailable, listMailings, pingenConfig, type PieceStatus, type PrintContent } from '@maas/core';
import { renderPiece } from '@maas/core/print';
import { DOCS_URL } from '@maas/providers/catalog';
import { getDb } from '@maas/db';
import { PieceStatusButtons } from '@/components/campaign-forms';
import { LocalTime } from '@/components/local-time';
import { DeleteMailingButton, MailingForm, PrintForm } from '@/components/print-editor';
import { getLocale, getMessages } from '@/lib/i18n-server';
import { requireSession } from '@/lib/session';
import { campaignsMessages } from '@/messages/campaigns';
import { commonMessages } from '@/messages/common';
import { printMessages } from '@/messages/print';

type Params = { params: Promise<{ id: string; pieceId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(id: string, pieceId: string) {
  const { workspace } = await requireSession();
  if (!UUID.test(id) || !UUID.test(pieceId)) return null;
  const detail = await getCampaign(getDb(), workspace.id, id);
  const piece = detail?.pieces.find((candidate) => candidate.id === pieceId);
  return detail && piece ? { campaign: detail.campaign, piece } : null;
}

export async function generateMetadata({ params }: Params) {
  const { id, pieceId } = await params;
  const [found, common] = await Promise.all([load(id, pieceId), getMessages(commonMessages)]);
  return { title: common.title(found?.piece.title ?? '') };
}

export default async function PiecePage({ params }: Params) {
  const { id, pieceId } = await params;
  const session = await requireSession();
  const found = await load(id, pieceId);
  if (!found || found.piece.kind !== 'print') notFound();
  const { campaign, piece } = found;
  const db = getDb();
  const content = piece.content as unknown as PrintContent;
  const [t, c, locale, kit, uploads] = await Promise.all([
    getMessages(printMessages),
    getMessages(campaignsMessages),
    getLocale(),
    getBrandKit(db, session.workspace),
    findMedia(db, session.workspace.id, content.imageMediaId ? [content.imageMediaId] : []),
  ]);
  const personal = piece.format === 'letter_a4' || piece.format === 'postcard_a6';
  const { warnings } = await renderPiece(db, piece, { recipient: personal ? t.sampleRecipient : undefined, locale });
  const canManage = session.role !== 'editor';
  const isLetter = piece.format === 'letter_a4';
  const mailings = isLetter ? await listMailings(db, session.workspace.id, piece.id) : [];
  const pingen = pingenConfig();
  const pdf = `/campaigns/${campaign.id}/pieces/${piece.id}/pdf`;
  const upload = content.imageMediaId ? uploads.get(content.imageMediaId) : undefined;

  return (
    <div className="stack-lg">
      <div className="stack-sm">
        <Link href={`/campaigns/${campaign.id}`} className="small-link">{t.back}</Link>
        <div className="row">
          <h1 className="grow">{piece.title}</h1>
          <span className={`badge piece-${piece.status}`}>{c.pieceStatuses[piece.status]}</span>
        </div>
        <div className="row">
          <span className="muted grow">
            {campaign.name} · {c.formats[piece.format]}
          </span>
          <PieceStatusButtons pieceId={piece.id} status={piece.status as PieceStatus} canApprove={canManage} />
        </div>
      </div>

      <div className="piece-layout">
        <PrintForm
          pieceId={piece.id}
          title={piece.title}
          format={piece.format}
          content={content}
          picture={upload ? [{ id: upload.id, url: `/media/${upload.key}` }] : []}
          characterName={kit.character?.name ?? null}
        />
        <section className="card stack">
          <h2>{t.preview}</h2>
          <iframe key={piece.updatedAt.toISOString()} className="pdf-preview" src={`${pdf}?sample=1&v=${piece.updatedAt.getTime()}#view=FitH`} title={t.preview} />
          {personal && <small className="muted">{t.sampleNote}</small>}
          {warnings.length > 0 && (
            <ul className="warn-list">
              {warnings.map((warning) => (
                <li key={JSON.stringify(warning)}>
                  {warning.code === 'lowResolution'
                    ? t.warnings.lowResolution(warning.image, warning.dpi)
                    : warning.code === 'unsupportedImage'
                      ? t.warnings.unsupportedImage(warning.image)
                      : t.warnings[warning.code]}
                </li>
              ))}
            </ul>
          )}
          <div className="row">
            <a className="button" href={`${pdf}?download=1`}>{isLetter ? t.downloadLetter : t.download}</a>
            {!isLetter && <a href={`${pdf}?download=1&marks=1`}>{t.downloadMarks}</a>}
          </div>
          {!isLetter && <small className="muted">{t.printNote}</small>}
        </section>
      </div>

      {isLetter && (
        <section className="card stack">
          <h2>{t.mailing}</h2>
          <p className="muted">{t.mailingIntro}</p>
          {!pingen ? (
            <p>
              {t.notConfigured}{' '}
              <a href={`${DOCS_URL}/marketing/print#send-letters-with-pingen`} target="_blank" rel="noreferrer">{t.setupGuide}</a>
            </p>
          ) : !isMailable(piece) ? (
            <p className="muted">{t.approveFirst}</p>
          ) : !canManage ? (
            <p className="muted">{t.adminsSend}</p>
          ) : (
            <>
              {pingen.staging && <p className="warn-text">{t.staging}</p>}
              <MailingForm pieceId={piece.id} />
            </>
          )}
          {mailings.length > 0 && (
            <>
              <h3>{t.mailings}</h3>
              <ul className="list">
                {mailings.map((mailing) => (
                  <li key={mailing.id} className="stack-sm">
                    <div className="row">
                      <span className="grow">
                        <strong>{t.mailingTitle(mailing.letters, t.deliveries[mailing.deliveryProduct as 'fast' | 'cheap'] ?? mailing.deliveryProduct)}</strong>
                        <span className="muted"> · <LocalTime iso={mailing.createdAt.toISOString()} /></span>
                      </span>
                      {canManage && <DeleteMailingButton campaignId={campaign.id} pieceId={piece.id} mailingId={mailing.id} />}
                    </div>
                    <span className="muted small">
                      {(['queued', 'submitted', 'sent', 'failed'] as const)
                        .filter((key) => mailing[key] > 0)
                        .map((key) => t.counts[key](mailing[key]))
                        .join(' · ')}
                      {mailing.cost && ` · ${t.cost(formatMoney(mailing.cost.cents, mailing.cost.currency || campaign.currency, locale))}`}
                    </span>
                    {mailing.problems.length > 0 && (
                      <ul className="error small">
                        {mailing.problems.map((problem, index) => (
                          <li key={index}>
                            {problem.name}: {problem.error}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}
