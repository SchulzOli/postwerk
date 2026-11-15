import { NextResponse, type NextRequest } from 'next/server';
import { receiveLead } from '@maas/core';
import { getDb } from '@maas/db';

/** Leads are small; anything bigger is not one. */
const MAX_BYTES = 64 * 1024;

/**
 * Where a marketplace posts its leads: Partner Center's "HTTPS endpoint"
 * lead destination. The address's token is the workspace's secret; there is
 * no session. Partner Center's "Validate" button posts a test lead here.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const text = await request.text();
  if (text.length > MAX_BYTES) return NextResponse.json({ error: 'too large' }, { status: 413 });
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'expected JSON' }, { status: 400 });
  }
  const known = await receiveLead(getDb(), token, payload);
  return known ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'unknown address' }, { status: 404 });
}
