/**
 * Smoke test for the admin socket layer (post-refactor).
 * Connects as node-a1's admin, sends a chat envelope to node-a2,
 * verifies the ack + mailbox round-trip.
 */
import { io } from 'socket.io-client'

const URL = 'http://127.0.0.1:3003'
const socket = io(URL, { path: '/', transports: ['websocket'], forceNew: true, timeout: 5000 })

const fail = (msg: string) => {
  console.error('FAIL:', msg)
  process.exit(1)
}

socket.on('connect', () => {
  console.log('socket connected:', socket.id)
  socket.emit(
    'admin:hello',
    { nodeCode: 'node-a1', token: 'demo-token-a1' },
    (res: { ok: boolean; node?: { code: string }; mailbox?: unknown[]; error?: string }) => {
      if (!res.ok || res.node?.code !== 'node-a1') fail(`admin:hello → ${JSON.stringify(res)}`)
      console.log('admin:hello ok — node:', res.node?.code, '| mailbox rows:', res.mailbox?.length)
      socket.emit(
        'nhp:send',
        {
          to: { host: 'alfa', node: 'node-a2' },
          module: 'chat',
          type: 'chat.message',
          payload: { text: 'تست سوکت ادمین پس از ریفکتور' },
        },
        (res2: { ok: boolean; outcome: string; envId: string }) => {
          if (!res2.ok) fail(`nhp:send → ${JSON.stringify(res2)}`)
          console.log('nhp:send ok — outcome:', res2.outcome, '| envId:', res2.envId.slice(0, 8))
          socket.emit(
            'chat:history',
            { peerHost: 'alfa', peerNode: 'node-a2' },
            (res3: { ok: boolean; items: { type: string }[] }) => {
              if (!res3.ok) fail('chat:history failed')
              const ours = res3.items.filter((i) => i.type === 'chat.message')
              console.log('chat:history ok — messages:', ours.length)
              socket.emit('mailbox:list', {}, (res4: { ok: boolean; items?: unknown[] }) => {
                if (!res4.ok) fail('mailbox:list failed')
                console.log('mailbox:list ok — rows:', res4.items?.length)
                console.log('ALL SOCKET TESTS PASSED')
                socket.disconnect()
                process.exit(0)
              })
            },
          )
        },
      )
    },
  )
})

socket.on('connect_error', (e) => fail(`connect_error: ${e.message}`))
setTimeout(() => fail('timeout'), 12000)
