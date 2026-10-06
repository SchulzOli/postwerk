import { NextResponse, type NextRequest } from 'next/server';
import { hitRateLimit, MediaError, rateLimitKey, retryIn, storeUpload } from '@postwerk/core';
import { getDb } from '@postwerk/db';
import { getSession } from '@/lib/session';

const UPLOADS_PER_HOUR = { limit: 300, windowMs: 60 * 60_000 };

/**
 * Upload one file: the raw bytes as the body, with Content-Type and
 * Content-Length set (the browser does this for a File). Answers with the
 * stored media, ready to attach to a post.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Please log in again.' }, { status: 401 });
  const size = Number(request.headers.get('content-length'));
  if (!request.body || !Number.isFinite(size)) return NextResponse.json({ error: 'The upload is missing its file.' }, { status: 411 });

  const db = getDb();
  const limit = await hitRateLimit(db, rateLimitKey('upload:user', session.user.id), UPLOADS_PER_HOUR);
  if (!limit.allowed) return NextResponse.json({ error: `Too many uploads. Please try again ${retryIn(limit.retryAfterMs)}.` }, { status: 429 });

  try {
    const row = await storeUpload(db, {
      workspaceId: session.workspace.id,
      userId: session.user.id,
      contentType: request.headers.get('content-type') ?? '',
      size,
      body: request.body,
    });
    return NextResponse.json({ id: row.id, url: `/media/${row.key}`, kind: row.kind, mimeType: row.mimeType, size: row.size }, { status: 201 });
  } catch (error) {
    if (error instanceof MediaError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('upload failed', error);
    return NextResponse.json({ error: 'The upload failed. Please try again.' }, { status: 500 });
  }
}
