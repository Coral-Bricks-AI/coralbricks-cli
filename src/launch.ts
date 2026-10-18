import { spawn } from 'node:child_process'
import { accessSync, constants as fsConstants } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { cacheDir, configDir, maskKey, redact } from './credentials.js'
import type { ModelSpec } from './models.js'
import type { LaunchPlan, Tool } from './tools/index.js'
import { c } from './ui.js'

export interface LaunchOptions {
  tool: Tool
  apiKey: string
  model: string
  models: readonly ModelSpec[]
  extraArgs: string[]
  dryRun: boolean
  json: boolean
}

/** Plans the launch, then either prints it (--dry-run, key masked) or runs the agent and cleans up after it. */
export async function launch(opts: LaunchOptions): Promise<number> {
  const sessionRoot = path.join(cacheDir(), 'sessions')
  await fs.mkdir(sessionRoot, { recursive: true, mode: 0o700 })
  const sessionDir = opts.dryRun ? path.join(sessionRoot, '<session>') : await fs.mkdtemp(path.join(sessionRoot, `${opts.tool.id}-`))
  const plan = await opts.tool.plan({
    apiKey: opts.apiKey,
    model: opts.model,
    models: opts.models,
    sessionDir,
    cacheDir: cacheDir(),
    homeDir: os.homedir(),
    env: process.env,
    extraArgs: opts.extraArgs,
  })

  if (opts.dryRun) {
    printPlan(opts, plan)
    return 0
  }

  const cleanup = () => fs.rm(sessionDir, { recursive: true, force: true }).catch(() => {})
  try {
    for (const file of plan.files) {
      await fs.mkdir(path.dirname(file.path), { recursive: true, mode: 0o700 })
      await fs.writeFile(file.path, file.contents, { mode: 0o600 })
    }
    if (!onPath(plan.command)) {
      process.stderr.write(`${opts.tool.label} isn't installed (no \`${plan.command}\` on your PATH).\nInstall it with:\n\n  ${opts.tool.install}\n\nthen run this again.\n`)
      return 127
    }
    await rememberLast(opts.tool.id, opts.model)
    process.stderr.write(`${c.dim(`${opts.tool.label} on CoralBricks · ${opts.model}`)}\n`)
    return await run(plan)
  } finally {
    await cleanup()
  }
}

function run(plan: LaunchPlan): Promise<number> {
  const env: NodeJS.ProcessEnv = { ...process.env, ...plan.env }
  for (const name of plan.unsetEnv ?? []) delete env[name]
  return new Promise((resolve) => {
    const child = spawn(plan.command, plan.args, { stdio: 'inherit', env, shell: process.platform === 'win32' })
    // The terminal sends Ctrl-C to the whole process group; the agent decides what it means.
    // We only stay alive until it exits, so the session files are removed after it.
    const ignore = () => {}
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP']
    for (const s of signals) process.on(s, ignore)
    const done = (code: number) => {
      for (const s of signals) process.off(s, ignore)
      resolve(code)
    }
    child.on('error', (error) => {
      process.stderr.write(`Could not start ${plan.command}: ${error.message}\n`)
      done(1)
    })
    child.on('exit', (code, signal) => done(code ?? (signal ? 128 + (os.constants.signals[signal] ?? 1) : 1)))
  })
}

export function onPath(command: string): boolean {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : ['']
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    for (const ext of exts) {
      try {
        accessSync(path.join(dir, command + ext), fsConstants.X_OK)
        return true
      } catch {
        /* next */
      }
    }
  }
  return false
}

function printPlan(opts: LaunchOptions, plan: LaunchPlan) {
  const secrets = [opts.apiKey]
  const safe = {
    tool: opts.tool.id,
    model: opts.model,
    command: plan.command,
    args: plan.args,
    env: Object.fromEntries(Object.entries(plan.env).map(([k, v]) => [k, redact(v, secrets)])),
    unsetEnv: plan.unsetEnv ?? [],
    files: plan.files.map((f) => ({ path: f.path, contents: redact(f.contents, secrets) })),
  }
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(safe, null, 2)}\n`)
    return
  }
  const out: string[] = [`${c.bold(`${opts.tool.label} on CoralBricks`)} ${c.dim(`(dry run, nothing written or started; key ${maskKey(opts.apiKey)})`)}`, '']
  out.push(c.dim('command'), `  ${[plan.command, ...plan.args.map(shellQuote)].join(' ')}`, '')
  out.push(c.dim('environment'), ...Object.entries(safe.env).map(([k, v]) => `  ${k}=${v.length > 120 ? `${v.slice(0, 117)}...` : v}`))
  for (const name of safe.unsetEnv) out.push(`  ${name} ${c.dim('(unset)')}`)
  for (const f of safe.files) out.push('', c.dim(`file ${f.path}`), ...f.contents.trimEnd().split('\n').map((l) => `  ${l}`))
  process.stdout.write(`${out.join('\n')}\n`)
}

const shellQuote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`)

const lastFile = () => path.join(configDir(), 'last.json')

async function rememberLast(tool: string, model: string) {
  try {
    await fs.mkdir(configDir(), { recursive: true, mode: 0o700 })
    await fs.writeFile(lastFile(), JSON.stringify({ tool, model }))
  } catch {
    /* `again` just won't know */
  }
}

export async function readLast(): Promise<{ tool: string; model: string } | null> {
  try {
    const last = JSON.parse(await fs.readFile(lastFile(), 'utf8')) as { tool?: unknown; model?: unknown }
    return typeof last.tool === 'string' && typeof last.model === 'string' ? { tool: last.tool, model: last.model } : null
  } catch {
    return null
  }
}
