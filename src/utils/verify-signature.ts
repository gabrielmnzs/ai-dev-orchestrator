import crypto from 'crypto';

type SignatureAlgorithm = 'sha256' | 'sha1';

export const verifySignature = (
  secret: string,
  payload: string,
  signatureHeader: string | undefined,
  algorithm: SignatureAlgorithm
): boolean => {
  if (!signatureHeader) {
    return false;
  }

  const expected = `${algorithm}=${crypto.createHmac(algorithm, secret).update(payload).digest('hex')}`;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(signatureHeader);

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
};
