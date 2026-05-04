// Same as run-with-prod-env.mjs but uses npx tsx so .ts scripts can be run.
import { readFileSync } from 'fs'
import { spawn } from 'child_process'

const envPath = '.env.production.local'
const text = readFileSync(envPath, 'utf8')
const env = { ...process.env }
for (const line of text.split('\n')) {
  if (!line || line.trim().startsWith('#')) continue
  const eq = line.indexOf('=')
  if (eq < 0) continue
  const key = line.slice(0, eq).trim()
  let val = line.slice(eq + 1)
  if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1)
  val = val.replace(/\\n$/, '').replace(/\n+$/, '')
  env[key] = val
}
if (env.DATABASE_URL) env.DATABASE_URL = env.DATABASE_URL.replace(':6543/postgres', ':5432/postgres').replace('?pgbouncer=true&connection_limit=1', '')
if (!env.DIRECT_URL && env.DATABASE_URL) env.DIRECT_URL = env.DATABASE_URL

const [, , script, ...args] = process.argv
if (!script) { console.error('Usage: run-with-prod-env-tsx.mjs <ts-script> [args]'); process.exit(1) }

const isWin = process.platform === 'win32'
const child = spawn(isWin ? 'npx.cmd' : 'npx', ['--yes', 'tsx', script, ...args], { stdio: 'inherit', env, shell: isWin })
child.on('exit', code => process.exit(code ?? 0))
child.on('error', err => { console.error('spawn error:', err); process.exit(1) })
