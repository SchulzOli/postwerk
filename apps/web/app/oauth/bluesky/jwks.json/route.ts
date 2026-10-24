import { blueskyClientIds, blueskyJwks } from '@maas/core';
import { getDb } from '@maas/db';
import { appUrl } from '@/lib/env';

/** The public key MarketingAsAService signs its Bluesky token requests with. */
export async function GET() {
  if (!blueskyClientIds(appUrl)?.confidential) return new Response('Bluesky sign-in needs MarketingAsAService on an https address.', { status: 404 });
  return Response.json(await blueskyJwks(getDb()), { headers: { 'cache-control': 'public, max-age=300' } });
}
