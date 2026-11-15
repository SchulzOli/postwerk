/**
 * Campaigns started from a target market's template: the goal, the
 * marketplace and the template's channels, its pieces as drafts, and its
 * posts as drafts spread over the weeks, each with its topic. Drafts have no
 * accounts yet: people write them (or let the AI studio) and pick accounts
 * in the composer.
 */
import type { Campaign, Database } from '@maas/db';
import { createCampaign, createPiece, CampaignError, type CampaignInput } from './campaigns';
import type { Locale } from './i18n';
import type { CampaignTemplate } from './market';
import type { Channel, PieceKind } from './marketing';
import { campaignMessages } from './messages';
import { createPostDraft } from './posts';
import { getProduct, installedMarket } from './products';

export interface TemplateStart {
  productId: string;
  templateId: string;
  name: string;
  message: string;
  startsOn: string | null;
  endsOn: string | null;
  currency: string;
  budgetCents: number;
}

/** The campaign a template sets up, before it is saved. */
export function templateCampaign(template: CampaignTemplate, start: TemplateStart, locale: Locale): CampaignInput {
  const channels: Channel[] = ['marketplace', ...template.channels.filter((channel) => channel !== 'marketplace')];
  return {
    name: start.name,
    goal: template.goal,
    status: 'draft',
    audience: '',
    message: start.message,
    startsOn: start.startsOn,
    endsOn: start.endsOn,
    currency: start.currency,
    budgetCents: start.budgetCents,
    channels: channels.map((channel) => ({ channel, budgetCents: 0 })),
    notes: template.posts > 0 ? campaignMessages[locale].templatePosts({ template: template.name[locale], posts: template.posts, weeks: template.weeks }) : '',
    productId: start.productId,
  };
}

/** Starts a campaign for a product from one of its market's templates, with the template's pieces as drafts. */
export async function createCampaignFromTemplate(db: Database, workspaceId: string, userId: string, start: TemplateStart, locale: Locale): Promise<Campaign> {
  const product = await getProduct(db, workspaceId, start.productId);
  if (!product) throw new CampaignError((m) => m.product);
  const market = await installedMarket(db, workspaceId, product.marketId);
  if (!market) throw new CampaignError((m) => m.marketMissing);
  const template = market.templates.find((candidate) => candidate.id === start.templateId);
  if (!template) throw new CampaignError((m) => m.template);
  const campaign = await createCampaign(db, workspaceId, userId, templateCampaign(template, start, locale));
  for (const piece of template.pieces) {
    const format = piece.kind === 'listing' || piece.kind === 'screenshot' ? piece.kind : piece.format!;
    await createPiece(db, workspaceId, campaign.id, { kind: piece.kind as PieceKind, format, title: piece.title[locale] });
  }
  for (const draft of postPlan(template, campaign.startsOn, locale)) {
    await createPostDraft(db, { workspaceId, authorId: userId, text: draft.text, campaignId: campaign.id, scheduledAt: draft.at });
  }
  return campaign;
}

/**
 * When a template's posts go out and what each is about: spread evenly over
 * its weeks from the campaign's start (or tomorrow), at 09:00 UTC.
 */
export function postPlan(template: CampaignTemplate, startsOn: string | null, locale: Locale, today = new Date()): { at: Date; text: string }[] {
  const start = startsOn ? new Date(`${startsOn}T09:00:00Z`) : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1, 9));
  const days = template.weeks * 7;
  const m = campaignMessages[locale];
  return Array.from({ length: template.posts }, (_, index) => {
    const topic = template.postTopics[index]?.[locale] ?? m.templatePostTopic({ template: template.name[locale], number: index + 1, of: template.posts });
    return { at: new Date(start.getTime() + Math.floor((index * days) / template.posts) * 86_400_000), text: `${topic}\n\n${m.templatePostHint}` };
  });
}
