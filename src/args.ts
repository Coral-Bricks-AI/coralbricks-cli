export interface Parsed {
  command: string | null
  model?: string
  apiKey?: string
  dryRun: boolean
  json: boolean
  manual: boolean
  browser: boolean
  extra: string[]
  positional: string[]
}

export function parseArgs(argv: string[]): Parsed {
  const p: Parsed = { command: null, dryRun: false, json: false, manual: false, browser: true, extra: [], positional: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') {
      p.extra = argv.slice(i + 1)
      break
    }
    const [flag, inline] = a.startsWith('--') && a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, undefined]
    const value = () => {
      const v = inline ?? argv[++i]
      if (v === undefined || v.startsWith('-')) throw new UsageError(`${flag} needs a value.`)
      return v
    }
    switch (flag) {
      case '-m':
      case '--model':
        p.model = value().replace(/^coralbricks\//, '')
        break
      case '--api-key':
        p.apiKey = value()
        break
      case '--dry-run':
        p.dryRun = true
        break
      case '--json':
        p.json = true
        break
      case '--manual':
        p.manual = true
        break
      case '--no-browser':
        p.browser = false
        break
      case '-h':
      case '--help':
        p.command = 'help'
        break
      case '-v':
      case '--version':
        p.command = 'version'
        break
      default:
        if (a.startsWith('-')) throw new UsageError(`Unknown option ${a}. Agent options go after --, e.g. coralbricks claude -- ${a}`)
        if (p.command === null) p.command = a
        else p.positional.push(a)
    }
  }
  return p
}

export class UsageError extends Error {}
