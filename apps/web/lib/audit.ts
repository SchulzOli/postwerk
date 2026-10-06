import 'server-only';
import { audit, type AuditInput } from '@postwerk/core';
import { getDb } from '@postwerk/db';
import { clientIp } from './request';

/** Records an audit event with the client's IP address. */
export async function record(entry: Omit<AuditInput, 'ip'>): Promise<void> {
  await audit(getDb(), { ...entry, ip: await clientIp() });
}
