import fs from 'node:fs/promises'
import path from 'node:path'
import { BASE_URL, CONSOLE_ROOT, KEY_ENV, PROVIDER_ID, PROVIDER_NAME } from '../constants.js'
import { specFor } from '../models.js'
import type { Tool } from './types.js'

/** Codex subcommands: the provider overrides go after the subcommand, like Codex's own flags. */
const SUBCOMMANDS = new Set([
  'app-server', 'apply', 'archive', 'cloud', 'completion', 'debug', 'delete', 'doctor', 'exec', 'exec-server', 'features',
  'fork', 'help', 'login', 'logout', 'mcp', 'mcp-server', 'plugin', 'remote-control', 'resume', 'review', 'sandbox',
  'unarchive', 'update',
])

const toml = (value: string) => JSON.stringify(value)

/**
 * Codex CLI over the Responses API (public/content/codex.md), configured entirely with `-c`
 * overrides. Unlike a separate CODEX_HOME, that keeps the person's own Codex home (sessions,
 * AGENTS.md, MCP servers, `codex resume`) while never writing to their config.toml: the overrides
 * live only on this command line, and the key only in this process's environment.
 *
 * The model catalog (window sizes, reasoning levels and their defaults) is the one the website hosts for Codex,
 * cached by the launcher; without it Codex assumes a 272K window.
 */
export const codex: Tool = {
  id: 'codex',
  label: 'Codex CLI',
  command: 'codex',
  install: 'npm install -g @openai/codex',
  docs: 'https://www.coralbricks.ai/docs/codex',
  async plan(ctx) {
    const spec = specFor(ctx.model, ctx.models)
    const overrides = [
      `model=${toml(ctx.model)}`,
      `model_provider=${toml(PROVIDER_ID)}`,
      `model_providers.${PROVIDER_ID}.name=${toml(PROVIDER_NAME)}`,
      `model_providers.${PROVIDER_ID}.base_url=${toml(BASE_URL)}`,
      `model_providers.${PROVIDER_ID}.env_key=${toml(KEY_ENV)}`,
      `model_providers.${PROVIDER_ID}.wire_api="responses"`,
      `model_context_window=${spec.contextWindow}`,
    ]
    const catalog = await ensureCatalog(ctx.cacheDir)
    if (catalog) overrides.push(`model_catalog_json=${toml(catalog)}`)
    const flags = overrides.flatMap((o) => ['-c', o])
    const [first, ...rest] = ctx.extraArgs
    const args = first && SUBCOMMANDS.has(first) ? [first, ...flags, ...rest] : [...flags, ...ctx.extraArgs]
    return { command: 'codex', args, env: { [KEY_ENV]: ctx.apiKey }, files: [] }
  },
}

const CATALOG_URL = `${CONSOLE_ROOT}/downloads/coralbricks-codex-models.json`
const CATALOG_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** The hosted catalog, refreshed daily; a stale copy beats none, and none just means Codex's defaults. */
async function ensureCatalog(cacheDir: string): Promise<string | null> {
  const file = path.join(cacheDir, 'codex-models.json')
  const age = await fs.stat(file).then((s) => Date.now() - s.mtimeMs, () => Infinity)
  if (age < CATALOG_MAX_AGE_MS) return file
  try {
    const res = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(8000) })
    const text = await res.text()
    if (!res.ok || !Array.isArray((JSON.parse(text) as { models?: unknown }).models)) throw new Error('bad catalog')
    await fs.mkdir(cacheDir, { recursive: true })
    await fs.writeFile(file, text)
    return file
  } catch {
    return Number.isFinite(age) ? file : null
  }
}
