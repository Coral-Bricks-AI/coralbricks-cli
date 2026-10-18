import http from 'node:http'
import readline from 'node:readline'
import { CONSOLE_ROOT } from './constants.js'
import { maskKey, writeStoredKey } from './credentials.js'
import { createHandoff, openHandoff, type Handoff } from './handoff.js'
import { fetchModels, KeyRejectedError } from './models.js'
import { banner, c, openBrowser, promptHidden } from './ui.js'

const LOGIN_TIMEOUT_MS = 10 * 60 * 1000

export interface LoginOptions {
  manual: boolean
  browser: boolean
  json: boolean
}

/**
 * `coralbricks login`. By default the console creates a key for this terminal (named after
 * CORALBRICKS_DEVICE_NAME, or just "Terminal": a machine's hostname can say more about a person than
 * they'd want on a key list) and hands it back sealed to this process (handoff.ts), through a
 * one-off listener on 127.0.0.1. `--no-browser` prints the address instead, for a remote box, and
 * reads the code the page shows. `--manual` takes a key pasted from the API Keys page.
 */
export async function login(opts: LoginOptions): Promise<number> {
  let apiKey: string
  if (opts.manual) {
    apiKey = await promptHidden(`Paste your CoralBricks API key (from ${CONSOLE_ROOT}/api-keys): `)
    if (!apiKey) {
      process.stderr.write('No key entered.\n')
      return 1
    }
  } else {
    const got = await browserLogin(opts)
    if (!got) return 1
    apiKey = got
  }

  const verified = await verify(apiKey)
  if (!verified) return 1
  const file = await writeStoredKey(apiKey)
  if (opts.json) process.stdout.write(`${JSON.stringify({ loggedIn: true, key: maskKey(apiKey), path: file })}\n`)
  else process.stdout.write(`\n${c.green('Logged in')} ${c.dim(`(${maskKey(apiKey)}, saved to ${file})`)}\n\nNext:\n  coralbricks claude     ${c.dim('or codex, opencode, pi')}\n  coralbricks models     ${c.dim('what your key can call')}\n`)
  return 0
}

async function browserLogin(opts: LoginOptions): Promise<string | null> {
  const handoff = createHandoff()
  const server = opts.browser ? await listen(handoff) : null
  const params = new URLSearchParams({ pk: handoff.publicKey, state: handoff.state, name: process.env.CORALBRICKS_DEVICE_NAME || 'Terminal' })
  if (server) params.set('port', String(server.port))
  const url = `${CONSOLE_ROOT}/cli/login?${params}`
  const opened = server ? await openBrowser(url) : false

  if (!opts.json) {
    process.stdout.write(`${banner()}\n\n`)
    process.stdout.write(`${c.bold(opened ? 'Finish signing in in your browser' : 'Open this page to sign in')}\n  ${url}\n\n`)
    process.stdout.write(`  Check that the page shows ${c.coral(c.bold(handoff.checkCode))}\n\n`)
  } else {
    process.stdout.write(`${JSON.stringify({ url, checkCode: handoff.checkCode })}\n`)
  }

  // The page's code works either way: pasted here when the browser can't reach this machine.
  // Without a listener the code can only come in on stdin, typed or piped.
  const rl = process.stdin.isTTY || !server ? readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) }) : null
  const pasted = rl
    ? new Promise<string>((resolve) => rl.question(c.dim(server ? 'Waiting for the browser... (or paste the code from the page) ' : 'Paste the code from the page: '), resolve))
    : new Promise<string>(() => {})
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), LOGIN_TIMEOUT_MS).unref())

  try {
    const next = await Promise.race([
      server ? server.received.then((code) => ({ via: 'browser' as const, code })) : new Promise<never>(() => {}),
      pasted.then((code) => ({ via: 'paste' as const, code })),
      timeout,
    ])
    if (!next) {
      process.stderr.write('\nSign-in timed out. Run coralbricks login to try again.\n')
      return null
    }
    if (next.via === 'browser' && rl) process.stdout.write('\n')
    return openHandoff(handoff, next.code).apiKey
  } catch (error) {
    process.stderr.write(`\n${(error as Error).message}\n`)
    return null
  } finally {
    rl?.close()
    server?.close()
  }
}

/** A one-off listener on loopback for the console's redirect; anything but the expected state is refused. */
function listen(handoff: Handoff): Promise<{ port: number; received: Promise<string>; close: () => void }> {
  let deliver: (code: string) => void = () => {}
  const received = new Promise<string>((resolve) => (deliver = resolve))
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/callback' || url.searchParams.get('state') !== handoff.state || !url.searchParams.get('code')) {
      res.writeHead(404).end()
      return
    }
    deliver(url.searchParams.get('code')!)
    // Back to the console, which says the terminal is connected; the state lets the approving tab
    // tell its own hand-off from any other.
    res.writeHead(302, { Location: `${CONSOLE_ROOT}/cli/login?${new URLSearchParams({ connected: '1', state: handoff.state })}`, 'Cache-Control': 'no-store' }).end()
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({ port, received, close: () => server.close() })
    })
  })
}

/** A key works once the gateway lists models for it; a brand-new one can take about half a minute. */
async function verify(apiKey: string): Promise<boolean> {
  const until = Date.now() + 60_000
  let said = false
  for (;;) {
    try {
      await fetchModels(apiKey)
      return true
    } catch (error) {
      if (!(error instanceof KeyRejectedError) || Date.now() > until) {
        process.stderr.write(`${(error as Error).message}\n`)
        return false
      }
      if (!said) {
        process.stdout.write(c.dim('Activating your new key...\n'))
        said = true
      }
      await new Promise((r) => setTimeout(r, 3000))
    }
  }
}
