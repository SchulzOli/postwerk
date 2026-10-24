import { NextResponse, type NextRequest } from 'next/server';
import { getCampaign, getPiece } from '@maas/core';
import { renderPieceBriefing } from '@maas/core/briefing';
import { renderPiece } from '@maas/core/print';
import { getDb } from '@maas/db';
import { getLocale, getMessages } from '@/lib/i18n-server';
import { requireSession } from '@/lib/session';
import { campaignsMessages } from '@/messages/campaigns';
import { printMessages } from '@/messages/print';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A print piece as PDF, or a spot's production briefing. `download=1` saves
 * it, `marks=1` adds crop marks, `sample=1` addresses letters and postcards to
 * a sample recipient (for the preview).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; pieceId: string }> }) {
  const { workspace } = await requireSession();
  const locale = await getLocale();
  const { id, pieceId } = await params;
  if (!UUID.test(id) || !UUID.test(pieceId)) return new NextResponse('Not found', { status: 404 });
  const db = getDb();
  const piece = await getPiece(db, workspace.id, pieceId);
  if (!piece || piece.campaignId !== id || piece.kind === 'ad') return new NextResponse('Not found', { status: 404 });

  const query = request.nextUrl.searchParams;
  let pdf: Uint8Array;
  if (piece.kind === 'spot') {
    const [detail, c] = await Promise.all([getCampaign(db, workspace.id, id), getMessages(campaignsMessages)]);
    const campaign = detail!.campaign;
    pdf = await renderPieceBriefing(db, workspace, piece, { name: campaign.name, message: campaign.message, audience: campaign.audience }, c.formats[piece.format] ?? piece.format, locale);
  } else {
    const t = await getMessages(printMessages);
    ({ pdf } = await renderPiece(db, piece, {
      cropMarks: query.get('marks') === '1',
      recipient: query.get('sample') === '1' ? t.sampleRecipient : undefined,
      locale,
    }));
  }
  const name = `${piece.title.replace(/[^\p{L}\p{N}\- ]+/gu, '').trim().replace(/\s+/g, '-') || 'print'}${query.get('marks') === '1' ? '-marks' : ''}.pdf`;
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'content-type': 'application/pdf',
      // An ASCII name for older clients, the real one for the rest.
      'content-disposition': `${query.get('download') === '1' ? 'attachment' : 'inline'}; filename="${name.normalize('NFKD').replace(/[^\x20-\x7e]/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
