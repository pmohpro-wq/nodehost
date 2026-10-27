/**
 * index.ts — NodeHost kernel entrypoint.
 *
 * Two listeners per NodeHost instance:
 *   - PORT      : socket.io (admin sessions)          → browser via gateway
 *   - API_PORT  : NHP ingress + internal control API  → kernels & proxy
 *
 * Run one instance per NodeHost:
 *   PORT=3003 API_PORT=3013 DATABASE_URL=file:db/a.db \
 *   HOST_CODE=alfa HOST_NAME="نودهاست آلفا" \
 *   HOST_ADDRESS=http://127.0.0.1:3013/ingress HOST_GW_PORT=3003 \
 *   SEED_PROFILE=alfa bun --hot index.ts
 */
import { createServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'
// Built-in modules — the reference implementations for developers.
import chatModule from '../../src/core/nodehost/modules/chat'
import broadcastModule from '../../src/core/nodehost/modules/broadcast'
import presenceModule from '../../src/core/nodehost/modules/presence'
import pingModule from '../../src/core/nodehost/modules/ping'
import { Kernel } from './kernel'
import { handleApi } from './admin'
import { ENV, log } from './store'

const kernel = new Kernel()
kernel.registerModule(chatModule)
kernel.registerModule(broadcastModule)
kernel.registerModule(presenceModule)
kernel.registerModule(pingModule)

// ------------------------------------------------------------
// Socket.io (admin data-plane) — path "/" per gateway contract
// ------------------------------------------------------------
const wsServer = createServer()
const io = new SocketIOServer(wsServer, {
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
})
kernel.attachIo(io)
io.on('connection', (socket) => kernel.bindAdminSocket(socket))

wsServer.listen(ENV.port, () => {
  console.log(`[ws] NodeHost "${ENV.hostCode}" admin socket on :${ENV.port}`)
})

// ------------------------------------------------------------
// HTTP (ingress + internal control-plane)
// ------------------------------------------------------------
Bun.serve({
  port: ENV.apiPort,
  async fetch(req) {
    const url = new URL(req.url)
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
          'access-control-allow-headers': 'content-type',
        },
      })
    }
    try {
      (req as Request & { kernel?: Kernel }).kernel = kernel
      if (url.pathname === '/' && req.method === 'GET') {
        return Response.json({
          ok: true,
          nhp: 1,
          host: { code: ENV.hostCode, name: ENV.hostName },
          endpoints: { ingress: 'POST /ingress', control: '/internal/bootstrap' },
        })
      }
      // Kernel still booting? Tell callers to retry (store-and-forward will).
      if (!kernel.isBooted && url.pathname !== '/internal/bootstrap') {
        return Response.json({ ok: false, error: 'kernel booting — retry shortly' }, { status: 503 })
      }
      return await handleApi(req)
    } catch (err) {
      console.error('[api] unhandled', err)
      await log('error', 'api', 'unhandled error', String(err)).catch(() => {})
      return Response.json({ ok: false, error: 'internal error' }, { status: 500 })
    }
  },
})

console.log(`[api] NodeHost "${ENV.hostCode}" ingress+control on :${ENV.apiPort}`)

void kernel.boot().catch(async (err) => {
  console.error('[boot] fatal', err)
  await log('error', 'kernel', 'boot failed', String(err)).catch(() => {})
  process.exit(1)
})

process.on('SIGINT', () => {
  kernel.shutdown()
  process.exit(0)
})
process.on('SIGTERM', () => {
  kernel.shutdown()
  process.exit(0)
})
