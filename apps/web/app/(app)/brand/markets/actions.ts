'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  builtinMarket,
  createProduct,
  deleteLeads,
  deleteProduct,
  getProduct,
  PartnerCenterError,
  removeCredentials,
  renewLeadToken,
  saveCredentials,
  syncMarketplace,
  installBuiltinMarket,
  installMarket,
  listMarkets,
  MarketError,
  ProductError,
  uninstallMarket,
  updateProduct,
  type ProductInput,
} from '@maas/core';
import { getDb } from '@maas/db';
import { record } from '@/lib/audit';
import { getLocale, getMessages, localizedError } from '@/lib/i18n-server';
import { requireAdmin } from '@/lib/session';
import { marketsMessages } from '@/messages/markets';

export type MarketState = { error?: string; success?: string };

function refresh() {
  revalidatePath('/brand');
  revalidatePath('/brand/markets');
  revalidatePath('/campaigns');
}

async function failure(error: unknown): Promise<MarketState> {
  if (error instanceof MarketError || error instanceof ProductError || error instanceof PartnerCenterError) return { error: await localizedError(error) };
  throw error;
}

/** Installs a target market that ships with MarketingAsAService (owners and admins). */
export async function installBuiltinMarketAction(marketId: string): Promise<void> {
  const { user, workspace } = await requireAdmin();
  const market = builtinMarket(marketId);
  if (!market) return;
  await installBuiltinMarket(getDb(), workspace.id, marketId);
  await record({ action: 'plugin.installed', userId: user.id, workspaceId: workspace.id, target: market.name.en, details: { id: market.id, kind: 'market', builtin: true } });
  refresh();
}

/** Installs (or updates) a target market from its file. */
export async function installMarketAction(_: MarketState, form: FormData): Promise<MarketState> {
  const { user, workspace } = await requireAdmin();
  const t = await getMessages(marketsMessages);
  try {
    const market = await installMarket(getDb(), workspace.id, String(form.get('manifest') ?? ''));
    await record({ action: 'plugin.installed', userId: user.id, workspaceId: workspace.id, target: market.name.en, details: { id: market.id, kind: 'market', version: market.version } });
    refresh();
    return { success: t.installed_(market.name[await getLocale()]) };
  } catch (error) {
    return failure(error);
  }
}

export async function uninstallMarketAction(marketId: string): Promise<void> {
  const { user, workspace } = await requireAdmin();
  const db = getDb();
  const market = (await listMarkets(db, workspace.id)).find((entry) => entry.id === marketId);
  if (!market) return;
  await uninstallMarket(db, workspace.id, marketId);
  await record({ action: 'plugin.uninstalled', userId: user.id, workspaceId: workspace.id, target: market.manifest.name.en, details: { id: marketId, kind: 'market' } });
  refresh();
}

/** The profile from the product form: one field per common or market field; choices may repeat. */
function productInput(form: FormData): ProductInput {
  const profile: ProductInput['profile'] = {};
  for (const [key, value] of form.entries()) {
    if (!key.startsWith('profile:') || typeof value !== 'string') continue;
    const field = key.slice('profile:'.length);
    const all = form.getAll(key).map(String);
    profile[field] = form.get(`multiple:${field}`) ? all : value;
  }
  return { name: String(form.get('name') ?? ''), profile };
}

export async function createProductAction(marketId: string, _: MarketState, form: FormData): Promise<MarketState> {
  const { user, workspace } = await requireAdmin();
  let id: string;
  try {
    const product = await createProduct(getDb(), workspace.id, marketId, productInput(form));
    await record({ action: 'product.created', userId: user.id, workspaceId: workspace.id, target: product.name });
    id = product.id;
  } catch (error) {
    return failure(error);
  }
  refresh();
  redirect(`/brand/products/${id}`);
}

export async function saveProductAction(productId: string, _: MarketState, form: FormData): Promise<MarketState> {
  const { user, workspace } = await requireAdmin();
  try {
    const product = await updateProduct(getDb(), workspace.id, productId, productInput(form));
    await record({ action: 'product.updated', userId: user.id, workspaceId: workspace.id, target: product.name });
  } catch (error) {
    return failure(error);
  }
  refresh();
  revalidatePath(`/brand/products/${productId}`);
  return { success: (await getMessages(marketsMessages)).saved };
}

export async function deleteProductAction(productId: string): Promise<void> {
  const { user, workspace } = await requireAdmin();
  const product = await deleteProduct(getDb(), workspace.id, productId);
  if (product) await record({ action: 'product.deleted', userId: user.id, workspaceId: workspace.id, target: product.name });
  refresh();
  redirect('/brand/markets');
}

// ------------------------------------------------------------------ Partner Center

/** Saves the Entra app after Microsoft accepted it (owners and admins). */
export async function savePartnerCenterAction(marketId: string, _: MarketState, form: FormData): Promise<MarketState> {
  const { user, workspace } = await requireAdmin();
  const text = (name: string) => String(form.get(name) ?? '');
  try {
    await saveCredentials(getDb(), workspace.id, marketId, { tenantId: text('tenantId'), clientId: text('clientId'), clientSecret: text('clientSecret') });
  } catch (error) {
    return failure(error);
  }
  await record({ action: 'marketplace.connected', userId: user.id, workspaceId: workspace.id, target: 'Partner Center', details: { market: marketId } });
  refresh();
  return { success: (await getMessages(marketsMessages)).connectedNow };
}

export async function disconnectPartnerCenterAction(marketId: string): Promise<void> {
  const { user, workspace } = await requireAdmin();
  await removeCredentials(getDb(), workspace.id, marketId);
  await record({ action: 'marketplace.disconnected', userId: user.id, workspaceId: workspace.id, target: 'Partner Center', details: { market: marketId } });
  refresh();
}

export async function renewLeadAddressAction(marketId: string): Promise<void> {
  await requireAdmin().then(({ workspace }) => renewLeadToken(getDb(), workspace.id, marketId));
  refresh();
}

/** Reads the marketplace's numbers now instead of waiting for the worker. */
export async function syncMarketplaceAction(marketId: string): Promise<MarketState> {
  const { workspace } = await requireAdmin();
  const t = await getMessages(marketsMessages);
  try {
    const outcome = await syncMarketplace(getDb(), workspace.id, marketId);
    refresh();
    if (outcome.status === 'synced') return { success: t.synced(outcome.days) };
    if (outcome.status === 'scheduled') return { success: t.syncScheduled };
    if (outcome.status === 'waiting') return { success: t.syncWaiting };
    return { error: t.notConnected };
  } catch (error) {
    refresh();
    return failure(error);
  }
}

/** Deletes a product's leads (personal data). */
export async function deleteProductLeadsAction(productId: string): Promise<void> {
  const { user, workspace } = await requireAdmin();
  const db = getDb();
  const product = await getProduct(db, workspace.id, productId);
  if (!product) return;
  const deleted = await deleteLeads(db, workspace.id, { productId });
  if (deleted > 0) await record({ action: 'leads.deleted', userId: user.id, workspaceId: workspace.id, target: product.name, details: { count: deleted } });
  revalidatePath(`/brand/products/${productId}`);
}

export async function deleteLeadAction(productId: string, leadId: string): Promise<void> {
  const { workspace } = await requireAdmin();
  await deleteLeads(getDb(), workspace.id, { leadId });
  revalidatePath(`/brand/products/${productId}`);
}
