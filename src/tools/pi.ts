import fs from 'node:fs/promises'
import path from 'node:path'
import { BASE_URL, KEY_ENV, PROVIDER_ID, PROVIDER_NAME } from '../constants.js'
import { displayName } from '../models.js'
import type { Tool } from './types.js'

/**
 * Pi (public/content/pi.md). Pi reads providers only from its agent directory, so the launch gets
 * a temporary one (PI_CODING_AGENT_DIR) holding the person's own models.json with a CoralBricks
 * provider merged in; their real ~/.pi/agent is read, never written. Sessions go to a directory
 * that outlives the launch, so `--continue` and `--resume` keep working between launches.
 */
export const pi: Tool = {
  id: 'pi',
  label: 'Pi',
  command: 'pi',
  install: 'npm install -g --ignore-scripts @earendil-works/pi-coding-agent',
  docs: 'https://www.coralbricks.ai/docs/pi',
  async plan(ctx) {
    const ownDir = ctx.env.PI_CODING_AGENT_DIR || path.join(ctx.homeDir, '.pi', 'agent')
    const existing = await readJson(path.join(ownDir, 'models.json'))
    const providers = (existing.providers && typeof existing.providers === 'object' ? existing.providers : {}) as Record<string, unknown>
    const agentDir = path.join(ctx.sessionDir, 'pi-agent')
    const config = {
      ...existing,
      providers: {
        ...providers,
        [PROVIDER_ID]: {
          name: PROVIDER_NAME,
          baseUrl: BASE_URL,
          api: 'openai-completions',
          apiKey: `$${KEY_ENV}`,
          compat: { supportsDeveloperRole: false, maxTokensField: 'max_tokens', supportsPromptCacheKey: true },
          models: ctx.models.map((m) => ({
            id: m.id,
            name: displayName(m.id),
            reasoning: m.reasoning.efforts.length > 0,
            input: m.imageInput ? ['text', 'image'] : ['text'],
            contextWindow: m.contextWindow,
            maxTokens: m.maxOutputTokens,
            ...(m.price ? { cost: { input: m.price.input, output: m.price.output, cacheRead: 0, cacheWrite: m.price.cacheWrite } } : {}),
          })),
        },
      },
    }
    return {
      command: 'pi',
      args: ['--provider', PROVIDER_ID, '--model', ctx.model, '--session-dir', path.join(ctx.cacheDir, 'pi-sessions'), ...ctx.extraArgs],
      env: { [KEY_ENV]: ctx.apiKey, PI_CODING_AGENT_DIR: agentDir },
      files: [{ path: path.join(agentDir, 'models.json'), contents: `${JSON.stringify(config, null, 2)}\n` }],
    }
  },
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
