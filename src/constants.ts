/** Where the CLI talks to. Overridable for staging and local work; nothing else reads the environment. */
export const INFERENCE_ROOT = (process.env.CORALBRICKS_INFERENCE_URL ?? 'https://inference.coralbricks.ai').replace(/\/+$/, '')
export const BASE_URL = `${INFERENCE_ROOT}/v1`
export const CONSOLE_ROOT = (process.env.CORALBRICKS_CONSOLE_URL ?? 'https://www.coralbricks.ai').replace(/\/+$/, '')

/** The key variable every launched agent reads, and the one the CLI itself honours over a stored login. */
export const KEY_ENV = 'CORALBRICKS_API_KEY'
export const PROVIDER_ID = 'coralbricks'
export const PROVIDER_NAME = 'CoralBricks'

/** Used when the account's model list can't be read and nothing was picked with -m. */
export const FALLBACK_MODEL = 'deepseek-v4.1-flash-fast'
