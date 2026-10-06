import { blueskyClientMetadata } from '@postwerk/core';
import { appUrl } from '@/lib/env';

/** Bluesky servers read this document to learn who Postwerk is; its URL is the OAuth client id. */
export function GET() {
  const metadata = blueskyClientMetadata(appUrl);
  if (!metadata) return new Response('Bluesky sign-in needs Postwerk on an https address.', { status: 404 });
  return Response.json(metadata, { headers: { 'cache-control': 'public, max-age=300' } });
}
