import { describe, expect, it } from 'vitest';
import { amzDate, EMPTY_PAYLOAD_HASH, presignUrl, signRequest, uriEncode } from '../src/sigv4';

// The examples from AWS's S3 documentation ("Signature Calculations for the
// Authorization Header" and "Query String Authentication").
const credentials = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1' };
const now = new Date('2013-05-24T00:00:00Z');

describe('SigV4', () => {
  it('formats dates and encodes like S3', () => {
    expect(amzDate(now)).toBe('20130524T000000Z');
    expect(uriEncode('a b/c$d~e', true)).toBe('a%20b/c%24d~e');
    expect(uriEncode('ä')).toBe('%C3%A4');
  });

  it('signs AWS’s GET Object example', () => {
    const headers = signRequest(
      { method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt', headers: { Range: 'bytes=0-9' }, payloadHash: EMPTY_PAYLOAD_HASH, now },
      credentials,
    );
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
    expect(headers['x-amz-date']).toBe('20130524T000000Z');
  });

  it('signs AWS’s PUT Object example', () => {
    const payloadHash = '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072';
    const headers = signRequest(
      {
        method: 'PUT',
        url: 'https://examplebucket.s3.amazonaws.com/test$file.text',
        headers: { Date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' },
        payloadHash,
        now,
      },
      credentials,
    );
    expect(headers.authorization).toContain('SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class');
    expect(headers.authorization).toContain('Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
  });

  it('presigns AWS’s query string example', () => {
    const url = presignUrl({ url: 'https://examplebucket.s3.amazonaws.com/test.txt', expiresIn: 86400, now }, credentials);
    expect(url).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });
});
