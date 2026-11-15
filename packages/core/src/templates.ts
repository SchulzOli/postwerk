/**
 * Campaigns started from a target market's template: the goal, the
 * marketplace and the template's channels, its pieces as drafts, and the
 * planned posts in the notes (posts need accounts, so the AI studio drafts
 * them once the campaign exists).
 */
import type { Campaign, Database } from '@maas/db';
import { createCampaign, createPiece, CampaignError, type CampaignInput } from './campaigns';
import type { Locale } from './i18n';
import type { CampaignTemplate } from './market';
import type { Channel, PieceKind } from './marketing';
import { campaignMessages } from './messages';
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
  return campaign;
}
