import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { parseArgs } from '../args.js'
import { defaultModel, displayName, parseModels } from '../models.js'
import { findTool } from '../tools/index.js'
import type { LaunchContext } from '../tools/types.js'

const gateway = {
  data: [
    { id: 'deepseek-v4.1-flash-fast', context_length: 1048576, supports_image_input: true, supports_chat: true,
      pricing: { input_per_m: 0.25, output_per_m: 1.2, cache_write_per_m: 0.25 }, reasoning: { default_effort: 'none', disable: { reasoning_effort: 'none' }, supported_efforts: ['low', 'high', 'max'] } },
    { id: 'glm-5.3-fast', context_length: 1048576, supports_image_input: false, supports_chat: true,
      pricing: { input_per_m: 1.25, output_per_m: 4.4, cache_write_per_m: 1.25 }, reasoning: { default_effort: 'max', disable: null, supported_efforts: ['low', 'high', 'max'] } },
    { id: 'embed-only', supports_chat: false },
  ],
}
const models = parseModels(gateway)
const ctx = (model: string, extraArgs: string[] = []): LaunchContext => ({
  apiKey: 'cb_live_secret', model, models, sessionDir: '/tmp/s', cacheDir: '/tmp/c', homeDir: '/nonexistent', env: {}, extraArgs,
})

test('models: chat models only, documented default first', () => {
  assert.deepEqual(models.map((m) => m.id), ['deepseek-v4.1-flash-fast', 'glm-5.3-fast'])
  assert.equal(defaultModel(models), 'deepseek-v4.1-flash-fast')
  assert.equal(displayName('deepseek-v4.1-flash-fast'), 'DeepSeek V4.1 Flash Fast')
  assert.equal(displayName('glm-5.3-fast'), 'GLM 5.3 Fast')
})

test('args: model prefix, passthrough after --, inline values', () => {
  const p = parseArgs(['codex', '--model=coralbricks/glm-5.3-fast', '--dry-run', '--', 'exec', '--json'])
  assert.equal(p.command, 'codex')
  assert.equal(p.model, 'glm-5.3-fast')
  assert.equal(p.dryRun, true)
  assert.deepEqual(p.extra, ['exec', '--json'])
  assert.throws(() => parseArgs(['claude', '--resume']), /go after --/)
  assert.deepEqual(parseArgs(['launch', 'claude']).positional, ['claude'])
})

test('claude: gateway in the settings file and env, every tier seated, no Anthropic key', async () => {
  const plan = await findTool('cc')!.plan(ctx('glm-5.3-fast', ['-p', 'hi']))
  assert.equal(plan.env.ANTHROPIC_BASE_URL, 'https://inference.coralbricks.ai')
  assert.equal(plan.env.ANTHROPIC_AUTH_TOKEN, 'cb_live_secret')
  assert.equal(plan.env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'glm-5.3-fast')
  assert.equal(plan.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'deepseek-v4.1-flash-fast')
  assert.equal(plan.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS, '1048576')
  assert.deepEqual(plan.unsetEnv, ['ANTHROPIC_API_KEY'])
  assert.deepEqual(plan.args.slice(-2), ['-p', 'hi'])
  assert.equal(JSON.parse(plan.files[0].contents).env.ANTHROPIC_BASE_URL, 'https://inference.coralbricks.ai')
  assert.ok(!plan.args.join(' ').includes('cb_live_secret'), 'key must not be in argv')
})

test('codex: overrides only, after a subcommand, key by env', async () => {
  // A fresh cached catalog, so the test never fetches the hosted one.
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-'))
  fs.writeFileSync(path.join(cacheDir, 'codex-models.json'), '{"models":[]}')
  const plan = await findTool('codex')!.plan({ ...ctx('glm-5.3-fast', ['exec', 'fix it']), cacheDir })
  assert.ok(plan.args.includes(`model_catalog_json=${JSON.stringify(path.join(cacheDir, 'codex-models.json'))}`))
  assert.equal(plan.args[0], 'exec')
  assert.ok(plan.args.includes('model_providers.coralbricks.base_url="https://inference.coralbricks.ai/v1"'))
  assert.ok(plan.args.includes('model_providers.coralbricks.wire_api="responses"'))
  assert.equal(plan.args.at(-1), 'fix it')
  assert.equal(plan.env.CORALBRICKS_API_KEY, 'cb_live_secret')
  assert.ok(!plan.args.join(' ').includes('cb_live_secret'))
})

test('opencode: a config layer naming the model, key by reference', async () => {
  const plan = await findTool('oc')!.plan(ctx('deepseek-v4.1-flash-fast'))
  const config = JSON.parse(plan.env.OPENCODE_CONFIG_CONTENT)
  assert.equal(config.model, 'coralbricks/deepseek-v4.1-flash-fast')
  assert.equal(config.provider.coralbricks.options.apiKey, '{env:CORALBRICKS_API_KEY}')
  assert.ok(!plan.env.OPENCODE_CONFIG_CONTENT.includes('cb_live_secret'))
})

test('pi: a temporary agent dir with the provider, sessions kept', async () => {
  const plan = await findTool('pi')!.plan(ctx('glm-5.3-fast'))
  assert.equal(plan.env.PI_CODING_AGENT_DIR, path.join('/tmp/s', 'pi-agent'))
  const config = JSON.parse(plan.files[0].contents)
  assert.equal(config.providers.coralbricks.apiKey, '$CORALBRICKS_API_KEY')
  assert.deepEqual(config.providers.coralbricks.models[0].input, ['text', 'image'])
  assert.ok(plan.args.includes(path.join('/tmp/c', 'pi-sessions')))
})
