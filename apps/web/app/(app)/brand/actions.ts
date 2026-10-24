'use server';

import { revalidatePath } from 'next/cache';
import { BrandError, saveBrandKit, type BrandKitInput } from '@maas/core';
import { getDb } from '@maas/db';
import { record } from '@/lib/audit';
import { getMessages, localizedError } from '@/lib/i18n-server';
import { requireAdmin } from '@/lib/session';
import { brandMessages } from '@/messages/brand';

export type BrandState = { error?: string; success?: string };

function ids(value: FormDataEntryValue | null): string[] {
  try {
    const parsed: unknown = JSON.parse(String(value ?? '[]'));
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** Saves the workspace's brand kit (owners and admins). */
export async function saveBrandKitAction(_: BrandState, form: FormData): Promise<BrandState> {
  const { user, workspace } = await requireAdmin();
  const field = (name: string) => String(form.get(name) ?? '');
  const input: BrandKitInput = {
    companyName: field('companyName'),
    tagline: field('tagline'),
    description: field('description'),
    audience: field('audience'),
    tone: field('tone'),
    dos: field('dos'),
    donts: field('donts'),
    colors: { primary: field('primary'), secondary: field('secondary'), accent: field('accent'), text: field('text'), background: field('background') },
    font: field('font'),
    logoMediaId: ids(form.get('logo'))[0] ?? null,
    website: field('website'),
    email: field('email'),
    phone: field('phone'),
    address: field('address'),
    character:
      form.get('hasCharacter') === '1'
        ? {
            name: field('characterName'),
            role: field('characterRole'),
            look: field('characterLook'),
            personality: field('characterPersonality'),
            voice: field('characterVoice'),
            catchphrase: field('catchphrase'),
            rules: field('characterRules'),
            imageMediaIds: ids(form.get('characterImages')),
          }
        : null,
  };
  try {
    await saveBrandKit(getDb(), workspace.id, input);
  } catch (error) {
    if (error instanceof BrandError) return { error: await localizedError(error) };
    throw error;
  }
  await record({ action: 'brand.updated', userId: user.id, workspaceId: workspace.id, target: input.companyName });
  revalidatePath('/brand');
  revalidatePath('/canvas');
  return { success: (await getMessages(brandMessages)).saved };
}
