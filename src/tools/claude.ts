import path from 'node:path'
import { INFERENCE_ROOT } from '../constants.js'
import { displayName, specFor } from '../models.js'
import type { Tool } from './types.js'

const SLOTS = ['OPUS', 'SONNET', 'FABLE', 'HAIKU'] as const

/**
 * Claude Code over the gateway's Anthropic Messages API (public/content/claude-code.md).
 *
 * The connection goes in a `--settings` file as well as the environment: a user's own
 * ~/.claude/settings.json `env` block would otherwise win over the process environment and send the
 * session somewhere else. The file is 0600 in the launch's own directory and removed on exit, so
 * the key never sits in argv or in the user's config.
 *
 * Every tier alias (opus, sonnet, fable, haiku) points at a CoralBricks model, or Claude Code's
 * background calls would ask the gateway for Anthropic model names it doesn't serve. The chosen
 * model takes the top tiers; haiku, used for cheap background work, takes the account's cheapest.
 */
export const claude: Tool = {
  id: 'claude',
  label: 'Claude Code',
  aliases: ['claude-code', 'cc'],
  command: 'claude',
  install: 'npm install -g @anthropic-ai/claude-code',
  docs: 'https://www.coralbricks.ai/docs/claude-code',
  plan(ctx) {
    const spec = specFor(ctx.model, ctx.models)
    const cheapest = [...ctx.models].sort((a, b) => (a.price?.output ?? Infinity) - (b.price?.output ?? Infinity))[0]?.id ?? ctx.model
    // One window for the whole session: the smallest of the models it can switch between.
    const seated = [ctx.model, cheapest].map((id) => specFor(id, ctx.models))
    const window = Math.min(...seated.map((m) => m.contextWindow))
    const output = Math.min(...seated.map((m) => m.maxOutputTokens))
    const connection: Record<string, string> = {
      ANTHROPIC_BASE_URL: INFERENCE_ROOT,
      ANTHROPIC_AUTH_TOKEN: ctx.apiKey,
      ANTHROPIC_MODEL: ctx.model,
      ANTHROPIC_CUSTOM_MODEL_OPTION: ctx.model,
      ANTHROPIC_CUSTOM_MODEL_OPTION_NAME: `CoralBricks ${displayName(spec.id)}`,
      CLAUDE_CODE_MAX_CONTEXT_TOKENS: String(window),
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(output),
      // Anthropic-only traffic (model discovery, attribution header, feedback surveys) has
      // nowhere to go on this endpoint.
      CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '0',
      CLAUDE_CODE_ATTRIBUTION_HEADER: '0',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    }
    for (const slot of SLOTS) {
      const id = slot === 'HAIKU' ? cheapest : ctx.model
      connection[`ANTHROPIC_DEFAULT_${slot}_MODEL`] = id
      connection[`ANTHROPIC_DEFAULT_${slot}_MODEL_NAME`] = `CoralBricks ${displayName(id)}`
    }
    const settingsPath = path.join(ctx.sessionDir, 'claude-settings.json')
    return {
      command: 'claude',
      args: ['--settings', settingsPath, '--model', ctx.model, ...ctx.extraArgs],
      env: connection,
      // An Anthropic key in the shell would be sent instead of ours.
      unsetEnv: ['ANTHROPIC_API_KEY'],
      files: [{ path: settingsPath, contents: `${JSON.stringify({ env: connection, model: ctx.model }, null, 2)}\n` }],
    }
  },
}
