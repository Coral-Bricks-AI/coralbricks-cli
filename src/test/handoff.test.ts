import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkCodeFor, createHandoff, HKDF_INFO, openHandoff } from '../handoff.js'

/** What the console does (coralbricks-web src/lib/cliHandoff.ts), with the same WebCrypto calls a browser makes. */
async function sealLikeTheBrowser(publicKey: string, state: string, payload: object): Promise<string> {
  const subtle = globalThis.crypto.subtle
  const peer = await subtle.importKey('raw', Buffer.from(publicKey, 'base64url'), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const mine = (await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
  const bits = await subtle.deriveBits({ name: 'ECDH', public: peer }, mine.privateKey, 256)
  const hkdf = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey'])
  const enc = new TextEncoder()
  const key = await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode(state), info: enc.encode(HKDF_INFO) }, hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt'])
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const body = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(payload))))
  const pub = new Uint8Array(await subtle.exportKey('raw', mine.publicKey))
  return Buffer.concat([pub, iv, body]).toString('base64url')
}

test('a key sealed by the browser opens in the terminal that asked for it', async () => {
  const h = createHandoff()
  const sealed = await sealLikeTheBrowser(h.publicKey, h.state, { apiKey: 'cb_live_secret', keyId: 7 })
  assert.deepEqual(openHandoff(h, sealed), { apiKey: 'cb_live_secret', keyId: 7 })
})

test('another terminal, or another login, cannot open it', async () => {
  const h = createHandoff()
  const other = createHandoff()
  const sealed = await sealLikeTheBrowser(h.publicKey, h.state, { apiKey: 'cb_live_secret' })
  assert.throws(() => openHandoff(other, sealed), /not made for this terminal/)
  assert.throws(() => openHandoff({ ...h, state: other.state }, sealed), /not made for this terminal/)
  assert.throws(() => openHandoff(h, sealed.slice(0, 40)), /incomplete/)
})

test('the check code is stable, eight Crockford characters', () => {
  const h = createHandoff()
  assert.match(h.checkCode, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/)
  assert.equal(checkCodeFor(Buffer.from(h.publicKey, 'base64url')), h.checkCode)
  // Fixed vector, shared with the console's test so both sides compute the same code.
  assert.equal(checkCodeFor(new Uint8Array(65).fill(4)), 'KFD9-BFD1')
})
