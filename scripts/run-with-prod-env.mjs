// Wrapper: load .env.production.local, strip Vercel's trailing \n, then exec
// the actual script. Usage: node scripts/run-with-prod-env.mjs <script> [args]
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
  // Strip surrounding quotes
  if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1)
  // Vercel CLI appends literal \n at the end of values — strip it
  val = val.replace(/\\n$/, '').replace(/\n+$/, '')
  env[key] = val
}

// Force the loaded prod DATABASE_URL (port 6543 / pgbouncer) to use the
// session-pooler endpoint (5432) since prisma raw queries don't like the
// pooler for some operations.
if (env.DATABASE_URL) env.DATABASE_URL = env.DATABASE_URL.replace(':6543/postgres', ':5432/postgres').replace('?pgbouncer=true&connection_limit=1', '')
if (!env.DIRECT_URL && env.DATABASE_URL) env.DIRECT_URL = env.DATABASE_URL

const [, , script, ...args] = process.argv
if (!script) { console.error('Usage: run-with-prod-env.mjs <script> [args]'); process.exit(1) }

const child = spawn(process.execPath, [script, ...args], { stdio: 'inherit', env })
child.on('exit', code => process.exit(code ?? 0))
