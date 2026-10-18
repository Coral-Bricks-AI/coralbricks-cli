import { claude } from './claude.js'
import { codex } from './codex.js'
import { opencode } from './opencode.js'
import { pi } from './pi.js'
import type { Tool } from './types.js'

export const TOOLS: readonly Tool[] = [claude, codex, opencode, pi]

export function findTool(name: string): Tool | undefined {
  const n = name.toLowerCase()
  return TOOLS.find((t) => t.id === n || t.aliases?.includes(n))
}

export type { Tool, LaunchContext, LaunchPlan } from './types.js'
