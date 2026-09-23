/**
 * Gravatar avatars for message senders/recipients. Off by default (see AppSettings.showAvatars) --
 * this reaches an external service (gravatar.com) with a hash of the contact's email, the same
 * privacy trade-off as remote images in a message body, just per-contact instead of per-message.
 *
 * No network/Node access needed at call sites: this is a pure `email -> URL` function, computed
 * with a small local MD5 (Gravatar's addressing scheme; not used for anything security-sensitive).
 */

/** RFC 1321 MD5, hex digest. Minimal, self-contained (no dependency) -- verified against the
 *  standard test vectors in tests/renderer/avatar.test.ts. */
export function md5Hex(input: string): string {
  const bytes = utf8Bytes(input)
  const msgLenBits = bytes.length * 8

  // Pad: 0x80, then zeros, until total length ≡ 56 (mod 64); the trailing 8 bytes (original
  // bit-length, little-endian) then bring it to an exact multiple of 64.
  let paddedLen = bytes.length + 1
  while (paddedLen % 64 !== 56) paddedLen++
  paddedLen += 8
  const padded = new Uint8Array(paddedLen)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  new DataView(padded.buffer).setUint32(padded.length - 8, msgLenBits >>> 0, true)
  new DataView(padded.buffer).setUint32(padded.length - 4, Math.floor(msgLenBits / 2 ** 32), true)

  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]
  const view = new DataView(padded.buffer)

  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    const M: number[] = []
    for (let i = 0; i < 16; i++) M.push(view.getUint32(chunk + i * 4, true))
    let [A, B, C, D] = [a0, b0, c0, d0]
    for (let i = 0; i < 64; i++) {
      let F: number, g: number
      if (i < 16) { F = (B & C) | (~B & D); g = i }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16 }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16 }
      else { F = C ^ (B | ~D); g = (7 * i) % 16 }
      F = (F + A + K[i] + M[g]) | 0
      A = D; D = C; C = B
      B = (B + rotl(F, S[i])) | 0
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0
  }
  return [a0, b0, c0, d0].map(toHexLE).join('')
}

const rotl = (x: number, n: number): number => (x << n) | (x >>> (32 - n))
const toHexLE = (n: number): string => {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, n, true)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}
const utf8Bytes = (s: string): Uint8Array => new TextEncoder().encode(s)

const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0)
const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
]

/** Gravatar URL for an email, `d=404` so a missing avatar 404s (caller falls back to initials)
 *  instead of Gravatar's default placeholder art. */
export function gravatarUrl(email: string, size = 64): string {
  const hash = md5Hex(email.trim().toLowerCase())
  return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=404`
}
