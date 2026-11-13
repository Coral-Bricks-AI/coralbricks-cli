import { existsSync } from 'node:fs'

/**
 * Which coding agent, if any, is running `coralbricks login`, so the console can say which agents
 * bring people to CoralBricks (coralbricks-web src/lib/signupIntent.ts reads it from /cli/login).
 *
 * Only the agent's name leaves this machine, as a short slug. Never a value from these variables
 * (a session or thread id), never anything else from the environment.
 *
 * `CORALBRICKS_AGENT` comes first: a name to send instead (for an agent we don't detect), or
 * `none` to send no agent at all. Then the markers, which follow Vercel's @vercel/detect-agent
 * (1.2.7, Apache-2.0), tracking what each agent sets in the shells it runs commands in; check it
 * again when an agent shows up as `none`. The order matters, as it does there: `AI_AGENT` (the
 * cross-agent standard Vercel promotes), then each agent's own variable.
 *
 * Three of its markers are left out on purpose, because a person typing in their own terminal has
 * them too: `CURSOR_TRACE_ID` (every Cursor terminal), `REPL_ID` (every Replit shell) and
 * `COPILOT_GITHUB_TOKEN` (a token people export themselves).
 *
 * Claude Code's Cowork mode is told apart by `CLAUDE_CODE_IS_COWORK`, also when `AI_AGENT` names
 * Claude Code: `AI_AGENT` says which agent, the Cowork flag says which mode of it.
 *
 * With no marker the answer is `none`, so the console can tell "no agent" from an older CLI.
 */
const AGENT_SLUG = /^[a-z0-9][a-z0-9.-]{0,31}$/
const DEVIN_PATH = '/opt/.devin'
const NONE = 'none'

type Env = NodeJS.ProcessEnv

const isCowork = (env: Env) => Boolean(env.CLAUDE_CODE_IS_COWORK)

const MARKERS: ReadonlyArray<{ name: string; present: (env: Env) => boolean }> = [
  { name: 'cursor', present: (env) => Boolean(env.CURSOR_AGENT) || env.CURSOR_EXTENSION_HOST_ROLE === 'agent-exec' },
  { name: 'gemini-cli', present: (env) => Boolean(env.GEMINI_CLI) },
  { name: 'codex', present: (env) => Boolean(env.CODEX_SANDBOX || env.CODEX_CI || env.CODEX_THREAD_ID || env.CODEX_SANDBOX_NETWORK_DISABLED) },
  { name: 'antigravity', present: (env) => Boolean(env.ANTIGRAVITY_AGENT) },
  { name: 'augment', present: (env) => Boolean(env.AUGMENT_AGENT) },
  { name: 'opencode', present: (env) => env.OPENCODE === '1' || Boolean(env.OPENCODE_CLIENT) },
  { name: 'claude-code', present: (env) => Boolean(env.CLAUDECODE || env.CLAUDE_CODE) },
  { name: 'github-copilot', present: (env) => Boolean(env.COPILOT_MODEL || env.COPILOT_ALLOW_ALL) },
]

/**
 * An agent name as a short slug, without a version: `claude-code_2-1-323_agent` (what Claude Code
 * sets in `AI_AGENT`) and `devin@1` (Vercel's suggested form) are `claude-code` and `devin`.
 * Undefined when it isn't a name.
 */
export function agentSlug(value: string | undefined): string | undefined {
  const name = value?.trim().toLowerCase().split(/[@_]/)[0]
  if (!name || !AGENT_SLUG.test(name) || name.replace(/\D/g, '').length > 4) return undefined
  return name === 'github-copilot-cli' ? 'github-copilot' : name
}

export function detectAgent(env: Env = process.env, hasDevinMarker: () => boolean = () => existsSync(DEVIN_PATH)): string {
  const override = agentSlug(env.CORALBRICKS_AGENT)
  if (override) return override
  const named = agentSlug(env.AI_AGENT) ?? MARKERS.find(({ present }) => present(env))?.name
  if (named === 'claude-code' && isCowork(env)) return 'claude-cowork'
  return named ?? (hasDevinMarker() ? 'devin' : NONE)
}
