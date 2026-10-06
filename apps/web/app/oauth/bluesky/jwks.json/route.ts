import { blueskyClientIds, blueskyJwks } from '@postwerk/core';
import { getDb } from '@postwerk/db';
import { appUrl } from '@/lib/env';

/** The public key Postwerk signs its Bluesky token requests with. */
export async function GET() {
  if (!blueskyClientIds(appUrl)?.confidential) return new Response('Bluesky sign-in needs Postwerk on an https address.', { status: 404 });
  return Response.json(await blueskyJwks(getDb()), { headers: { 'cache-control': 'public, max-age=300' } });
}
