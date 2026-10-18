import { spawn } from 'node:child_process'

const color = process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb'
const wrap = (open: string, close: string) => (s: string) => (color ? `\x1b[${open}m${s}\x1b[${close}m` : s)

export const c = {
  bold: wrap('1', '22'),
  dim: wrap('2', '22'),
  coral: wrap('38;2;232;93;76', '39'),
  green: wrap('32', '39'),
  red: wrap('31', '39'),
}

export const banner = () => `${c.coral('▟▙')} ${c.bold('CoralBricks')}`

/** Opens a URL in the default browser; false when there's no way to (a remote box). */
export function openBrowser(url: string): Promise<boolean> {
  if (process.env.SSH_CONNECTION && !process.env.DISPLAY) return Promise.resolve(false)
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : ['xdg-open', [url]]
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args as string[], { stdio: 'ignore', detached: true })
      child.once('error', () => resolve(false))
      child.once('spawn', () => {
        child.unref()
        resolve(true)
      })
    } catch {
      resolve(false)
    }
  })
}

/** Reads one line from the terminal without echoing it (an API key). */
export function promptHidden(prompt: string): Promise<string> {
  const input = process.stdin
  if (!input.isTTY) return Promise.reject(new Error('No terminal to read from. Pass the key in CORALBRICKS_API_KEY instead.'))
  process.stdout.write(prompt)
  input.setRawMode(true)
  input.resume()
  let value = ''
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      input.off('data', onData)
      input.setRawMode(false)
      input.pause()
      process.stdout.write('\n')
      if (error) reject(error)
      else resolve(value.trim())
    }
    const onData = (chunk: Buffer) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\u0003') return finish(new Error('Cancelled.'))
        if (ch === '\r' || ch === '\n') return finish()
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1)
        else value += ch
      }
    }
    input.on('data', onData)
  })
}
