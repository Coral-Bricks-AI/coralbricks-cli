import { createDecipheriv, createECDH, createHash, hkdfSync, randomBytes, type ECDH } from 'node:crypto'

/**
 * How a browser hands this terminal a key without the key ever crossing the network in the clear.
 *
 * The CLI makes a one-off P-256 key pair and puts the public half in the console's /cli/login
 * address. The signed-in console creates a key, then seals it to that public key: ECDH with a key
 * pair of its own, HKDF-SHA256 (salt = the login's `state`, info = HKDF_INFO), AES-256-GCM. What
 * comes back (through the local callback, or pasted by hand on a remote box) is
 *
 *     base64url( browser public key (65 bytes, uncompressed) | iv (12) | ciphertext + tag )
 *
 * and only this process can open it. The console's side is coralbricks-web
 * src/lib/cliHandoff.ts; HKDF_INFO and the layout must stay identical in both.
 *
 * Both sides also show a check code taken from the CLI's public key, so the person approving can
 * see the browser is talking to the terminal in front of them.
 */
export const HKDF_INFO = 'coralbricks-cli-login/v1'

export interface Handoff {
  ecdh: ECDH
  /** base64url of the uncompressed P-256 public key. */
  publicKey: string
  /** base64url random, echoed back by the console; also the HKDF salt. */
  state: string
  /** `ABCD-EFGH`, shown in the terminal and on the approval page. */
  checkCode: string
}

/** What the console seals: the new key and its id (for the "connected" line). */
export interface HandoffPayload {
  apiKey: string
  keyId?: number | string
  name?: string
}

export function createHandoff(): Handoff {
  const ecdh = createECDH('prime256v1')
  const pub = ecdh.generateKeys()
  return { ecdh, publicKey: pub.toString('base64url'), state: randomBytes(16).toString('base64url'), checkCode: checkCodeFor(pub) }
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Eight Crockford base32 characters of SHA-256(public key), as `ABCD-EFGH`. */
export function checkCodeFor(publicKey: Uint8Array): string {
  const digest = createHash('sha256').update(publicKey).digest()
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of digest) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5 && out.length < 8) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
    if (out.length === 8) break
  }
  return `${out.slice(0, 4)}-${out.slice(4)}`
}

/** Opens a sealed blob; throws on anything that isn't one sealed to this handoff. */
export function openHandoff(handoff: Handoff, sealed: string): HandoffPayload {
  const blob = Buffer.from(sealed.trim(), 'base64url')
  if (blob.length < 65 + 12 + 16 + 1) throw new Error('That code is incomplete.')
  const peer = blob.subarray(0, 65)
  const iv = blob.subarray(65, 77)
  const body = blob.subarray(77, blob.length - 16)
  const tag = blob.subarray(blob.length - 16)
  let plain: string
  try {
    const secret = handoff.ecdh.computeSecret(peer)
    const key = Buffer.from(hkdfSync('sha256', secret, Buffer.from(handoff.state, 'utf8'), Buffer.from(HKDF_INFO, 'utf8'), 32))
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    plain = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('That code was not made for this terminal. Run coralbricks login again.')
  }
  const payload = JSON.parse(plain) as HandoffPayload
  if (typeof payload.apiKey !== 'string' || !payload.apiKey.trim()) throw new Error('The console sent an empty key.')
  return { ...payload, apiKey: payload.apiKey.trim() }
}
