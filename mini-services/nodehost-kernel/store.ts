/**
 * store.ts — database access + seed for one NodeHost instance.
 * Each kernel process owns EXACTLY one SQLite file (DATABASE_URL env),
 * which is the whole persistent state of that NodeHost.
 */
import { PrismaClient } from '@prisma/client'
import type { ModuleRegistration } from '../../src/core/nodehost/interfaces'
import type { RosterEntry } from '../../src/core/nodehost/protocol'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['warn', 'error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

// ------------------------------------------------------------
// Environment of THIS NodeHost instance
// ------------------------------------------------------------

export const ENV = {
  port: Number(process.env.PORT ?? 3003),
  apiPort: Number(process.env.API_PORT ?? 3013),
  dbUrl: process.env.DATABASE_URL ?? 'file:./db/kernel.db',
  hostCode: process.env.HOST_CODE ?? 'nodehost-1',
  hostName: process.env.HOST_NAME ?? 'NodeHost-1',
  hostAddress: process.env.HOST_ADDRESS ?? 'http://127.0.0.1:3013/ingress',
  hostGwPort: process.env.HOST_GW_PORT ? Number(process.env.HOST_GW_PORT) : null,
  seedProfile: process.env.SEED_PROFILE ?? '',
  peer: process.env.PEER ?? '', // "code|name|address|gwPort"
}

// ------------------------------------------------------------
// Logging (console + SysLog table)
// ------------------------------------------------------------

export async function log(
  level: 'info' | 'warn' | 'error',
  scope: string,
  message: string,
  data?: unknown,
) {
  const line = `[${scope}] ${message}`
  if (level === 'error') console.error(line, data ?? '')
  else if (level === 'warn') console.warn(line, data ?? '')
  else console.log(line, data ?? '')

  await prisma.sysLog.create({
    data: {
      level,
      scope,
      message,
      data: data === undefined ? '{}' : JSON.stringify(data).slice(0, 2000),
    },
  })
}

// ------------------------------------------------------------
// Demo seed — idempotent, runs on every boot, only fills gaps
// ------------------------------------------------------------

const randHex = (n: number) =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('')

export function newNodeCode() {
  return `node-${randHex(6)}`
}

export function newAdminToken() {
  return `nh_${randHex(24)}`
}

async function upsertDemoNode(params: {
  code: string
  name: string
  token: string
  hostId: string
  enabled: string[]
}) {
  const node = await prisma.node.upsert({
    where: { code: params.code },
    update: {},
    create: {
      code: params.code,
      name: params.name,
      token: params.token,
      isDemo: true,
      hostId: params.hostId,
    },
  })
  // Ensure a switch row exists for every registered module.
  const mods = await prisma.moduleDef.findMany()
  for (const m of mods) {
    await prisma.nodeModuleState.upsert({
      where: { nodeId_moduleId: { nodeId: node.id, moduleId: m.id } },
      update: {},
      create: {
        nodeId: node.id,
        moduleId: m.id,
        enabled: params.enabled.includes(m.id),
      },
    })
  }
  return node
}

/**
 * Boot-time setup: local host row, module registry sync, peer rows,
 * demo nodes. Everything is upsert-based so restarts are safe.
 */
export async function ensureSeed(registry: Map<string, ModuleRegistration>) {
  // 1) This host (kind=local)
  const self = await prisma.host.upsert({
    where: { code: ENV.hostCode },
    update: {
      name: ENV.hostName,
      address: ENV.hostAddress,
      gwPort: ENV.hostGwPort,
      kind: 'local',
    },
    create: {
      code: ENV.hostCode,
      name: ENV.hostName,
      address: ENV.hostAddress,
      gwPort: ENV.hostGwPort,
      kind: 'local',
    },
  })

  // 2) Module registry from the kernel's loaded modules
  for (const reg of registry.values()) {
    await prisma.moduleDef.upsert({
      where: { id: reg.meta.id },
      update: { name: reg.meta.name, version: reg.meta.version, description: reg.meta.description },
      create: {
        id: reg.meta.id,
        name: reg.meta.name,
        version: reg.meta.version,
        description: reg.meta.description,
        author: reg.meta.author ?? 'core',
        builtin: true,
      },
    })
  }

  // 3) Federated peers (learned at boot via env; more arrive via hello)
  if (ENV.peer) {
    const [code, name, address, gwPort] = ENV.peer.split('|')
    await prisma.host.upsert({
      where: { code },
      update: { name, address },
      create: { code, name, address, gwPort: gwPort ? Number(gwPort) : null, kind: 'remote' },
    })
  }

  // 4) Demo content per profile
  if (ENV.seedProfile === 'alfa') {
    await upsertDemoNode({
      code: 'node-a1',
      name: 'نود آلفا-۱ (سرور اصلی)',
      token: 'demo-token-a1',
      hostId: self.id,
      enabled: ['chat', 'broadcast', 'presence', 'ping'],
    })
    await upsertDemoNode({
      code: 'node-a2',
      name: 'نود آلفا-۲ (چت و پینگ)',
      token: 'demo-token-a2',
      hostId: self.id,
      enabled: ['chat', 'ping'],
    })
    await upsertDemoNode({
      code: 'node-a3',
      name: 'نود آلفا-۳ (بدون ماژول)',
      token: 'demo-token-a3',
      hostId: self.id,
      enabled: [],
    })
    // A deliberately unreachable host to demonstrate store-and-forward.
    await prisma.host.upsert({
      where: { code: 'gama' },
      update: {},
      create: {
        code: 'gama',
        name: 'نودهاست گاما (آفلاین موقت)',
        address: 'http://127.0.0.1:4999/ingress',
        kind: 'remote',
      },
    })
  }

  if (ENV.seedProfile === 'beta') {
    await upsertDemoNode({
      code: 'node-b1',
      name: 'نود بتا-۱ (کامل)',
      token: 'demo-token-b1',
      hostId: self.id,
      enabled: ['chat', 'broadcast', 'presence', 'ping'],
    })
    await upsertDemoNode({
      code: 'node-b2',
      name: 'نود بتا-۲ (سبک)',
      token: 'demo-token-b2',
      hostId: self.id,
      enabled: ['chat'],
    })
  }

  // Trim ancient logs so the demo db stays small
  const stale = await prisma.sysLog.findMany({
    orderBy: { createdAt: 'desc' },
    skip: 400,
    select: { id: true },
  })
  if (stale.length) {
    await prisma.sysLog.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } })
  }

  return self
}

// ------------------------------------------------------------
// Roster builder (used by hello + admin sockets + bootstrap)
// ------------------------------------------------------------

export async function localRoster(adminOnline: Set<string>): Promise<RosterEntry[]> {
  const nodes = await prisma.node.findMany({
    where: { host: { kind: 'local' } },
    include: { moduleStates: { where: { enabled: true } } },
  })
  return nodes.map((n) => ({
    code: n.code,
    name: n.name,
    modules: n.moduleStates.map((s) => s.moduleId),
    adminOnline: adminOnline.has(n.code),
    isDemo: n.isDemo,
    ...(n.isDemo ? { demoToken: n.token } : {}),
  }))
}
