// Runs every compiled test file. Spelled out rather than a glob: Node 20's --test takes no globs
// and Windows shells don't expand them.
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const dir = join('dist', 'test')
const files = readdirSync(dir).filter((f) => f.endsWith('.test.js')).map((f) => join(dir, f))
const { status } = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' })
process.exit(status ?? 1)
