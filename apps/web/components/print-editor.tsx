'use client';

import { useActionState, useState, useTransition } from 'react';
import type { PrintContent } from '@maas/core/marketing';
import { deleteMailingAction, mailingAction, savePrintPieceAction, type MailingState, type PieceState } from '@/app/(app)/campaigns/piece-actions';
import { keepValues } from '@/lib/form';
import { useMessages } from '@/lib/i18n';
import { printMessages } from '@/messages/print';
import { ImageField, type StoredImage } from './image-field';

/** Texts, picture and options of a print piece. */
export function PrintForm({ pieceId, title, format, content, picture, characterName }: { pieceId: string; title: string; format: string; content: PrintContent; picture: StoredImage[]; characterName: string | null }) {
  const t = useMessages(printMessages);
  const [state, action, pending] = useActionState<PieceState, FormData>(savePrintPieceAction.bind(null, pieceId), {});
  const personal = format === 'letter_a4' || format === 'postcard_a6';
  return (
    <form onSubmit={keepValues(action)} className="card stack">
      <h2>{t.content}</h2>
      <label>
        {t.title} <small className="muted">{t.titleHint}</small>
        <input name="title" defaultValue={title} required maxLength={160} />
      </label>
      <label>
        {format === 'letter_a4' ? t.subject : t.headline}
        <input name="headline" defaultValue={content.headline} maxLength={160} />
      </label>
      <label>
        {t.body} {personal && <small className="muted">{t.nameHint}</small>}
        <textarea name="body" rows={format === 'letter_a4' ? 12 : 5} defaultValue={content.body} maxLength={4000} />
      </label>
      <div className="grid-2">
        <label>
          {t.callToAction}
          <input name="callToAction" defaultValue={content.callToAction} maxLength={80} placeholder={t.ctaPlaceholder} />
        </label>
        <label>
          {t.qrUrl} <small className="muted">{t.qrHint}</small>
          <input name="qrUrl" type="url" defaultValue={content.qrUrl} maxLength={500} placeholder="https://" />
        </label>
      </div>
      {format === 'newspaper' && (
        <fieldset className="stack-sm">
          <legend>{t.size}</legend>
          <div className="grid-2">
            <label>
              {t.width}
              <input name="widthMm" type="number" min={20} max={1200} defaultValue={content.widthMm} required />
            </label>
            <label>
              {t.height}
              <input name="heightMm" type="number" min={20} max={1200} defaultValue={content.heightMm} required />
            </label>
          </div>
        </fieldset>
      )}
      {format !== 'letter_a4' && (
        <div className="stack-sm">
          <strong>{t.picture}</strong>
          <small className="muted">{t.pictureHint}</small>
          <ImageField name="picture" initial={picture} max={1} />
        </div>
      )}
      <fieldset className="stack-sm">
        <legend>{t.show}</legend>
        <label className="check">
          <input type="checkbox" name="showCharacter" defaultChecked={content.showCharacter} disabled={!characterName} />
          {characterName ? t.showCharacter(characterName) : t.noCharacter}
        </label>
        <label className="check">
          <input type="checkbox" name="showLogo" defaultChecked={content.showLogo} />
          {t.showLogo}
        </label>
        <label className="check">
          <input type="checkbox" name="showContact" defaultChecked={content.showContact} />
          {t.showContact}
        </label>
      </fieldset>
      {state.error && <p className="error" role="alert">{state.error}</p>}
      {state.success && <p className="success" role="status">{state.success}</p>}
      <button type="submit" disabled={pending} className="align-start">{t.save}</button>
    </form>
  );
}

/** Recipients, delivery and price check, then sending; the send button appears once the same list was checked. */
export function MailingForm({ pieceId }: { pieceId: string }) {
  const t = useMessages(printMessages);
  const [state, action, pending] = useActionState<MailingState, FormData>(mailingAction.bind(null, pieceId), {});
  const [recipients, setRecipients] = useState('');
  const ready = state.checked && state.checked.text === recipients.replace(/\r\n/g, '\n');
  return (
    <form
      onSubmit={(event) => {
        const intent = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value;
        if (intent === 'send' && state.checked && !confirm(t.confirmSend(state.checked.count))) {
          event.preventDefault();
          return;
        }
        keepValues(action)(event);
        if (intent === 'send') setRecipients('');
      }}
      className="stack"
    >
      <label>
        {t.recipients} <small className="muted">{t.recipientsHint}</small>
        <textarea name="recipients" rows={6} value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder={t.recipientsPlaceholder} required />
      </label>
      <small className="muted">{t.privacy}</small>
      <div className="grid-2">
        <label>
          {t.delivery}
          <select name="delivery" defaultValue="fast">
            <option value="fast">{t.deliveries.fast}</option>
            <option value="cheap">{t.deliveries.cheap}</option>
          </select>
        </label>
        <label>
          {t.colors}
          <select name="color" defaultValue="color">
            <option value="color">{t.colorOptions.color}</option>
            <option value="grayscale">{t.colorOptions.grayscale}</option>
          </select>
        </label>
      </div>
      {state.error && <p className="error" role="alert">{state.error}</p>}
      {state.problems && (
        <ul className="error" role="alert">
          {state.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      {ready && <p role="status">{state.checked!.summary}</p>}
      {state.sent && <p className="success" role="status">{t.queued}</p>}
      <div className="row">
        <button type="submit" name="intent" value="check" className={ready ? 'secondary' : undefined} disabled={pending || !recipients.trim()}>
          {t.check}
        </button>
        {ready && (
          <button type="submit" name="intent" value="send" disabled={pending}>
            {t.send(state.checked!.count)}
          </button>
        )}
      </div>
    </form>
  );
}

export function DeleteMailingButton({ campaignId, pieceId, mailingId }: { campaignId: string; pieceId: string; mailingId: string }) {
  const t = useMessages(printMessages);
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="small secondary"
      disabled={pending}
      onClick={() => {
        if (confirm(t.confirmDeleteMailing)) start(() => deleteMailingAction(campaignId, pieceId, mailingId));
      }}
    >
      {t.deleteMailing}
    </button>
  );
}
