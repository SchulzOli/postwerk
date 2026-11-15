'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { SCREENSHOT_BACKGROUNDS, SCREENSHOT_LIMITS, type ListingLink, type ScreenshotBackground } from '@maas/core/marketing';
import { saveListingAction, saveScreenshotAction, sendListingAction, type ListingState } from '@/app/(app)/campaigns/listing-actions';
import { keepValues } from '@/lib/form';
import { useMessages } from '@/lib/i18n';
import { listingMessages } from '@/messages/listing';
import { ImageField, type StoredImage } from './image-field';

function Feedback({ state }: { state: ListingState }) {
  return (
    <>
      {state.error && <p className="error" role="alert">{state.error}</p>}
      {state.success && <p className="success" role="status">{state.success}</p>}
    </>
  );
}

/** "12/100", in the warning color when over the limit. */
function Counter({ length, max }: { length: number; max: number }) {
  return (
    <small className={length > max ? 'warn-text counter' : 'muted counter'}>
      {length.toLocaleString()}/{max.toLocaleString()}
    </small>
  );
}

/** Name and link rows for videos or documents. */
function Links({ prefix, label, hint, limit, initial }: { prefix: string; label: string; hint: string; limit: string; initial: ListingLink[] }) {
  const t = useMessages(listingMessages);
  const [rows, setRows] = useState(() => (initial.length ? initial : [{ name: '', url: '' }]));
  return (
    <fieldset className="stack-sm">
      <legend>
        {label} <small className="muted">{limit}</small>
      </legend>
      <small className="muted">{hint}</small>
      {rows.map((row, index) => (
        <div key={index} className="grid-2">
          <input name={`${prefix}Name`} defaultValue={row.name} placeholder={t.linkName} aria-label={`${label}: ${t.linkName}`} maxLength={120} />
          <input name={`${prefix}Url`} defaultValue={row.url} placeholder="https://" aria-label={`${label}: ${t.linkUrl}`} maxLength={500} />
        </div>
      ))}
      <button type="button" className="link align-start small-link" onClick={() => setRows((current) => [...current, { name: '', url: '' }])}>
        {t.addLink}
      </button>
    </fieldset>
  );
}

export interface ListingTextField {
  id: string;
  label: string;
  max: number;
  multiline: boolean;
}

export interface ListingFormData {
  pieceId: string;
  title: string;
  texts: Record<string, string>;
  keywords: string[];
  videos: ListingLink[];
  documents: ListingLink[];
}

/** The listing's texts with their limits, keywords, videos and documents. */
export function ListingForm({ listing, fields, limits }: { listing: ListingFormData; fields: ListingTextField[]; limits: { keywords: string; videos: string; documents: string } }) {
  const t = useMessages(listingMessages);
  const [state, action, pending] = useActionState<ListingState, FormData>(saveListingAction.bind(null, listing.pieceId), {});
  const [texts, setTexts] = useState(listing.texts);
  return (
    <form onSubmit={keepValues(action)} className="card stack">
      <h2>{t.listing}</h2>
      <label>
        {t.title}
        <input name="title" defaultValue={listing.title} required maxLength={160} />
      </label>
      {fields.map((field) => {
        const value = texts[field.id] ?? '';
        const props = { name: `text:${field.id}`, value, onChange: (event: { target: { value: string } }) => setTexts((current) => ({ ...current, [field.id]: event.target.value })) };
        return (
          <label key={field.id}>
            <span className="row-tight">
              <span className="grow">{field.label}</span>
              <Counter length={value.trim().length} max={field.max} />
            </span>
            {field.multiline ? <textarea {...props} rows={field.max > 1000 ? 12 : 2} /> : <input {...props} />}
          </label>
        );
      })}
      <label>
        <span>
          {t.keywords} <small className="muted">{limits.keywords} · {t.keywordsHint}</small>
        </span>
        <input name="keywords" defaultValue={listing.keywords.join(', ')} />
      </label>
      <Links prefix="video" label={t.videos} hint={t.videosHint} limit={limits.videos} initial={listing.videos} />
      <Links prefix="document" label={t.documents} hint={t.documentsHint} limit={limits.documents} initial={listing.documents} />
      <Feedback state={state} />
      <button type="submit" disabled={pending} className="align-start">{t.save}</button>
    </form>
  );
}

/** Sends an approved listing into the offer's draft in Partner Center; says why it cannot when it cannot. */
export function SendListingButton({ pieceId, blocker }: { pieceId: string; blocker: string | null }) {
  const t = useMessages(listingMessages);
  const [state, setState] = useState<ListingState>({});
  const [pending, start] = useTransition();
  return (
    <div className="stack-sm">
      <small className="muted">{t.sendHint}</small>
      {blocker ? (
        <small className="warn-text">{blocker}</small>
      ) : (
        <button type="button" className="align-start" disabled={pending} onClick={() => start(async () => setState(await sendListingAction(pieceId)))}>
          {t.send}
        </button>
      )}
      <Feedback state={state} />
    </div>
  );
}

export function CopyButton({ text }: { text: string }) {
  const t = useMessages(listingMessages);
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="small secondary"
      disabled={!text}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? t.copied : t.copy}
    </button>
  );
}

// ------------------------------------------------------------------ screenshots

export interface BrandLook {
  colors: { primary: string; secondary: string; text: string; background: string };
  /** "sans" or "serif", as for print. */
  font: string;
}

const FONTS: Record<string, string> = {
  sans: 'Inter, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
};

/** Breaks text into lines that fit the width, at most `max` lines (the last one shortened). */
function lines(ctx: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const result: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= width || !line) line = next;
    else {
      result.push(line);
      line = word;
    }
  }
  if (line) result.push(line);
  if (result.length > max) {
    const kept = result.slice(0, max);
    kept[max - 1] = `${kept[max - 1]!.replace(/\s+\S*$/, '')}…`;
    return kept;
  }
  return result;
}

/**
 * Draws a listing screenshot: the headline and caption on a brand
 * background, the capture below them, cut off at the bottom edge.
 */
function draw(canvas: HTMLCanvasElement, look: BrandLook, content: { headline: string; caption: string; background: ScreenshotBackground }, capture: HTMLImageElement | null) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width: W, height: H } = canvas;
  const { colors } = look;
  if (content.background === 'gradient') {
    const gradient = ctx.createLinearGradient(0, 0, W, H);
    gradient.addColorStop(0, colors.primary);
    gradient.addColorStop(1, colors.secondary);
    ctx.fillStyle = gradient;
  } else {
    ctx.fillStyle = { primary: colors.primary, dark: colors.text, light: colors.background }[content.background];
  }
  ctx.fillRect(0, 0, W, H);

  const ink = content.background === 'light' ? colors.text : '#ffffff';
  const font = FONTS[look.font] ?? FONTS.sans!;
  const pad = Math.round(W * 0.07);
  let y = Math.round(H * 0.1);
  ctx.fillStyle = ink;
  ctx.textBaseline = 'top';
  const headlineSize = Math.round(H * 0.075);
  ctx.font = `800 ${headlineSize}px ${font}`;
  for (const line of lines(ctx, content.headline, W - 2 * pad, 2)) {
    ctx.fillText(line, pad, y);
    y += Math.round(headlineSize * 1.15);
  }
  const captionSize = Math.round(H * 0.036);
  ctx.font = `400 ${captionSize}px ${font}`;
  ctx.globalAlpha = 0.92;
  y += Math.round(H * 0.012);
  for (const line of lines(ctx, content.caption, W - 2 * pad, 2)) {
    ctx.fillText(line, pad, y);
    y += Math.round(captionSize * 1.35);
  }
  ctx.globalAlpha = 1;

  const top = Math.max(y + Math.round(H * 0.04), Math.round(H * 0.34));
  const frameWidth = W - 2 * pad;
  const frameHeight = H - top;
  const radius = Math.round(W * 0.012);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(pad, top, frameWidth, frameHeight + radius, [radius, radius, 0, 0]);
  ctx.clip();
  ctx.fillStyle = colors.background;
  ctx.fillRect(pad, top, frameWidth, frameHeight);
  if (capture) {
    // Full width; the bottom of a tall capture is cut off.
    const scale = frameWidth / capture.naturalWidth;
    ctx.drawImage(capture, pad, top, frameWidth, capture.naturalHeight * scale);
  }
  ctx.restore();
}

export interface ScreenshotFormData {
  pieceId: string;
  title: string;
  capture: StoredImage[];
  headline: string;
  caption: string;
  background: ScreenshotBackground;
}

/** A listing screenshot: capture, headline, caption and background, previewed and downloaded at the market's size. */
export function ScreenshotEditor({ screenshot, look, size, fileName }: { screenshot: ScreenshotFormData; look: BrandLook; size: { width: number; height: number }; fileName: string }) {
  const t = useMessages(listingMessages);
  const [state, action, pending] = useActionState<ListingState, FormData>(saveScreenshotAction.bind(null, screenshot.pieceId), {});
  const [headline, setHeadline] = useState(screenshot.headline);
  const [caption, setCaption] = useState(screenshot.caption);
  const [background, setBackground] = useState(screenshot.background);
  const [capture, setCapture] = useState<StoredImage | undefined>(screenshot.capture[0]);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!capture) return setImage(null);
    const img = new Image();
    img.onload = () => setImage(img);
    img.src = capture.url;
  }, [capture]);

  useEffect(() => {
    if (canvas.current) draw(canvas.current, look, { headline, caption, background }, image);
  }, [look, headline, caption, background, image]);

  const download = () =>
    canvas.current?.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), { href: url, download: fileName }).click();
      URL.revokeObjectURL(url);
    }, 'image/png');

  return (
    <div className="piece-layout">
      <form onSubmit={keepValues(action)} className="card stack">
        <h2>{t.screenshot}</h2>
        <label>
          {t.title}
          <input name="title" defaultValue={screenshot.title} required maxLength={160} />
        </label>
        <div className="stack-sm">
          <span>
            {t.capture} <small className="muted">{t.captureHint}</small>
          </span>
          <ImageField name="capture" initial={screenshot.capture} max={1} onChange={(images) => setCapture(images[0])} />
        </div>
        <label>
          <span className="row-tight">
            <span className="grow">{t.headline}</span>
            <Counter length={headline.trim().length} max={SCREENSHOT_LIMITS.headline} />
          </span>
          <input name="headline" value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={SCREENSHOT_LIMITS.headline} />
        </label>
        <label>
          <span className="row-tight">
            <span className="grow">
              {t.captionLabel} <small className="muted">{t.captionHint}</small>
            </span>
            <Counter length={caption.trim().length} max={SCREENSHOT_LIMITS.caption} />
          </span>
          <input name="caption" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={SCREENSHOT_LIMITS.caption} />
        </label>
        <label>
          <span>
            {t.background} <small className="muted">{t.backgroundHint}</small>
          </span>
          <select name="background" value={background} onChange={(e) => setBackground(e.target.value as ScreenshotBackground)}>
            {SCREENSHOT_BACKGROUNDS.map((choice) => (
              <option key={choice} value={choice}>{t.backgrounds[choice]}</option>
            ))}
          </select>
        </label>
        {(!capture || !caption.trim()) && (
          <ul className="warn-list">
            {!capture && <li>{t.needsCapture}</li>}
            {!caption.trim() && <li>{t.needsCaption}</li>}
          </ul>
        )}
        <Feedback state={state} />
        <button type="submit" disabled={pending} className="align-start">{t.save}</button>
      </form>
      <section className="card stack">
        <h2>{t.previewScreenshot}</h2>
        <canvas ref={canvas} width={size.width} height={size.height} className="screenshot-canvas" aria-label={t.previewScreenshot} />
        <small className="muted">{t.size(size.width, size.height)}</small>
        <button type="button" className="secondary align-start" onClick={download}>{t.download}</button>
      </section>
    </div>
  );
}
