'use client';

import { useActionState, useState } from 'react';
import { AD_LANGUAGES, MAX_STUDIO_FORMATS, MAX_STUDIO_NOTES, MAX_STUDIO_VARIANTS, POST_IDEAS_PER_VARIANT, STUDIO_FORMATS } from '@maas/core/marketing';
import { runStudioAction, type StudioState } from '@/app/(app)/studio/actions';
import { keepValues } from '@/lib/form';
import { useMessages } from '@/lib/i18n';
import { campaignsMessages } from '@/messages/campaigns';
import { studioMessages } from '@/messages/studio';

const GROUPS = ['ad', 'print', 'spot', 'posts'] as const;

interface Props {
  campaigns: { id: string; name: string }[];
  campaignId?: string;
  language: string;
  model: string;
}

/** Choose a campaign and what Claude should draft into it. */
export function StudioForm({ campaigns, campaignId, language, model }: Props) {
  const t = useMessages(studioMessages);
  const c = useMessages(campaignsMessages);
  const [state, action, pending] = useActionState<StudioState, FormData>(runStudioAction, {});
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const full = chosen.size >= MAX_STUDIO_FORMATS;
  const label = (format: string) => (format === 'posts' ? t.posts : (c.formats[format.split(':')[1]!] ?? format));

  return (
    <form onSubmit={keepValues(action)} className="card stack">
      <label>
        {t.campaign}
        <select name="campaign" defaultValue={campaignId ?? campaigns[0]?.id} required>
          {campaigns.map((campaign) => (
            <option key={campaign.id} value={campaign.id}>
              {campaign.name}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="stack-sm">
        <legend>{t.formats}</legend>
        <small className="muted">{t.formatsHint(MAX_STUDIO_FORMATS)}</small>
        <div className="studio-groups">
          {GROUPS.map((group) => (
            <div key={group} className="stack-sm">
              <strong className="small">{t.groups[group]}</strong>
              <ul className="channel-list">
                {STUDIO_FORMATS.filter((format) => format.split(':')[0] === group).map((format) => (
                  <li key={format} className={chosen.has(format) ? 'is-on' : undefined}>
                    <label className="check grow">
                      <input
                        type="checkbox"
                        name="formats"
                        value={format}
                        checked={chosen.has(format)}
                        disabled={full && !chosen.has(format)}
                        onChange={(e) =>
                          setChosen((current) => {
                            const next = new Set(current);
                            if (e.target.checked) next.add(format);
                            else next.delete(format);
                            return next;
                          })
                        }
                      />
                      {label(format)}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </fieldset>

      <div className="grid-2">
        <label>
          {t.variants} <small className="muted">{t.variantsHint(POST_IDEAS_PER_VARIANT)}</small>
          <select name="variants" defaultValue="2">
            {Array.from({ length: MAX_STUDIO_VARIANTS }, (_, index) => (
              <option key={index} value={index + 1}>
                {index + 1}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.language}
          <select name="language" defaultValue={language}>
            {AD_LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {t.languages[code]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label>
        {t.notes} <small className="muted">{t.notesHint}</small>
        <textarea name="notes" rows={3} maxLength={MAX_STUDIO_NOTES} />
      </label>

      {state.error && <p className="error" role="alert">{state.error}</p>}
      {state.success && !pending && <p className="success" role="status">{state.success}</p>}
      {pending && <p className="muted" role="status">{t.creating}</p>}
      <div className="row">
        <button type="submit" disabled={pending || chosen.size === 0}>
          {t.create}
        </button>
        <small className="muted grow">{t.model(model)}</small>
      </div>
    </form>
  );
}
