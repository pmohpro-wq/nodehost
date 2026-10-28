/**
 * smoke-federation.ts — two-kernel federation test with NHP_LINK_SECRET.
 *
 * Boots alfa (3003/3013) + beta (3004/3014) with the SAME link secret on
 * throwaway databases, then verifies:
 *   1. Authenticated hello exchange → both hosts online in each other's
 *      directory (roster merge works over the authorized ingress)
 *   2. Cross-host chat: node-a1 (alfa) → node-b1 (beta) is forwarded and
 *      pushed to node-b1's admin socket
 *   3. Unauthorized cross-host POST fails with 401
 *
 * Run:  bun tests/smoke-federation.ts   (from repo root)
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { io } from 'socket.io-client'

const SECRET = 'federation-secret-123'
const BASE = process.cwd()
const LOG = '.zscripts'
mkdirSync('db', { recursive: true })
mkdirSync(LOG, { recursive: true })

const fail = (msg: string) => {
  console.error('FAIL:', msg)
  cleanup(1)
}

const procs: ChildProcess[] = []
function cleanup(code: number) {
  for (const p of procs) try { p.kill('SIGTERM') } catch {}
  setTimeout(() => process.exit(code), 300)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function bootKernel(env: Record<string, string>, dbFile: string, logFile: string) {
  if (existsSync(dbFile)) rmSync(dbFile)
  spawnSync('bunx', ['prisma', 'db', 'push', '--skip-generate'], {
    env: { ...process.env, DATABASE_URL: `file:${dbFile}` },
    stdio: 'pipe',
  })
  const p = spawn('bun', ['index.ts'], {
    cwd: 'mini-services/nodehost-kernel',
    env: { ...process.env, ...env, DATABASE_URL: `file:${dbFile}`, NHP_LINK_SECRET: SECRET },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  p.stdout.on('data', (d: Buffer) => process.stdout.write(`[${logFile}] ${d}`))
  p.stderr.on('data', (d: Buffer) => process.stdout.write(`[${logFile}!] ${d}`))
  procs.push(p)
}

async function waitBoot(api: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${api}/internal/bootstrap`)
      if (res.ok) return
    } catch {}
    await sleep(300)
  }
  fail(`kernel at ${api} did not boot`)
}

console.log('→ booting alfa + beta (shared link secret)…')
bootKernel(
  {
    PORT: '3003', API_PORT: '3013',
    HOST_CODE: 'alfa', HOST_NAME: 'نودهاست آلفا (fed-smoke)',
    HOST_ADDRESS: 'http://127.0.0.1:3013/ingress', HOST_GW_PORT: '3003',
    SEED_PROFILE: 'alfa',
  },
  resolve('db/fed-alfa.db'), 'alfa',
)
bootKernel(
  {
    PORT: '3004', API_PORT: '3014',
    HOST_CODE: 'beta', HOST_NAME: 'نودهاست بتا (fed-smoke)',
    HOST_ADDRESS: 'http://127.0.0.1:3014/ingress', HOST_GW_PORT: '3004',
    SEED_PROFILE: 'beta', PEER: 'alfa|نودهاست آلفا|http://127.0.0.1:3013/ingress|3003',
  },
  resolve('db/fed-beta.db'), 'beta',
)

await Promise.all([waitBoot('http://127.0.0.1:3013'), waitBoot('http://127.0.0.1:3014')])
console.log('✓ both kernels booted')

// ------------------------------------------------------------
// 1) Unauthorized cross-host POST → 401
// ------------------------------------------------------------
const bad = await fetch('http://127.0.0.1:3014/ingress', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ hello: 'sneaky' }),
})
if (bad.status !== 401) fail(`unauthorized cross-host POST → expected 401, got ${bad.status}`)
console.log('✓ beta ingress rejects unauthorized POST (401)')

// ------------------------------------------------------------
// 2) Directory: hello exchange with auth → beta sees alfa's nodes
// ------------------------------------------------------------
let betaDir: { hosts?: { code: string; status: string }[] } = {}
for (let i = 0; i < 30; i++) {
  await sleep(500)
  const res = await fetch('http://127.0.0.1:3014/internal/bootstrap')
  betaDir = (await res.json()) as typeof betaDir
  const alfa = betaDir.hosts?.find((h) => h.code === 'alfa')
  if (alfa?.status === 'online') break
}
const alfaRow = betaDir.hosts?.find((h) => h.code === 'alfa')
if (alfaRow?.status !== 'online') fail(`alfa never came online on beta: ${JSON.stringify(alfaRow)}`)
console.log('✓ hello exchange over authorized ingress — alfa online on beta')

// ------------------------------------------------------------
// 3) Cross-host chat: node-a1 (alfa) → node-b1 (beta)
// ------------------------------------------------------------
const s1 = io('http://127.0.0.1:3003', { path: '/', transports: ['websocket'], forceNew: true })
const s2 = io('http://127.0.0.1:3004', { path: '/', transports: ['websocket'], forceNew: true })

const login = (s: ReturnType<typeof io>, node: string, token: string) =>
  new Promise<void>((res2, rej) => {
    s.emit('admin:hello', { nodeCode: node, token }, (r: { ok: boolean; error?: string }) =>
      r.ok ? res2() : rej(new Error(r.error)),
    )
  })

const tmo = (ms: number, what: string) => {
  const p = new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${what} timeout`)), ms))
  p.catch(() => {})
  return p
}

const chatOnB1 = new Promise<{ from: { host: string; node: string }; payload: { text?: string } }>(
  (resolve) => {
    s2.on('nhp:in', (env: { type: string; from: { host: string; node: string }; payload: { text?: string } }) => {
      if (env.type === 'chat.message') resolve(env)
    })
  },
)

await Promise.all([login(s1, 'node-a1', 'demo-token-a1'), login(s2, 'node-b1', 'demo-token-b1')])
console.log('✓ admins logged in on both hosts')

const sent = await new Promise<{ ok: boolean; outcome: string; envId: string }>((resolve) => {
  s1.emit(
    'nhp:send',
    {
      to: { host: 'beta', node: 'node-b1' },
      module: 'chat',
      type: 'chat.message',
      payload: { text: 'سلام از آلفا!' },
    },
    (r: { ok: boolean; outcome: string; envId: string }) => resolve(r),
  )
})
if (!sent.ok || sent.outcome !== 'forwarded')
  fail(`cross-host send → ${JSON.stringify(sent)}`)
console.log(`✓ cross-host envelope forwarded (envId ${sent.envId.slice(0, 8)})`)

const chat = await Promise.race([chatOnB1, tmo(12000, 'cross-host chat push')])
if (chat.from.host !== 'alfa' || chat.from.node !== 'node-a1')
  fail(`chat arrived with wrong origin: ${JSON.stringify(chat.from)}`)
if (chat.payload?.text !== 'سلام از آلفا!') fail('chat payload corrupted in transit')
console.log('✓ chat delivered cross-host with intact payload')

s1.disconnect()
s2.disconnect()
console.log('ALL FEDERATION TESTS PASSED')
cleanup(0)
