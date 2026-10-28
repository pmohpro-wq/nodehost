/**
 * smoke-ingress.ts — end-to-end kernel test (self-contained).
 *
 * Boots ONE NodeHost kernel (alfa profile, NHP_LINK_SECRET enabled) on
 * ports 3003/3013 with a throwaway SQLite file, then verifies:
 *
 *   1. /ingress auth: 401 without header, 401 with wrong secret
 *   2. /ingress validation: 400 bad JSON, 422 bad envelope (authorized)
 *   3. valid sys.hello → 200 + peer-facing roster in response
 *   4. admin socket: login → send chat → correlated sys.ack round-trip
 *      (exercises route() + deliverLocal + reply correlation)
 *   5. store-and-forward: chat to the unreachable "gama" host → queued
 *
 * Run:  bun tests/smoke-ingress.ts
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { io } from 'socket.io-client'

const SECRET = 'smoke-link-secret-xyz'
const WS = 'http://127.0.0.1:3003'
const API = 'http://127.0.0.1:3013'
const DB = resolve('db/smoke-alfa.db')
const KERNEL_LOG = '.zscripts/smoke-alfa.log'

const fail = (msg: string) => {
  console.error('FAIL:', msg)
  cleanup(1)
}

let child: ReturnType<typeof spawn> | null = null

function cleanup(code: number) {
  try {
    child?.kill('SIGTERM')
  } catch {}
  setTimeout(() => process.exit(code), 300)
}

// Fresh throwaway database
mkdirSync('db', { recursive: true })
if (existsSync(DB)) rmSync(DB)
if (existsSync(KERNEL_LOG)) rmSync(KERNEL_LOG)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Push the Prisma schema into the throwaway SQLite file
const push = spawnSync('bunx', ['prisma', 'db', 'push', '--skip-generate'], {
  env: { ...process.env, DATABASE_URL: `file:${DB}` },
  stdio: 'pipe',
})
if (push.status !== 0) {
  console.error(String(push.stderr))
  fail('prisma db push failed')
}

async function waitBoot(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${API}/internal/bootstrap`)
      if (res.ok) return
    } catch {}
    await sleep(300)
  }
  fail('kernel did not boot within 18s')
}

// ------------------------------------------------------------
// 1) Boot kernel with link secret enabled
// ------------------------------------------------------------
console.log('→ booting alfa kernel (secret enabled)…')
child = spawn('bun', ['index.ts'], {
  cwd: 'mini-services/nodehost-kernel',
  env: {
    ...process.env,
    PORT: '3003',
    API_PORT: '3013',
    DATABASE_URL: `file:${DB}`,
    HOST_CODE: 'alfa',
    HOST_NAME: 'نودهاست آلفا (smoke)',
    HOST_ADDRESS: 'http://127.0.0.1:3013/ingress',
    HOST_GW_PORT: '3003',
    SEED_PROFILE: 'alfa',
    NHP_LINK_SECRET: SECRET,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
child.stdout?.on('data', (d) => process.stdout.write(`[kernel] ${d}`))
child.stderr?.on('data', (d) => process.stdout.write(`[kernel!] ${d}`))

await waitBoot()
console.log('✓ kernel booted')

const post = (path: string, body: unknown, auth?: string) =>
  fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

// ------------------------------------------------------------
// 2) Auth matrix on /ingress
// ------------------------------------------------------------
const helloEnv = {
  nhp: 1,
  id: crypto.randomUUID(),
  type: 'sys.hello',
  module: 'sys',
  from: { host: 'tester', node: 'kernel' },
  to: { host: 'alfa', node: 'kernel' },
  ts: Date.now(),
  ttl: 4,
  payload: {
    host: { code: 'tester', name: 'Test Host', address: 'http://127.0.0.1:5999/ingress' },
    nodes: [{ code: 'node-t1', name: 'Test Node', modules: ['ping'], adminOnline: false }],
  },
}

let res = await post('/ingress', helloEnv)
if (res.status !== 401) fail(`no auth → expected 401, got ${res.status}`)
console.log('✓ ingress rejects missing authorization (401)')

res = await post('/ingress', helloEnv, 'Bearer wrong-secret')
if (res.status !== 401) fail(`wrong secret → expected 401, got ${res.status}`)
console.log('✓ ingress rejects wrong secret (401)')

res = await post('/ingress', '{not json', `Bearer ${SECRET}`)
if (res.status !== 400) fail(`bad JSON → expected 400, got ${res.status}`)
console.log('✓ ingress rejects invalid JSON (400)')

res = await post('/ingress', { hello: 'world' }, `Bearer ${SECRET}`)
if (res.status !== 422) fail(`bad envelope → expected 422, got ${res.status}`)
console.log('✓ ingress rejects invalid envelope (422)')

// ------------------------------------------------------------
// 3) Authorized hello → 200 + roster
// ------------------------------------------------------------
res = await post('/ingress', helloEnv, `Bearer ${SECRET}`)
const helloBody = (await res.json()) as {
  ok: boolean
  hello?: { host?: { code?: string }; nodes?: unknown[] }
}
if (res.status !== 200 || !helloBody.ok) fail(`authorized hello → HTTP ${res.status}`)
if (helloBody.hello?.host?.code !== 'alfa') fail('hello response missing host code "alfa"')
if (!Array.isArray(helloBody.hello?.nodes)) fail('hello response missing roster nodes')
console.log(`✓ authorized hello ok — peer roster has ${helloBody.hello?.nodes?.length} node(s)`)

// ------------------------------------------------------------
// 4) Admin socket: two admins → chat + correlated ack round-trip
//    (delivered = pushed to the target's admin socket; the ack comes
//    back to the sender's socket via reply correlation)
// ------------------------------------------------------------
const socket = io(WS, { path: '/', transports: ['websocket'], forceNew: true, timeout: 5000 })
const socket2 = io(WS, { path: '/', transports: ['websocket'], forceNew: true, timeout: 5000 })

const login = (s: typeof socket, node: string, token: string) =>
  new Promise<void>((resolve, rej) => {
    s.emit('admin:hello', { nodeCode: node, token }, (r: { ok: boolean; error?: string }) =>
      r.ok ? resolve() : rej(new Error(`login ${node}: ${r.error}`)),
    )
  })

const timeout = (ms: number, what: string) => {
  const p = new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms))
  // Swallow late rejections when the other branch wins the race.
  p.catch(() => {})
  return p
}

const chatOnA2 = new Promise<{ type: string; from: { node: string } }>((resolve) => {
  socket2.on('nhp:in', (env: { type: string; from: { node: string } }) => {
    if (env.type === 'chat.message') resolve(env)
  })
})

const ackOnA1 = new Promise<{ type: string; replyTo?: string }>((resolve) => {
  socket.on('nhp:in', (env: { type: string; replyTo?: string }) => {
    if (env.type === 'sys.ack') resolve(env)
  })
})

await Promise.all([
  login(socket, 'node-a1', 'demo-token-a1'),
  login(socket2, 'node-a2', 'demo-token-a2'),
])
console.log('✓ admin login ok (node-a1 + node-a2)')

const sendResult = await new Promise<{ ok: boolean; outcome: string; envId: string }>(
  (resolve) => {
    socket.emit(
      'nhp:send',
      {
        to: { host: 'alfa', node: 'node-a2' },
        module: 'chat',
        type: 'chat.message',
        payload: { text: 'smoke test message' },
      },
      (r: { ok: boolean; outcome: string; envId: string }) => resolve(r),
    )
  },
)
if (!sendResult.ok || sendResult.outcome !== 'delivered')
  fail(`nhp:send → ${JSON.stringify(sendResult)}`)
console.log(`✓ chat delivered to online admin (envId ${sendResult.envId.slice(0, 8)})`)

const chat = await Promise.race([chatOnA2, timeout(10000, 'chat push')])
if (chat.from.node !== 'node-a1') fail(`chat pushed to a2 has wrong sender: ${chat.from.node}`)
console.log('✓ chat.message pushed to node-a2 admin socket')

const ack = await Promise.race([ackOnA1, timeout(10000, 'ack round-trip')])
if (!ack.replyTo) fail('ack envelope missing replyTo correlation')
console.log(`✓ correlated sys.ack received (replyTo ${ack.replyTo?.slice(0, 8)})`)

// ------------------------------------------------------------
// 5) Store-and-forward: unreachable host → queued
// ------------------------------------------------------------
const queueResult = await new Promise<{ ok: boolean; outcome: string }>((resolve) => {
  socket.emit(
    'nhp:send',
    {
      to: { host: 'gama', node: 'node-g1' },
      module: 'chat',
      type: 'chat.message',
      payload: { text: 'should queue' },
    },
    (r: { ok: boolean; outcome: string }) => resolve(r),
  )
})
if (queueResult.outcome !== 'queued')
  fail(`unreachable host → expected outcome "queued", got ${JSON.stringify(queueResult)}`)
console.log('✓ unreachable host → envelope queued (store-and-forward)')

socket.disconnect()
socket2.disconnect()
console.log('ALL INGRESS TESTS PASSED')
cleanup(0)
