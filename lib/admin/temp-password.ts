import { randomBytes } from 'node:crypto';

// =============================================================================
// HVA-91/92: temp-password generator
// =============================================================================
//
// 12-char alphanumeric (a-z, A-Z, 0-9 — 62 chars). ~71 bits of entropy.
// Excludes I/l/1/O/0 ambiguity? — NO, admin reads the password out loud
// to the user once; readability matters less than entropy here. We can
// add ambiguity-stripping later if call quality becomes a real issue.
//
// crypto.randomBytes via rejection sampling — straightforward unbiased
// sample over a 62-character alphabet without a modulo skew.
// =============================================================================

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const LENGTH = 12;
const ALPHABET_LEN = ALPHABET.length;
// Largest multiple of 62 that fits in a single byte (256). 256 % 62 = 8,
// so values 248–255 are rejected to avoid a modulo bias.
const REJECT_THRESHOLD = 256 - (256 % ALPHABET_LEN);

export function generateTempPassword(): string {
  const out: string[] = [];
  while (out.length < LENGTH) {
    // Allocate a small over-sized buffer so most loops pick all needed
    // characters in one syscall. Rejection still works correctly with
    // any buffer size.
    const buf = randomBytes(LENGTH * 2);
    for (let i = 0; i < buf.length && out.length < LENGTH; i++) {
      const b = buf[i];
      if (b < REJECT_THRESHOLD) {
        out.push(ALPHABET[b % ALPHABET_LEN]);
      }
    }
  }
  return out.join('');
}
