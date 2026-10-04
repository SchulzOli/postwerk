import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';

function loadKey(key = process.env.ENCRYPTION_KEY): Buffer {
  if (!key) throw new Error('ENCRYPTION_KEY is not set (generate one with: openssl rand -base64 32)');
  const buffer = Buffer.from(key, 'base64');
  if (buffer.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes, base64 encoded');
  return buffer;
}

/** AES-256-GCM; output is "v1.<iv>.<tag>.<ciphertext>" in base64url. */
export function encrypt(plaintext: string, key?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', loadKey(key), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ciphertext].map((part) => (typeof part === 'string' ? part : part.toString('base64url'))).join('.');
}

export function decrypt(payload: string, key?: string): string {
  const [version, iv, tag, ciphertext] = payload.split('.');
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) throw new Error('Unsupported encrypted payload');
  const decipher = createDecipheriv('aes-256-gcm', loadKey(key), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}

export function encryptJson(value: unknown, key?: string): string {
  return encrypt(JSON.stringify(value), key);
}

export function decryptJson<T>(payload: string, key?: string): T {
  return JSON.parse(decrypt(payload, key)) as T;
}
