import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { KEY_ENV } from './constants.js'

export type KeySource = 'flag' | 'env' | 'stored'

/** ~/.config/coralbricks (or $XDG_CONFIG_HOME/coralbricks): the login and the last launch. */
export function configDir(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'coralbricks')
}

/** ~/.cache/coralbricks: per-launch session files and the model list. */
export function cacheDir(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
  return path.join(env.XDG_CACHE_HOME || path.join(home, '.cache'), 'coralbricks')
}

export const credentialFile = (env?: NodeJS.ProcessEnv) => path.join(configDir(env), 'credentials.json')

/** `cb_live_ab****...wxyz`: enough to tell keys apart, never enough to use one. */
export function maskKey(key: string): string {
  if (!key) return '****'
  const prefix = key.slice(0, Math.min(key.startsWith('cb_') ? 6 : 3, Math.max(0, key.length - 8)))
  const suffix = key.length > 12 ? key.slice(-4) : ''
  return `${prefix}****${suffix ? `...${suffix}` : ''}`
}

/** Replaces every secret in `text` with its mask (dry-run output, error messages). */
export function redact(text: string, secrets: readonly string[]): string {
  return secrets.reduce((out, s) => (s ? out.split(s).join(maskKey(s)) : out), text)
}

/** --api-key wins, then $CORALBRICKS_API_KEY, then the stored login. */
export async function resolveKey(flag: string | undefined, env: NodeJS.ProcessEnv = process.env): Promise<{ key: string; source: KeySource } | null> {
  if (flag?.trim()) return { key: flag.trim(), source: 'flag' }
  if (env[KEY_ENV]?.trim()) return { key: env[KEY_ENV]!.trim(), source: 'env' }
  const stored = await readStoredKey(env)
  return stored ? { key: stored, source: 'stored' } : null
}

export async function readStoredKey(env?: NodeJS.ProcessEnv): Promise<string | null> {
  const file = credentialFile(env)
  let text: string
  try {
    text = await fs.readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  try {
    const parsed = JSON.parse(text) as { apiKey?: unknown }
    return typeof parsed.apiKey === 'string' && parsed.apiKey.trim() ? parsed.apiKey.trim() : null
  } catch {
    throw new Error(`The stored login at ${file} is not valid JSON. Run coralbricks login again.`)
  }
}

/** Written 0600 inside a 0700 directory: the key is a bearer credential. */
export async function writeStoredKey(apiKey: string, env?: NodeJS.ProcessEnv): Promise<string> {
  const file = credentialFile(env)
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  await fs.writeFile(file, `${JSON.stringify({ apiKey, updatedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 })
  await fs.chmod(path.dirname(file), 0o700)
  await fs.chmod(file, 0o600)
  return file
}

export async function deleteStoredKey(env?: NodeJS.ProcessEnv): Promise<boolean> {
  try {
    await fs.rm(credentialFile(env))
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
