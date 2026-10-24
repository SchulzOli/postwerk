'use client';

import { useActionState, useState, useTransition } from 'react';
import {
  AD_CALLS_TO_ACTION,
  AD_COUNTRIES,
  AD_FORMATS,
  AD_LANGUAGES,
  adProblems,
  KEYWORDS,
  LONG_HEADLINES,
  PATH_CHARS,
  PRIMARY_TEXT_VISIBLE,
  youtubeVideoId,
  type AdContent,
  type AdFormat,
  type TextRule,
} from '@maas/core/marketing';
import { launchAdAction, removeAdAccountAction, saveAdPieceAction, setAdRunningAction } from '@/app/(app)/campaigns/ad-actions';
import type { PieceState } from '@/app/(app)/campaigns/piece-actions';
import { keepValues } from '@/lib/form';
import { useMessages } from '@/lib/i18n';
import { adsMessages } from '@/messages/ads';
import { ImageField, type StoredImage } from './image-field';

const hostOf = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return 'example.com';
  }
};

/** A growing list of short texts with character counters. */
function TextList({ name, label, hint, rule, values, onChange }: { name: string; label: string; hint?: string; rule: TextRule; values: string[]; onChange(values: string[]): void }) {
  const t = useMessages(adsMessages);
  return (
    <fieldset className="stack-sm">
      <legend>
        {label} {hint && <small className="muted">{hint}</small>}
      </legend>
      {values.map((value, index) => (
        <div key={index} className="row-tight">
          <input
            name={name}
            value={value}
            maxLength={rule.chars}
            onChange={(e) => onChange(values.map((old, at) => (at === index ? e.target.value : old)))}
            aria-label={`${label} ${index + 1}`}
          />
          <small className={value.length > rule.chars ? 'warn-text counter' : 'muted counter'}>
            {value.length}/{rule.chars}
          </small>
          {values.length > 1 && (
            <button type="button" className="small secondary" onClick={() => onChange(values.filter((_, at) => at !== index))} aria-label={t.remove_}>
              ×
            </button>
          )}
        </div>
      ))}
      {values.length < rule.max && (
        <button type="button" className="link align-start small-link" onClick={() => onChange([...values, ''])}>
          {t.add}
        </button>
      )}
    </fieldset>
  );
}

interface Spot {
  id: string;
  title: string;
  videoId: string | null;
}

/** An ad's texts, link and picture or video, with a preview of how it shows. */
export function AdForm({
  pieceId,
  title,
  format,
  content,
  picture,
  spots,
  brandName,
}: {
  pieceId: string;
  title: string;
  format: AdFormat;
  content: AdContent;
  picture: StoredImage[];
  spots: Spot[];
  brandName: string;
}) {
  const t = useMessages(adsMessages);
  const rules = AD_FORMATS[format];
  const pad = (list: string[] | undefined, min: number) => [...(list ?? []), ...Array<string>(Math.max(0, min - (list?.length ?? 0))).fill('')];
  const [state, action, pending] = useActionState<PieceState, FormData>(saveAdPieceAction.bind(null, pieceId), {});
  const [headlines, setHeadlines] = useState(() => pad(content.headlines, rules.headlines.min));
  const [descriptions, setDescriptions] = useState(() => pad(content.descriptions, rules.descriptions.min));
  const [longHeadlines, setLongHeadlines] = useState(() => pad(content.longHeadlines, LONG_HEADLINES.min));
  const [finalUrl, setFinalUrl] = useState(content.finalUrl);
  const [path1, setPath1] = useState(content.path1 ?? '');
  const [path2, setPath2] = useState(content.path2 ?? '');
  const [keywords, setKeywords] = useState((content.keywords ?? []).join('\n'));
  const [cta, setCta] = useState(content.callToAction || 'LEARN_MORE');
  const [spot, setSpot] = useState(content.spotId ?? (content.youtubeVideoId ? '' : (spots[0]?.id ?? '')));
  const [youtube, setYoutube] = useState(content.youtubeVideoId ? `https://youtu.be/${content.youtubeVideoId}` : '');
  const [image, setImage] = useState(picture[0]?.url ?? null);

  const video = spot ? (spots.find((candidate) => candidate.id === spot)?.videoId ?? null) : youtubeVideoId(youtube);
  const problems = adProblems(format, { headlines, descriptions, longHeadlines, finalUrl, callToAction: cta, keywords: keywords.split('\n'), imageMediaId: image ? 'x' : undefined }, video);
  const host = hostOf(finalUrl);
  const primary = descriptions[0] ?? '';

  return (
    <div className="piece-layout">
      <form onSubmit={keepValues(action)} className="card stack">
        <h2>{t.ad}</h2>
        <label>
          {t.title}
          <input name="title" defaultValue={title} required maxLength={160} />
        </label>
        <label>
          {t.finalUrl} <small className="muted">{t.finalUrlHint}</small>
          <input name="finalUrl" type="url" value={finalUrl} onChange={(e) => setFinalUrl(e.target.value)} placeholder="https://" maxLength={1000} />
        </label>

        {format === 'social' ? (
          <>
            <label>
              <span className="row-tight">
                <span className="grow">{t.primaryText}</span>
                <small className={primary.length > PRIMARY_TEXT_VISIBLE ? 'warn-text counter' : 'muted counter'}>
                  {primary.length}/{PRIMARY_TEXT_VISIBLE}
                </small>
              </span>
              <textarea name="description" rows={3} value={primary} maxLength={rules.descriptions.chars} onChange={(e) => setDescriptions([e.target.value])} />
              <small className="muted">{t.primaryTextHint(PRIMARY_TEXT_VISIBLE)}</small>
            </label>
            <label>
              <span className="row-tight">
                <span className="grow">{t.headline}</span>
                <small className="muted counter">
                  {(headlines[0] ?? '').length}/{rules.headlines.chars}
                </small>
              </span>
              <input name="headline" value={headlines[0] ?? ''} maxLength={rules.headlines.chars} onChange={(e) => setHeadlines([e.target.value])} />
            </label>
            <label>
              {t.callToAction}
              <select name="callToAction" value={cta} onChange={(e) => setCta(e.target.value)}>
                {AD_CALLS_TO_ACTION.map((value) => (
                  <option key={value} value={value}>{t.ctas[value]}</option>
                ))}
              </select>
            </label>
            <div className="stack-sm">
              <strong>{t.picture}</strong>
              <small className="muted">{t.pictureHint}</small>
              <ImageField name="picture" initial={picture} max={1} onChange={(images) => setImage(images[0]?.url ?? null)} />
            </div>
          </>
        ) : (
          <>
            <TextList name="headline" label={t.headlines} hint={t.headlinesHint(rules.headlines.min, rules.headlines.max, rules.headlines.chars)} rule={rules.headlines} values={headlines} onChange={setHeadlines} />
            {format === 'video' && (
              <TextList name="longHeadline" label={t.longHeadlines} hint={t.headlinesHint(LONG_HEADLINES.min, LONG_HEADLINES.max, LONG_HEADLINES.chars)} rule={LONG_HEADLINES} values={longHeadlines} onChange={setLongHeadlines} />
            )}
            <TextList name="description" label={t.descriptions} hint={t.headlinesHint(rules.descriptions.min, rules.descriptions.max, rules.descriptions.chars)} rule={rules.descriptions} values={descriptions} onChange={setDescriptions} />
          </>
        )}

        {format === 'search' && (
          <>
            <fieldset className="stack-sm">
              <legend>
                {t.path} <small className="muted">{t.pathHint}</small>
              </legend>
              <div className="row-tight">
                <span className="muted nowrap">{host}/</span>
                <input name="path1" value={path1} maxLength={PATH_CHARS} onChange={(e) => setPath1(e.target.value)} aria-label={`${t.path} 1`} />
                <span className="muted">/</span>
                <input name="path2" value={path2} maxLength={PATH_CHARS} disabled={!path1} onChange={(e) => setPath2(e.target.value)} aria-label={`${t.path} 2`} />
              </div>
            </fieldset>
            <label>
              {t.keywords} <small className="muted">{t.keywordsHint}</small>
              <textarea name="keywords" rows={4} value={keywords} onChange={(e) => setKeywords(e.target.value)} maxLength={KEYWORDS.max * (KEYWORDS.chars + 1)} />
            </label>
          </>
        )}

        {format === 'video' && (
          <fieldset className="stack-sm">
            <legend>{t.video}</legend>
            <label>
              {t.spot}
              <select name="spot" value={spot} onChange={(e) => setSpot(e.target.value)}>
                {spots.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.title}
                    {candidate.videoId ? ` · youtu.be/${candidate.videoId}` : ''}
                  </option>
                ))}
                <option value="">{t.noSpot}</option>
              </select>
            </label>
            {spot && !video && <small className="warn-text">{t.spotNotOnYoutube}</small>}
            {!spot && (
              <label>
                {t.youtubeLink}
                <input name="youtube" value={youtube} onChange={(e) => setYoutube(e.target.value)} placeholder="https://youtu.be/…" />
              </label>
            )}
          </fieldset>
        )}

        {problems.length > 0 && (
          <ul className="warn-list">
            {problems.map((problem) => (
              <li key={problem.code}>{'min' in problem ? t.problems[problem.code](problem.min) : t.problems[problem.code]}</li>
            ))}
          </ul>
        )}
        {state.error && <p className="error" role="alert">{state.error}</p>}
        {state.success && <p className="success" role="status">{state.success}</p>}
        <button type="submit" disabled={pending} className="align-start">{t.save}</button>
      </form>

      <section className="card stack">
        <h2>{t.preview}</h2>
        {format === 'search' && (
          <div className="ad-preview search-preview">
            <small>
              <strong>{t.sponsored}</strong> · {host}
              {path1 && `/${path1}`}
              {path1 && path2 && `/${path2}`}
            </small>
            <p className="search-headline">{headlines.filter((text) => text.trim()).slice(0, 3).join(' | ') || '…'}</p>
            <p>{descriptions.filter((text) => text.trim()).slice(0, 2).join(' ') || '…'}</p>
          </div>
        )}
        {format === 'social' && (
          <div className="ad-preview social-preview">
            <div className="row-tight">
              <span className="avatar-sm" />
              <span>
                <strong>{brandName}</strong>
                <br />
                <small className="muted">{t.sponsored}</small>
              </span>
            </div>
            <p className="post-text">{primary.length > PRIMARY_TEXT_VISIBLE ? `${primary.slice(0, PRIMARY_TEXT_VISIBLE)}…` : primary || '…'}</p>
            {image ? <img src={image} alt="" className="social-image" /> : <div className="social-image placeholder" />}
            <div className="row-tight social-footer">
              <span className="grow">
                <small className="muted">{host.toUpperCase()}</small>
                <br />
                <strong>{headlines[0] || '…'}</strong>
              </span>
              <span className="button secondary small">{t.ctas[cta]}</span>
            </div>
          </div>
        )}
        {format === 'video' && (
          <div className="ad-preview video-preview">
            <div className="video-frame">{video ? `▶ youtu.be/${video}` : '▶'}</div>
            <strong>{headlines.find((text) => text.trim()) || '…'}</strong>
            <small className="muted">
              {t.ad_} · {host}
            </small>
            <p>{longHeadlines.find((text) => text.trim()) || ''}</p>
          </div>
        )}
      </section>
    </div>
  );
}

export interface LaunchAccount {
  id: string;
  name: string;
  currency: string;
  pages: { id: string; name: string }[];
}

/** Budget, time, place and account for the paused campaign. */
export function LaunchForm({
  pieceId,
  platform,
  accounts,
  budget,
  startsOn,
  endsOn,
  plannedHint,
}: {
  pieceId: string;
  platform: string;
  accounts: LaunchAccount[];
  budget: string;
  startsOn: string;
  endsOn: string;
  plannedHint: string | null;
}) {
  const t = useMessages(adsMessages);
  const [state, action, pending] = useActionState<PieceState, FormData>(launchAdAction.bind(null, pieceId), {});
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const account = accounts.find((candidate) => candidate.id === accountId);
  return (
    <form onSubmit={keepValues(action)} className="stack">
      <div className="grid-2">
        <label>
          {t.account}
          <select name="account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name} ({candidate.currency})
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.budget} <small className="muted">{t.budgetHint(account?.currency ?? '')}</small>
          <input name="budget" inputMode="decimal" defaultValue={budget} required />
          {plannedHint && <small className="muted">{plannedHint}</small>}
        </label>
        <label>
          {t.startsOn}
          <input name="startsOn" type="date" defaultValue={startsOn} required />
        </label>
        <label>
          {t.endsOn}
          <input name="endsOn" type="date" defaultValue={endsOn} required />
        </label>
      </div>
      <fieldset className="stack-sm">
        <legend>{t.countries}</legend>
        <div className="chips">
          {AD_COUNTRIES.map((country) => (
            <label key={country} className="check">
              <input type="checkbox" name="countries" value={country} defaultChecked={country === 'DE'} />
              {country}
            </label>
          ))}
        </div>
      </fieldset>
      {platform === 'google_ads' ? (
        <label>
          {t.language}
          <select name="language" defaultValue="de">
            {AD_LANGUAGES.map((language) => (
              <option key={language} value={language}>{t.languages[language]}</option>
            ))}
          </select>
        </label>
      ) : (
        <label>
          {t.page}
          <select name="page">
            {(account?.pages ?? []).map((page) => (
              <option key={page.id} value={page.id}>{page.name}</option>
            ))}
          </select>
        </label>
      )}
      {state.error && <p className="error" role="alert">{state.error}</p>}
      <button type="submit" disabled={pending} className="align-start">{t.create}</button>
    </form>
  );
}

/** Start or pause a launched campaign. */
export function RunButtons({ pieceId, launchId, status, budget }: { pieceId: string; launchId: string; status: string; budget: string }) {
  const t = useMessages(adsMessages);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const go = (running: boolean) =>
    start(async () => {
      if (running && !confirm(t.confirmStart(budget))) return;
      setError((await setAdRunningAction(pieceId, launchId, running)).error);
    });
  return (
    <div className="row">
      {status === 'paused' && (
        <button type="button" disabled={pending} onClick={() => go(true)}>
          {t.start}
        </button>
      )}
      {status === 'running' && (
        <button type="button" className="secondary" disabled={pending} onClick={() => go(false)}>
          {t.pause}
        </button>
      )}
      {error && <small className="error" role="alert">{error}</small>}
    </div>
  );
}

export function RemoveAdAccountButton({ adAccountId }: { adAccountId: string }) {
  const t = useMessages(adsMessages);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <>
      {error && <small className="error">{error}</small>}
      <button type="button" className="small secondary" disabled={pending} onClick={() => start(async () => setError((await removeAdAccountAction(adAccountId)).error))}>
        {t.remove}
      </button>
    </>
  );
}
