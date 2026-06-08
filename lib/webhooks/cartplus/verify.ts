import { createHmac, timingSafeEqual } from 'crypto';

// =============================================================================
// HVA-249 (HVA-230): CartPlus HMAC-SHA256 signature verification
// =============================================================================
//
// CartPlus signs every webhook delivery with HMAC-SHA256 over the raw
// request body using the secret configured per-webhook. We verify with a
// constant-time comparison to avoid leaking timing information about
// partial-match prefixes.
//
// Reference: README_Webhook.pdf §3. Signature header `X-CartPlus-Signature`
// is the hex-encoded HMAC-SHA256 digest of the raw body bytes.
// =============================================================================

/**
 * Compute the expected hex-encoded HMAC-SHA256 over `rawBody` using `secret`.
 */
export function computeCartplusSignature(secret: string, rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

/**
 * Constant-time comparison of the provided header against the expected
 * HMAC. Returns false on length mismatch (cheap pre-check) or any byte
 * difference. Never throws.
 */
export function verifyCartplusSignature(
  secret: string,
  rawBody: string,
  providedSignature: string | null | undefined,
): boolean {
  if (!providedSignature) return false;
  const expected = computeCartplusSignature(secret, rawBody);
  if (providedSignature.length !== expected.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(providedSignature, 'utf8'),
      Buffer.from(expected, 'utf8'),
    );
  } catch {
    return false;
  }
}
