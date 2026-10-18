import fs from 'node:fs/promises'
import path from 'node:path'
import { BASE_URL, FALLBACK_MODEL } from './constants.js'
import { cacheDir } from './credentials.js'

/** One model as the CLI uses it, read from the gateway's GET /v1/models. */
export interface ModelSpec {
  id: string
  contextWindow: number
  /** Not in /v1/models; the documented limit for every current model. */
  maxOutputTokens: number
  imageInput: boolean
  reasoning: { efforts: string[]; defaultEffort: string | null; canDisable: boolean }
  /** USD per million tokens, on this account's plan. */
  price?: { input: number; output: number; cacheWrite: number }
  /** Tokens per second over the last day, when the gateway reports it. */
  decodeSpeed?: number
}

export const DEFAULT_MAX_OUTPUT = 32768
const DEFAULT_CONTEXT = 1048576

export class KeyRejectedError extends Error {
  constructor(status: number) {
    super(`CoralBricks rejected the API key (HTTP ${status}).`)
    this.name = 'KeyRejectedError'
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseModels(body: any): ModelSpec[] {
  const rows: unknown[] = Array.isArray(body?.data) ? body.data : []
  return rows.flatMap((row) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = row as any
    if (typeof r?.id !== 'string' || !r.id) return []
    if (r.supports_chat === false) return []
    const efforts: string[] = Array.isArray(r.reasoning?.supported_efforts) ? r.reasoning.supported_efforts.filter((e: unknown) => typeof e === 'string') : []
    const price = r.pricing && typeof r.pricing.input_per_m === 'number'
      ? { input: r.pricing.input_per_m, output: Number(r.pricing.output_per_m ?? 0), cacheWrite: Number(r.pricing.cache_write_per_m ?? 0) }
      : undefined
    return [{
      id: r.id,
      contextWindow: typeof r.context_length === 'number' && r.context_length > 0 ? r.context_length : DEFAULT_CONTEXT,
      maxOutputTokens: DEFAULT_MAX_OUTPUT,
      imageInput: r.supports_image_input === true,
      reasoning: {
        efforts,
        defaultEffort: typeof r.reasoning?.default_effort === 'string' ? r.reasoning.default_effort : null,
        canDisable: Boolean(r.reasoning?.disable),
      },
      price,
      decodeSpeed: typeof r.decode_speed_last_1d === 'number' ? r.decode_speed_last_1d : undefined,
    }]
  })
}

/** The account's models from the gateway; also proves the key works. */
export async function fetchModels(apiKey: string, fetcher: typeof fetch = fetch): Promise<ModelSpec[]> {
  const res = await fetcher(`${BASE_URL}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15000) })
  if (res.status === 401 || res.status === 403) throw new KeyRejectedError(res.status)
  if (!res.ok) throw new Error(`Could not read the model list (HTTP ${res.status}).`)
  return parseModels(await res.json())
}

const cacheFile = () => path.join(cacheDir(), 'models.json')

/** Live list, cached for offline launches; falls back to the cache when the gateway can't be reached. */
export async function loadModels(apiKey: string): Promise<{ models: ModelSpec[]; source: 'live' | 'cache' }> {
  try {
    const models = await fetchModels(apiKey)
    await fs.mkdir(path.dirname(cacheFile()), { recursive: true }).then(() => fs.writeFile(cacheFile(), JSON.stringify({ models, at: Date.now() }))).catch(() => {})
    return { models, source: 'live' }
  } catch (error) {
    if (error instanceof KeyRejectedError) throw error
    try {
      const cached = JSON.parse(await fs.readFile(cacheFile(), 'utf8')) as { models: ModelSpec[] }
      if (Array.isArray(cached.models) && cached.models.length) return { models: cached.models, source: 'cache' }
    } catch {
      /* no cache either */
    }
    throw error
  }
}

/** The documented default, or the first model the account can call. */
export function defaultModel(models: readonly ModelSpec[]): string {
  if (models.some((m) => m.id === FALLBACK_MODEL)) return FALLBACK_MODEL
  return models[0]?.id ?? FALLBACK_MODEL
}

/** A spec for any id, so a model the list doesn't carry still launches with sane limits. */
export function specFor(id: string, models: readonly ModelSpec[]): ModelSpec {
  return models.find((m) => m.id === id) ?? {
    id,
    contextWindow: DEFAULT_CONTEXT,
    maxOutputTokens: DEFAULT_MAX_OUTPUT,
    imageInput: false,
    reasoning: { efforts: [], defaultEffort: null, canDisable: false },
  }
}

/** "GLM 5.3 Fast" from "glm-5.3-fast": the gateway sends no display names. */
export function displayName(id: string): string {
  const known: Record<string, string> = { glm: 'GLM', deepseek: 'DeepSeek', kimi: 'Kimi', qwen: 'Qwen', minimax: 'MiniMax' }
  return id
    .split('-')
    .map((part) => known[part] ?? (/^v?\d/.test(part) ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)))
    .join(' ')
}
