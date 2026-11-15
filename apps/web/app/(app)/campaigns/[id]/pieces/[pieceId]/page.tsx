import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asc, and, eq } from 'drizzle-orm';
import {
  adProblems,
  adsSetup,
  adVideoId,
  campaignMarket,
  checkListing,
  findMedia,
  formatMoney,
  getAdLaunch,
  getBrandKit,
  getCampaign,
  isMailable,
  listAdAccounts,
  listMailings,
  pieceChannel,
  pingenConfig,
  platformOf,
  SPOT_FORMATS,
  spotVideo,
  type AdContent,
  type AdFormat,
  type ListingContent,
  type ListingProblem,
  type MarketManifest,
  type PieceStatus,
  type ScreenshotContent,
  type PrintContent,
  type SpotContent,
  type SpotFormat,
} from '@maas/core';
import { renderPiece } from '@maas/core/print';
import { DOCS_URL } from '@maas/providers/catalog';
import { getDb, socialAccounts, type Campaign, type Piece } from '@maas/db';
import { PieceStatusButtons } from '@/components/campaign-forms';
import { LocalTime } from '@/components/local-time';
import { DeleteMailingButton, MailingForm, PrintForm } from '@/components/print-editor';
import { AdForm, LaunchForm, RunButtons } from '@/components/ad-editor';
import { SpotEditor, YoutubeUpload } from '@/components/spot-editor';
import { CopyButton, ListingForm, ScreenshotEditor } from '@/components/listing-editor';
import { listingMessages } from '@/messages/listing';
import { marketsMessages } from '@/messages/markets';
import { formatDay } from '@/lib/dates';
import { getLocale, getMessages } from '@/lib/i18n-server';
import { requireSession } from '@/lib/session';
import { campaignsMessages } from '@/messages/campaigns';
import { commonMessages } from '@/messages/common';
import { printMessages } from '@/messages/print';
import { adsMessages } from '@/messages/ads';
import { spotsMessages } from '@/messages/spots';

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
  if (!found) notFound();
  const { campaign, piece } = found;
  if (piece.kind === 'spot') return <SpotPiece campaign={campaign} piece={piece} />;
  if (piece.kind === 'ad') return <AdPiece campaign={campaign} piece={piece} />;
  if (piece.kind === 'listing') return <ListingPiece campaign={campaign} piece={piece} />;
  if (piece.kind === 'screenshot') return <ScreenshotPiece campaign={campaign} piece={piece} />;
  const db = getDb();
  const content = piece.content as unknown as PrintContent;
  const [t, locale, kit, uploads] = await Promise.all([
    getMessages(printMessages),
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
      <PieceHeader campaign={campaign} piece={piece} canManage={canManage} />

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

/** Back link, title, status and the next steps of a piece. */
async function PieceHeader({ campaign, piece, canManage }: { campaign: Campaign; piece: Piece; canManage: boolean }) {
  const [t, c] = await Promise.all([getMessages(printMessages), getMessages(campaignsMessages)]);
  return (
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
  );
}

/** A video or radio spot: script, briefing, produced file and YouTube. */
async function SpotPiece({ campaign, piece }: { campaign: Campaign; piece: Piece }) {
  const session = await requireSession();
  const db = getDb();
  const content = piece.content as unknown as SpotContent;
  const spot = SPOT_FORMATS[piece.format as SpotFormat];
  const audio = spot.medium === 'audio';
  const [t, kit, uploads, video, youtubeAccounts] = await Promise.all([
    getMessages(spotsMessages),
    getBrandKit(db, session.workspace),
    findMedia(db, session.workspace.id, content.fileMediaId ? [content.fileMediaId] : []),
    spotVideo(db, session.workspace.id, content),
    audio
      ? []
      : db.query.socialAccounts.findMany({
          where: and(eq(socialAccounts.workspaceId, session.workspace.id), eq(socialAccounts.provider, 'youtube')),
          orderBy: [asc(socialAccounts.handle)],
        }),
  ]);
  const file = content.fileMediaId ? uploads.get(content.fileMediaId) : undefined;
  const canManage = session.role !== 'editor';
  const approved = piece.status === 'approved' || piece.status === 'live';

  return (
    <div className="stack-lg">
      <PieceHeader campaign={campaign} piece={piece} canManage={canManage} />
      <SpotEditor
        pieceId={piece.id}
        title={piece.title}
        format={piece.format}
        audio={audio}
        target={spot.seconds}
        content={content}
        file={file ? { id: file.id, url: `/media/${file.key}` } : null}
        character={kit.character ? { name: kit.character.name, catchphrase: kit.character.catchphrase } : null}
      />
      <section className="card stack">
        <h2>{t.briefing}</h2>
        <p className="muted">{t.briefingIntro}</p>
        <a className="button align-start" href={`/campaigns/${campaign.id}/pieces/${piece.id}/pdf?download=1`}>{t.downloadBriefing}</a>
      </section>
      {!audio && (
        <section className="card stack">
          <h2>{t.youtube}</h2>
          <p className="muted">{t.youtubeIntro}</p>
          {video.videoId && (
            <p>
              {t.youtubeVideo}:{' '}
              <a href={`https://youtu.be/${video.videoId}`} target="_blank" rel="noreferrer">youtu.be/{video.videoId}</a>
            </p>
          )}
          {video.post && !video.videoId && (
            <p className={video.post.status === 'failed' ? 'error' : 'muted'}>
              {t.youtubeStatus[video.post.status] ?? video.post.status}
              {video.post.error && ` · ${video.post.error}`}
              {' · '}
              <Link href="/posts">{t.openPost}</Link>
            </p>
          )}
          {!video.videoId && !(video.post && video.post.status !== 'failed') &&
            (youtubeAccounts.length === 0 ? (
              <p className="muted">{t.noYoutubeAccount}</p>
            ) : !approved || !file ? (
              <p className="muted">{t.approveFirst}</p>
            ) : (
              <YoutubeUpload pieceId={piece.id} accounts={youtubeAccounts.map((account) => ({ id: account.id, handle: account.handle }))} title={piece.title} description={campaign.message} />
            ))}
        </section>
      )}
    </div>
  );
}

/** An online ad: texts and preview, then its campaign on Google Ads or Meta Ads. */
async function AdPiece({ campaign, piece }: { campaign: Campaign; piece: Piece }) {
  const session = await requireSession();
  const db = getDb();
  const content = piece.content as unknown as AdContent;
  const format = piece.format as AdFormat;
  const platform = platformOf(format);
  const detail = await getCampaign(db, session.workspace.id, campaign.id);
  const spotPieces = (detail?.pieces ?? []).filter((candidate) => candidate.kind === 'spot' && SPOT_FORMATS[candidate.format as SpotFormat]?.medium === 'video');
  const [t, locale, kit, uploads, launch, accounts, spots, video] = await Promise.all([
    getMessages(adsMessages),
    getLocale(),
    getBrandKit(db, session.workspace),
    findMedia(db, session.workspace.id, content.imageMediaId ? [content.imageMediaId] : []),
    getAdLaunch(db, session.workspace.id, piece.id),
    listAdAccounts(db, session.workspace.id),
    Promise.all(spotPieces.map(async (spot) => ({ id: spot.id, title: spot.title, videoId: (await spotVideo(db, session.workspace.id, spot.content as unknown as SpotContent)).videoId }))),
    format === 'video' ? adVideoId(db, session.workspace.id, content) : null,
  ]);
  const upload = content.imageMediaId ? uploads.get(content.imageMediaId) : undefined;
  const canManage = session.role !== 'editor';
  const approved = piece.status === 'approved' || piece.status === 'live';
  const usable = accounts.filter((account) => account.platform === platform && account.status === 'active');
  const planned = campaign.channels.find((entry) => entry.channel === pieceChannel('ad', format))?.budgetCents ?? 0;
  const name = t.platforms[platform];
  const money = (cents: number, currency: string) => formatMoney(cents, currency, locale);

  return (
    <div className="stack-lg">
      <PieceHeader campaign={campaign} piece={piece} canManage={canManage} />
      <AdForm
        pieceId={piece.id}
        title={piece.title}
        format={format}
        content={content}
        picture={upload ? [{ id: upload.id, url: `/media/${upload.key}` }] : []}
        spots={spots}
        brandName={kit.companyName}
      />
      <section className="card stack">
        <h2>{t.launch}</h2>
        {launch ? (
          <>
            <div className="row">
              <span className={`badge ad-${launch.status}`}>{t.status[launch.status]}</span>
              <span className="grow">
                {launch.account.name} · {t.runs(formatDay(launch.startsOn, locale), formatDay(launch.endsOn, locale), money(launch.budgetCents, launch.currency))}
              </span>
              <a href={launch.url} target="_blank" rel="noreferrer">{t.openOn(name)}</a>
            </div>
            {canManage && launch.status !== 'ended' && <RunButtons pieceId={piece.id} launchId={launch.id} status={launch.status} budget={money(launch.budgetCents, launch.currency)} />}
            {launch.error && <p className="error">{launch.error}</p>}
            <small className="muted">{t.synced}</small>
          </>
        ) : (
          <>
            <p className="muted">{t.launchIntro(name)}</p>
            {!approved ? (
              <p className="muted">{t.approveFirst}</p>
            ) : adProblems(format, content, video).length > 0 ? (
              <p className="muted">{t.completeFirst}</p>
            ) : !adsSetup()[platform] ? (
              <p className="muted">{t.notSetUp(name)}</p>
            ) : usable.length === 0 ? (
              <p className="muted">
                {t.connectFirst(name)} <Link href="/campaigns#ad-accounts">{t.accounts} →</Link>
              </p>
            ) : !canManage ? (
              <p className="muted">{t.adminsOnly}</p>
            ) : (
              <LaunchForm
                pieceId={piece.id}
                platform={platform}
                accounts={usable.map((account) => ({ id: account.id, name: account.name, currency: account.currency, pages: account.pages }))}
                budget={planned ? String(planned / 100) : ''}
                startsOn={campaign.startsOn ?? new Date().toISOString().slice(0, 10)}
                endsOn={campaign.endsOn ?? ''}
                plannedHint={planned ? t.plannedBudget(money(planned, campaign.currency)) : null}
              />
            )}
          </>
        )}
      </section>
    </div>
  );
}

/** A marketplace listing: its texts against the market's limits, the checks, and the hand-over to the marketplace. */
async function ListingPiece({ campaign, piece }: { campaign: Campaign; piece: Piece }) {
  const session = await requireSession();
  const db = getDb();
  const content = piece.content as unknown as ListingContent;
  const [t, m, locale, context, check, detail] = await Promise.all([
    getMessages(listingMessages),
    getMessages(marketsMessages),
    getLocale(),
    campaignMarket(db, session.workspace.id, campaign),
    checkListing(db, session.workspace.id, piece),
    getCampaign(db, session.workspace.id, campaign.id),
  ]);
  const canManage = session.role !== 'editor';
  const market = context?.market;
  const screenshots = (detail?.pieces ?? []).filter((candidate) => candidate.kind === 'screenshot');
  if (!market || !context) {
    return (
      <div className="stack-lg">
        <PieceHeader campaign={campaign} piece={piece} canManage={canManage} />
        <p className="warn-text">{t.marketMissing}</p>
      </div>
    );
  }
  const { listing } = market.marketplace;
  const label = (id: string) => listing.texts.find((field) => field.id === id)?.label[locale] ?? id;
  const countLabel = { keywords: t.keywords, screenshots: t.screenshots, videos: t.videos, documents: t.documents };
  const problem = (entry: ListingProblem) =>
    entry.code === 'required'
      ? t.required(label(entry.field))
      : entry.code === 'tooLong'
        ? t.tooLong({ field: label(entry.field), length: entry.length, max: entry.max })
        : entry.code === 'count'
          ? t.count({ what: countLabel[entry.field], actual: entry.actual, min: entry.min, max: entry.max })
          : t.caption(entry.index + 1);
  const profileLabel = (id: string) => market.product.fields.find((field) => field.id === id)?.label[locale] ?? (m as Record<string, unknown>)[id]?.toString() ?? id;
  const limit = (count: { min: number; max: number }) => (count.min > 0 ? t.between(count.min, count.max) : t.upTo(count.max));
  const publisher = context.product.profile.publisher;
  const allTexts = listing.texts.map((field) => `${field.label[locale]}\n${content.texts[field.id] ?? ''}`).join('\n\n') + `\n\n${t.keywords}\n${content.keywords.join(', ')}`;

  return (
    <div className="stack-lg">
      <PieceHeader campaign={campaign} piece={piece} canManage={canManage} />
      <div className="piece-layout">
        <ListingForm
          listing={{ pieceId: piece.id, title: piece.title, texts: content.texts ?? {}, keywords: content.keywords ?? [], videos: content.videos ?? [], documents: content.documents ?? [] }}
          fields={listing.texts.map((field) => ({ id: field.id, label: field.label[locale], max: field.max, multiline: field.multiline }))}
          limits={{ keywords: limit(listing.keywords), videos: limit(listing.videos), documents: limit(listing.documents) }}
        />
        <div className="stack-lg">
          <section className="card stack">
            <h2>{t.preview}</h2>
            <div className="listing-preview">
              <span className="avatar-initial">{(context.product.name[0] ?? '?').toUpperCase()}</span>
              <span>
                <strong>{content.texts.name || context.product.name}</strong>
                {typeof publisher === 'string' && <small className="muted">{t.by(publisher)}</small>}
                <br />
                <span className="small">{content.texts.summary ?? ''}</span>
              </span>
            </div>
          </section>
          <section className="card stack">
            <h2>{t.checks}</h2>
            <ul className="checks">
              {check && check.listing.length === 0 && check.profile.length === 0 && <li className="ok">{t.ready}</li>}
              {check?.listing.map((entry) => <li key={JSON.stringify(entry)}>{problem(entry)}</li>)}
              {check?.profile.map((id) => <li key={id}>{t.profileMissing(profileLabel(id))}</li>)}
            </ul>
            {check && check.profile.length > 0 && (
              <Link href={`/brand/products/${context.product.id}`} className="small-link">{t.editProfile}</Link>
            )}
            {market.marketplace.rules.length > 0 && (
              <>
                <strong>{t.rules}</strong>
                <ul className="checks">
                  {market.marketplace.rules.map((rule) => (
                    <li key={rule.en} className="rule">{rule[locale]}</li>
                  ))}
                </ul>
              </>
            )}
          </section>
          <section className="card stack">
            <h2>{t.screenshots}</h2>
            <small className="muted">{t.screenshotsHint(`${listing.screenshots.width} × ${listing.screenshots.height}`)}</small>
            {screenshots.length === 0 ? (
              <p className="muted">{t.noScreenshots}</p>
            ) : (
              <ol className="stack-sm">
                {screenshots.map((shot) => {
                  const caption = (shot.content as unknown as ScreenshotContent).caption;
                  return (
                    <li key={shot.id}>
                      <Link href={`/campaigns/${campaign.id}/pieces/${shot.id}`}>{shot.title}</Link>
                      <span className="muted small"> · {caption || t.noCaption}</span>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
          <section className="card stack">
            <h2>{t.handOver(market.marketplace.name)}</h2>
            <p className="muted">{t.handOverHint(market.marketplace.name)}</p>
            <ul className="list">
              {listing.texts.map((field) => (
                <li key={field.id} className="row">
                  <span className="grow">{field.label[locale]}</span>
                  <CopyButton text={content.texts[field.id] ?? ''} />
                </li>
              ))}
              <li className="row">
                <span className="grow">{t.keywords}</span>
                <CopyButton text={content.keywords.join(', ')} />
              </li>
              <li className="row">
                <strong className="grow">{t.listing}</strong>
                <CopyButton text={allTexts} />
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

/** A listing screenshot, drawn at the market's size with the brand's colors. */
async function ScreenshotPiece({ campaign, piece }: { campaign: Campaign; piece: Piece }) {
  const session = await requireSession();
  const db = getDb();
  const content = piece.content as unknown as ScreenshotContent;
  const [t, kit, context, uploads] = await Promise.all([
    getMessages(listingMessages),
    getBrandKit(db, session.workspace),
    campaignMarket(db, session.workspace.id, campaign),
    findMedia(db, session.workspace.id, content.captureMediaId ? [content.captureMediaId] : []),
  ]);
  const canManage = session.role !== 'editor';
  const market: MarketManifest | undefined = context?.market;
  const size = market?.marketplace.listing.screenshots ?? { width: 1280, height: 720 };
  const capture = content.captureMediaId ? uploads.get(content.captureMediaId) : undefined;
  const fileName = `${piece.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'screenshot'}.png`;
  return (
    <div className="stack-lg">
      <PieceHeader campaign={campaign} piece={piece} canManage={canManage} />
      {!market && <p className="warn-text">{t.marketMissing}</p>}
      <ScreenshotEditor
        screenshot={{ pieceId: piece.id, title: piece.title, capture: capture ? [{ id: capture.id, url: `/media/${capture.key}` }] : [], headline: content.headline, caption: content.caption, background: content.background }}
        look={{ colors: { primary: kit.colors.primary, secondary: kit.colors.secondary, text: kit.colors.text, background: kit.colors.background }, font: kit.font }}
        size={{ width: size.width, height: size.height }}
        fileName={fileName}
      />
    </div>
  );
}

