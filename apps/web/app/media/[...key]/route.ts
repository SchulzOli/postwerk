import { NextResponse, type NextRequest } from 'next/server';
import { contentTypeOfKey, getMediaStorage, isMediaKey } from '@postwerk/core';

/**
 * Serves uploads to browsers and social networks (which fetch them without
 * signing in; keys are random and unlisted). Only image/video types exist,
 * and nosniff + a locked-down CSP keep a file from ever running as a page.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  const key = (await params).key.join('/');
  if (!isMediaKey(key)) return new NextResponse('Not found', { status: 404 });
  const storage = getMediaStorage();
  if (storage.redirectUrl) return NextResponse.redirect(await storage.redirectUrl(key), 302);

  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('range') ?? '');
  const file = await storage.get(key, range ? { start: Number(range[1]), end: range[2] ? Number(range[2]) : undefined } : undefined);
  if (!file) return new NextResponse('Not found', { status: 404 });

  const headers = new Headers({
    'content-type': contentTypeOfKey(key),
    'cache-control': 'public, max-age=31536000, immutable',
    'accept-ranges': 'bytes',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
  });
  if (file.range) {
    if (file.range.start >= file.size) return new NextResponse(null, { status: 416, headers: { 'content-range': `bytes */${file.size}` } });
    headers.set('content-range', `bytes ${file.range.start}-${file.range.end}/${file.size}`);
    headers.set('content-length', String(file.range.end - file.range.start + 1));
    return new NextResponse(file.body, { status: 206, headers });
  }
  headers.set('content-length', String(file.size));
  return new NextResponse(file.body, { status: 200, headers });
}
