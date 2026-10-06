import { NextResponse } from 'next/server';
import { verifyEmail } from '@postwerk/core';
import { getDb } from '@postwerk/db';
import { record } from '@/lib/audit';
import { appUrl } from '@/lib/env';
import { getSession } from '@/lib/session';

/** The link from the confirmation email: confirms the address, then goes to the app with a notice. */
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const userId = await verifyEmail(getDb(), token);
  if (userId) await record({ action: 'email.verified', userId });
  const target = (await getSession()) ? '/canvas' : '/login';
  return NextResponse.redirect(`${appUrl}${target}?notice=${userId ? 'verified' : 'verify-expired'}`);
}
