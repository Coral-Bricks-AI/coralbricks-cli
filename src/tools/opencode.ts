import { execFileSync } from 'node:child_process'
import { BASE_URL, KEY_ENV, PROVIDER_ID, PROVIDER_NAME } from '../constants.js'
import { displayName } from '../models.js'
import type { Tool } from './types.js'

/**
 * OpenCode, which already knows CoralBricks from models.dev (public/content/opencode.md). The
 * launch adds a config layer through OPENCODE_CONFIG_CONTENT, which OpenCode merges over the
 * person's own files without touching them: the provider's address, the key by reference, every
 * model the account can call (so a model newer than models.dev still shows), and the default.
 *
 * OpenCode 2 runs one background service per user and every `opencode` attaches to it, so the
 * service, not the launch, would hold this config (and keep holding it for later plain `opencode`
 * runs). `--standalone` gives the launch a private server that ends with it.
 */
export const opencode: Tool = {
  id: 'opencode',
  label: 'OpenCode',
  aliases: ['oc'],
  command: 'opencode',
  install: 'npm install -g opencode-ai',
  docs: 'https://www.coralbricks.ai/docs/opencode',
  plan(ctx) {
    const models = Object.fromEntries(
      ctx.models.map((m) => [m.id, { name: displayName(m.id), limit: { context: m.contextWindow, output: m.maxOutputTokens } }]),
    )
    const config = {
      $schema: 'https://opencode.ai/config.json',
      model: `${PROVIDER_ID}/${ctx.model}`,
      provider: {
        [PROVIDER_ID]: {
          name: PROVIDER_NAME,
          options: { baseURL: BASE_URL, apiKey: `{env:${KEY_ENV}}`, setCacheKey: true },
          models,
        },
      },
    }
    return {
      command: 'opencode',
      args: standalone(ctx.extraArgs) ? [...ctx.extraArgs, '--standalone'] : [...ctx.extraArgs],
      env: {
        [KEY_ENV]: ctx.apiKey,
        // What OpenCode's built-in CoralBricks provider reads, should anything bypass the config.
        CORAL_API_KEY: ctx.apiKey,
        OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
      },
      files: [],
    }
  },
}

/** OpenCode 2's TUI and `run` take --standalone; 1.x has no background service and no such flag. */
function standalone(extraArgs: readonly string[]): boolean {
  const first = extraArgs[0]
  if (first && !first.startsWith('-') && first !== 'run') return false
  if (extraArgs.includes('--standalone') || extraArgs.includes('--server')) return false
  try {
    const version = execFileSync('opencode', ['--version'], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] })
    return Number(/(\d+)\./.exec(version)?.[1] ?? 0) >= 2
  } catch {
    return false
  }
}
