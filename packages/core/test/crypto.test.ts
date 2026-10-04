import { describe, expect, it } from 'vitest';
import { decrypt, decryptJson, encrypt, encryptJson } from '../src/crypto';
import { generateToken, hashPassword, hashToken, verifyPassword } from '../src/password';

describe('encryption', () => {
  it('round-trips and uses a fresh IV each time', () => {
    const a = encrypt('secret');
    expect(decrypt(a)).toBe('secret');
    expect(encrypt('secret')).not.toBe(a);
    expect(decryptJson(encryptJson({ token: 'x' }))).toEqual({ token: 'x' });
  });

  it('detects tampering', () => {
    const [v, iv, tag, data] = encrypt('secret').split('.');
    const flipped = Buffer.from(data!, 'base64url');
    flipped[0]! ^= 1;
    expect(() => decrypt([v, iv, tag, flipped.toString('base64url')].join('.'))).toThrow();
  });

  it('rejects a wrong key', () => {
    const otherKey = Buffer.alloc(32, 7).toString('base64');
    expect(() => decrypt(encrypt('secret'), otherKey)).toThrow();
    expect(() => encrypt('x', 'too-short')).toThrow(/32 bytes/);
  });
});

describe('passwords and tokens', () => {
  it('verifies the right password only', async () => {
    const hash = await hashPassword('correct horse');
    expect(await verifyPassword('correct horse', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });

  it('hashes tokens deterministically', () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toBe(token);
  });
});
