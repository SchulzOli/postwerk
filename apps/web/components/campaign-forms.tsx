'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { CAMPAIGN_STATUSES, CHANNELS, CURRENCIES, formatMoney, GOALS, parseMoney, PIECE_FORMATS, PIECE_KINDS, type PieceKind, type PieceStatus } from '@maas/core/marketing';
import {
  addPieceAction,
  addResultAction,
  createCampaignAction,
  deleteCampaignAction,
  saveCampaignAction,
  setPieceStatusAction,
  type CampaignState,
} from '@/app/(app)/campaigns/actions';
import { useLocale, useMessages } from '@/lib/i18n';
import { keepValues } from '@/lib/form';
import { intlLocale } from '@/lib/locale';
import { campaignsMessages } from '@/messages/campaigns';
import { commonMessages } from '@/messages/common';

function Feedback({ state }: { state: CampaignState }) {
  return (
    <>
      {state.error && <p className="error" role="alert">{state.error}</p>}
      {state.success && <p className="success" role="status">{state.success}</p>}
    </>
  );
}

/** Clears a form after each successful save. */
function useResetOnSave(state: CampaignState) {
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.saved && !state.success) form.current?.reset();
  }, [state.saved, state.success]);
  return form;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Cents as the plain amount people type ("1500" or "1500.50"). */
const amountInput = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));

export function NewCampaignForm() {
  const t = useMessages(campaignsMessages);
  const [state, action, pending] = useActionState<CampaignState, FormData>(createCampaignAction, {});
  return (
    <form onSubmit={keepValues(action)} className="card stack">
      <h2>{t.newCampaign}</h2>
      <label>
        {t.name}
        <input name="name" required maxLength={120} placeholder={t.namePlaceholder} />
      </label>
      <label>
        {t.message} <small className="muted">{t.messageHint}</small>
        <input name="message" maxLength={500} />
      </label>
      <div className="grid-4">
        <label>
          {t.goal}
          <select name="goal" defaultValue="leads">
            {GOALS.map((goal) => (
              <option key={goal} value={goal}>{t.goals[goal]}</option>
            ))}
          </select>
        </label>
        <label>
          {t.startsOn}
          <input name="startsOn" type="date" />
        </label>
        <label>
          {t.endsOn}
          <input name="endsOn" type="date" />
        </label>
        <label>
          {t.budget}
          <span className="money-input">
            <input name="budget" inputMode="decimal" placeholder="0" />
            <select name="currency" defaultValue="EUR" aria-label={t.currency}>
              {CURRENCIES.map((currency) => (
                <option key={currency}>{currency}</option>
              ))}
            </select>
          </span>
        </label>
      </div>
      <Feedback state={state} />
      <button type="submit" disabled={pending} className="align-start">{t.create}</button>
    </form>
  );
}

export interface PlanData {
  id: string;
  name: string;
  goal: string;
  status: string;
  audience: string;
  message: string;
  startsOn: string | null;
  endsOn: string | null;
  currency: string;
  budgetCents: number;
  channels: { channel: string; budgetCents: number }[];
  notes: string;
}

/** The campaign's plan, with the budget split across the channels it runs in. */
export function PlanForm({ campaign, brandAudience, canDelete }: { campaign: PlanData; brandAudience: string; canDelete: boolean }) {
  const t = useMessages(campaignsMessages);
  const locale = intlLocale(useLocale());
  const [state, action, pending] = useActionState<CampaignState, FormData>(saveCampaignAction.bind(null, campaign.id), {});
  const planned = new Map(campaign.channels.map((c) => [c.channel, c.budgetCents]));
  const [on, setOn] = useState(() => new Set(campaign.channels.map((c) => c.channel)));
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(campaign.channels.map((c) => [c.channel, c.budgetCents ? amountInput(c.budgetCents) : ''])));
  const [budget, setBudget] = useState(campaign.budgetCents ? amountInput(campaign.budgetCents) : '');
  const [currency, setCurrency] = useState(campaign.currency);
  const [deleting, startDelete] = useTransition();

  const total = parseMoney(budget);
  const split = [...on].reduce((sum, channel) => sum + (parseMoney(amounts[channel] ?? '') ?? 0), 0);
  const rest = total === null ? 0 : total - split;

  return (
    <form onSubmit={keepValues(action)} className="card stack">
      <h2>{t.plan}</h2>
      <div className="grid-2">
        <label>
          {t.name}
          <input name="name" defaultValue={campaign.name} required maxLength={120} />
        </label>
        <div className="grid-2">
          <label>
            {t.goal}
            <select name="goal" defaultValue={campaign.goal}>
              {GOALS.map((goal) => (
                <option key={goal} value={goal}>{t.goals[goal]}</option>
              ))}
            </select>
          </label>
          <label>
            {t.status}
            <select name="status" defaultValue={campaign.status}>
              {CAMPAIGN_STATUSES.map((status) => (
                <option key={status} value={status}>{t.statuses[status]}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <label>
        {t.message} <small className="muted">{t.messageHint}</small>
        <input name="message" defaultValue={campaign.message} maxLength={500} />
      </label>
      <label>
        {t.audience} <small className="muted">{t.audienceHint}</small>
        <textarea name="audience" rows={2} defaultValue={campaign.audience} placeholder={brandAudience} maxLength={1000} />
      </label>
      <div className="grid-4">
        <label>
          {t.startsOn}
          <input name="startsOn" type="date" defaultValue={campaign.startsOn ?? ''} />
        </label>
        <label>
          {t.endsOn}
          <input name="endsOn" type="date" defaultValue={campaign.endsOn ?? ''} />
        </label>
        <label>
          {t.budget}
          <input name="budget" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="0" />
        </label>
        <label>
          {t.currency}
          <select name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="stack-sm">
        <legend>{t.channels}</legend>
        <small className="muted">{t.channelsHint}</small>
        <ul className="channel-list">
          {CHANNELS.map((channel) => (
            <li key={channel} className={on.has(channel) ? 'is-on' : undefined}>
              <label className="check grow">
                <input
                  type="checkbox"
                  name="channels"
                  value={channel}
                  checked={on.has(channel)}
                  onChange={(e) =>
                    setOn((current) => {
                      const next = new Set(current);
                      if (e.target.checked) next.add(channel);
                      else next.delete(channel);
                      return next;
                    })
                  }
                />
                {t.channelNames[channel]}
              </label>
              {on.has(channel) && (
                <span className="money-input">
                  <input
                    name={`budget:${channel}`}
                    inputMode="decimal"
                    aria-label={`${t.channelNames[channel]}: ${t.budget}`}
                    value={amounts[channel] ?? (planned.get(channel) ? amountInput(planned.get(channel)!) : '')}
                    onChange={(e) => setAmounts((current) => ({ ...current, [channel]: e.target.value }))}
                    placeholder="0"
                  />
                  <span className="muted">{currency}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
        {total !== null && total > 0 && rest > 0 && <small className="muted">{t.unplanned(formatMoney(rest, currency, locale))}</small>}
        {total !== null && rest < 0 && <small className="warn-text">{t.overplanned(formatMoney(-rest, currency, locale))}</small>}
      </fieldset>

      <label>
        {t.notes}
        <textarea name="notes" rows={3} defaultValue={campaign.notes} maxLength={4000} />
      </label>
      <Feedback state={state} />
      <div className="row">
        <button type="submit" disabled={pending}>{t.save}</button>
        <span className="grow" />
        {canDelete && (
          <button
            type="button"
            className="secondary danger"
            disabled={deleting}
            onClick={() => {
              if (confirm(t.confirmDelete)) startDelete(() => deleteCampaignAction(campaign.id));
            }}
          >
            {t.deleteCampaign}
          </button>
        )}
      </div>
    </form>
  );
}

export function AddPieceForm({ campaignId }: { campaignId: string }) {
  const t = useMessages(campaignsMessages);
  const [state, action, pending] = useActionState<CampaignState, FormData>(addPieceAction.bind(null, campaignId), {});
  const [kind, setKind] = useState<PieceKind>('print');
  const form = useResetOnSave(state);
  return (
    <form ref={form} onSubmit={keepValues(action)} className="stack">
      <div className="grid-3">
        <label>
          {t.kind}
          <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as PieceKind)}>
            {PIECE_KINDS.map((k) => (
              <option key={k} value={k}>{t.kinds[k]}</option>
            ))}
          </select>
        </label>
        <label>
          {t.format}
          <select name="format" key={kind}>
            {PIECE_FORMATS[kind].map((format) => (
              <option key={format} value={format}>{t.formats[format]}</option>
            ))}
          </select>
        </label>
        <label>
          {t.title}
          <input name="title" required maxLength={160} placeholder={t.titlePlaceholder} />
        </label>
      </div>
      <Feedback state={state} />
      <button type="submit" className="secondary align-start" disabled={pending}>{t.addPiece}</button>
    </form>
  );
}

/** The next steps a piece can take: approve, go live, finish, or back to draft. */
export function PieceStatusButtons({ pieceId, status, canApprove }: { pieceId: string; status: PieceStatus; canApprove: boolean }) {
  const t = useMessages(campaignsMessages);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const go = (next: PieceStatus) =>
    start(async () => {
      const result = await setPieceStatusAction(pieceId, next);
      setError(result.error);
    });
  const steps: { to: PieceStatus; label: string; primary?: boolean }[] = [];
  if (status === 'draft' && canApprove) steps.push({ to: 'approved', label: t.approve, primary: true });
  if (status === 'approved') steps.push({ to: 'live', label: t.markLive, primary: true });
  if (status === 'live') steps.push({ to: 'done', label: t.markDone });
  if (status !== 'draft' && canApprove) steps.push({ to: 'draft', label: t.backToDraft });
  return (
    <>
      {steps.map((step) => (
        <button key={step.to} type="button" className={step.primary ? 'small' : 'small secondary'} disabled={pending} onClick={() => go(step.to)}>
          {step.label}
        </button>
      ))}
      {error && <small className="error" role="alert">{error}</small>}
    </>
  );
}

export function ResultForm({ campaignId, channels }: { campaignId: string; channels: string[] }) {
  const t = useMessages(campaignsMessages);
  const [state, action, pending] = useActionState<CampaignState, FormData>(addResultAction.bind(null, campaignId), {});
  const form = useResetOnSave(state);
  const choices = channels.length > 0 ? channels : [...CHANNELS];
  return (
    <form ref={form} onSubmit={keepValues(action)} className="stack">
      <div className="grid-4">
        <label>
          {t.channel}
          <select name="channel">
            {choices.map((channel) => (
              <option key={channel} value={channel}>{t.channelNames[channel as keyof typeof t.channelNames]}</option>
            ))}
          </select>
        </label>
        <label>
          {t.day}
          <input name="day" type="date" defaultValue={today()} required />
        </label>
        <label>
          {t.spend}
          <input name="spend" inputMode="decimal" placeholder="0" />
        </label>
        <label>
          {t.revenue}
          <input name="revenue" inputMode="decimal" placeholder="0" />
        </label>
        <label>
          {t.reach}
          <input name="reach" inputMode="numeric" placeholder="0" />
        </label>
        <label>
          {t.clicks}
          <input name="clicks" inputMode="numeric" placeholder="0" />
        </label>
        <label>
          {t.leads}
          <input name="leads" inputMode="numeric" placeholder="0" />
        </label>
        <label>
          {t.sales}
          <input name="sales" inputMode="numeric" placeholder="0" />
        </label>
      </div>
      <label>
        {t.note}
        <input name="note" maxLength={500} />
      </label>
      <Feedback state={state} />
      <button type="submit" className="secondary align-start" disabled={pending}>{t.addResult}</button>
    </form>
  );
}

/** A small delete button for list rows, bound to a server action. */
export function DeleteButton({ action }: { action: () => Promise<void> }) {
  const common = useMessages(commonMessages);
  const [pending, start] = useTransition();
  return (
    <button type="button" className="small secondary" disabled={pending} onClick={() => start(action)}>
      {common.delete}
    </button>
  );
}
