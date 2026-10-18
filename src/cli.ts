#!/usr/bin/env node
import { createRequire } from 'node:module'
import readline from 'node:readline/promises'
import { BASE_URL, CONSOLE_ROOT, INFERENCE_ROOT, KEY_ENV } from './constants.js'
import { credentialFile, deleteStoredKey, maskKey, resolveKey } from './credentials.js'
import { parseArgs, UsageError, type Parsed } from './args.js'
import { launch, onPath, readLast } from './launch.js'
import { login } from './login.js'
import { defaultModel, displayName, KeyRejectedError, loadModels, type ModelSpec } from './models.js'
import { findTool, TOOLS, type Tool } from './tools/index.js'
import { banner, c } from './ui.js'

const VERSION = (createRequire(import.meta.url)('../package.json') as { version: string }).version

const HELP = `${banner()} ${c.dim(`v${VERSION}`)}

Open your coding agent on CoralBricks. Your own agent config is never edited.

${c.bold('Usage')}
  coralbricks login               sign in with your browser ${c.dim('(--manual to paste a key, --no-browser on a remote box)')}
  coralbricks claude              Claude Code on the default model
  coralbricks codex -m <model>    Codex CLI on a model of your choice
  coralbricks opencode            OpenCode ${c.dim('(alias: oc)')}
  coralbricks pi                  Pi
  coralbricks launch <agent>      the same, spelled out
  coralbricks again               reopen the last agent and model
  coralbricks models              the models your key can call
  coralbricks env                 export lines for any other harness or SDK
  coralbricks status              who you are signed in as, and what's installed
  coralbricks logout              forget the stored key

${c.bold('Launch options')}
  -m, --model <id>      model for this session ${c.dim('(coralbricks/<id> works too)')}
  --dry-run             show what would run, key masked; writes and starts nothing
  --json                machine-readable --dry-run, models, status
  -- <args>             everything after -- goes to the agent untouched

${c.bold('Keys')}
  $${KEY_ENV} wins over the stored login (${c.dim(credentialFile())}).
  Docs: ${CONSOLE_ROOT}/docs/cli
`

async function main(argv: string[]): Promise<number> {
  const p = parseArgs(argv)
  switch (p.command) {
    case 'help':
      process.stdout.write(HELP)
      return 0
    case 'version':
      process.stdout.write(`${VERSION}\n`)
      return 0
    case 'login':
      return login({ manual: p.manual, browser: p.browser, json: p.json })
    case 'logout': {
      const removed = await deleteStoredKey()
      process.stdout.write(removed ? 'Logged out. The stored key was removed from this machine (it stays valid until you revoke it on the API Keys page).\n' : 'No stored login to remove.\n')
      return 0
    }
    case 'models':
      return models(p)
    case 'status':
      return status(p)
    case 'env':
      return env(p)
    case 'again': {
      const last = await readLast()
      const tool = last && findTool(last.tool)
      if (!tool || !last) throw new UsageError('Nothing launched yet. Try coralbricks claude.')
      return start(tool, { ...p, model: p.model ?? last.model })
    }
    case 'launch': {
      const name = p.positional.shift()
      if (!name) throw new UsageError(`Which agent? ${TOOLS.map((t) => t.id).join(', ')}`)
      return start(toolOrThrow(name), p)
    }
    case null:
      return pick(p)
    default:
      return start(toolOrThrow(p.command), p)
  }
}

function toolOrThrow(name: string): Tool {
  const tool = findTool(name)
  if (!tool) throw new UsageError(`Unknown command or agent "${name}". Agents: ${TOOLS.map((t) => t.id).join(', ')}. See coralbricks --help.`)
  return tool
}

/** A key from the flag, the environment or the stored login; signs in first when there is none. */
async function keyOrLogin(p: Parsed): Promise<string | null> {
  const found = await resolveKey(p.apiKey)
  if (found) return found.key
  if (!process.stdin.isTTY || p.dryRun) {
    process.stderr.write(`Not signed in. Run coralbricks login, or set ${KEY_ENV}.\n`)
    return null
  }
  process.stdout.write('Not signed in yet; opening your browser.\n\n')
  if ((await login({ manual: p.manual, browser: p.browser, json: false })) !== 0) return null
  return (await resolveKey(undefined))?.key ?? null
}

async function modelsFor(apiKey: string): Promise<ModelSpec[] | null> {
  try {
    const { models, source } = await loadModels(apiKey)
    if (source === 'cache') process.stderr.write(c.dim('CoralBricks is unreachable; using the model list from your last session.\n'))
    return models
  } catch (error) {
    if (error instanceof KeyRejectedError) process.stderr.write(`${error.message} Run coralbricks login again. Nothing was started.\n`)
    else process.stderr.write(`${(error as Error).message}\n`)
    return null
  }
}

async function start(tool: Tool, p: Parsed): Promise<number> {
  if (p.positional.length) throw new UsageError(`Unexpected "${p.positional.join(' ')}". Agent arguments go after --, e.g. coralbricks ${tool.id} -- ${p.positional.join(' ')}`)
  const apiKey = await keyOrLogin(p)
  if (!apiKey) return 1
  const list = await modelsFor(apiKey)
  if (!list) return 1
  const model = p.model ?? defaultModel(list)
  if (p.model && list.length && !list.some((m) => m.id === p.model)) {
    process.stderr.write(`Your key can't call "${p.model}". Models: ${list.map((m) => m.id).join(', ')}\n`)
    return 1
  }
  return launch({ tool, apiKey, model, models: list, extraArgs: p.extra, dryRun: p.dryRun, json: p.json })
}

async function pick(p: Parsed): Promise<number> {
  if (!process.stdin.isTTY) {
    process.stdout.write(HELP)
    return 0
  }
  process.stdout.write(`${banner()}\n\nWhich agent?\n`)
  TOOLS.forEach((t, i) => process.stdout.write(`  ${c.coral(String(i + 1))}  ${t.label.padEnd(12)} ${c.dim(`coralbricks ${t.id}`)}\n`))
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = (await rl.question('\n> ')).trim()
  rl.close()
  const tool = TOOLS[Number(answer) - 1] ?? findTool(answer)
  if (!tool) throw new UsageError('No agent picked.')
  return start(tool, p)
}

async function models(p: Parsed): Promise<number> {
  const found = await resolveKey(p.apiKey)
  if (!found) {
    process.stderr.write(`Not signed in. Run coralbricks login, or set ${KEY_ENV}.\n`)
    return 1
  }
  const list = await modelsFor(found.key)
  if (!list) return 1
  if (p.json) {
    process.stdout.write(`${JSON.stringify(list, null, 2)}\n`)
    return 0
  }
  const def = defaultModel(list)
  const rows = list.map((m) => [
    `${m.id}${m.id === def ? c.dim(' (default)') : ''}`,
    displayName(m.id),
    `${Math.round(m.contextWindow / 1024)}K`.replace('1024K', '1M'),
    m.price ? `$${m.price.input} in / $${m.price.output} out` : '',
    m.decodeSpeed ? `${Math.round(m.decodeSpeed)} tok/s` : '',
  ])
  const head = ['model', 'name', 'context', 'per 1M tokens', 'speed (1d)']
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => strip(r[i]).length)))
  const line = (r: string[]) => r.map((cell, i) => cell + ' '.repeat(widths[i] - strip(cell).length)).join('  ')
  process.stdout.write(`${c.dim(line(head))}\n${rows.map(line).join('\n')}\n`)
  return 0
}

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

async function status(p: Parsed): Promise<number> {
  const found = await resolveKey(p.apiKey)
  const list = found ? await loadModels(found.key).then((r) => r.models, () => null) : null
  const installed = TOOLS.map((t) => ({ tool: t, installed: onPath(t.command) }))
  if (p.json) {
    process.stdout.write(`${JSON.stringify({
      signedIn: Boolean(found), key: found ? maskKey(found.key) : null, keySource: found?.source ?? null, keyWorks: list !== null,
      endpoint: INFERENCE_ROOT, agents: Object.fromEntries(installed.map((i) => [i.tool.id, i.installed])),
    }, null, 2)}\n`)
    return 0
  }
  const out = [banner(), '']
  if (!found) out.push(`  key       ${c.dim('none.')} Run coralbricks login`)
  else out.push(`  key       ${maskKey(found.key)} ${c.dim(`from ${found.source === 'env' ? `$${KEY_ENV}` : found.source === 'flag' ? '--api-key' : credentialFile()}`)} ${list ? c.green('works') : c.red('rejected or unreachable')}`)
  out.push(`  endpoint  ${INFERENCE_ROOT}`)
  if (list) out.push(`  models    ${list.map((m) => m.id).join(', ')}`)
  out.push('', '  agents')
  for (const { tool, installed: ok } of installed) out.push(`    ${tool.label.padEnd(12)} ${ok ? c.green('installed') : c.dim(`not installed: ${tool.install}`)}`)
  process.stdout.write(`${out.join('\n')}\n`)
  return 0
}

/** For harnesses without a launcher: the key and both API roots, ready to eval. */
async function env(p: Parsed): Promise<number> {
  const found = await resolveKey(p.apiKey)
  if (!found) {
    process.stderr.write(`Not signed in. Run coralbricks login, or set ${KEY_ENV}.\n`)
    return 1
  }
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
  process.stdout.write([
    `# CoralBricks: eval "$(coralbricks env)"`,
    `export ${KEY_ENV}=${q(found.key)}`,
    `export CORALBRICKS_BASE_URL=${q(BASE_URL)}            # OpenAI-compatible: chat completions, responses`,
    `export CORALBRICKS_ANTHROPIC_BASE_URL=${q(INFERENCE_ROOT)}   # Anthropic Messages`,
    '',
  ].join('\n'))
  return 0
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`${error instanceof UsageError ? '' : 'Error: '}${(error as Error).message}\n`)
    process.exit(error instanceof UsageError ? 2 : 1)
  },
)
