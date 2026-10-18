import type { ModelSpec } from '../models.js'

export interface LaunchContext {
  apiKey: string
  model: string
  models: readonly ModelSpec[]
  /** A fresh directory for this launch's files, removed when the agent exits. */
  sessionDir: string
  /** ~/.cache/coralbricks: for files that should outlive one launch (sessions, catalogs). */
  cacheDir: string
  homeDir: string
  env: NodeJS.ProcessEnv
  /** Everything after `--`, passed to the agent untouched. */
  extraArgs: string[]
}

export interface LaunchFile {
  path: string
  contents: string
}

/** What a launch does, before it does it: what --dry-run prints. */
export interface LaunchPlan {
  command: string
  args: string[]
  /** Set for the agent's process only. */
  env: Record<string, string>
  /** Removed from the agent's environment (a stray key would win over ours). */
  unsetEnv?: string[]
  files: LaunchFile[]
}

export interface Tool {
  id: string
  label: string
  /** The agent's executable. */
  command: string
  aliases?: string[]
  /** How to install the agent itself when it isn't on PATH. */
  install: string
  docs: string
  plan(ctx: LaunchContext): Promise<LaunchPlan> | LaunchPlan
}
