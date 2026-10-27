/** Shared DTOs between the kernel REST API and the UI. */

export interface HostDto {
  id: string
  code: string
  name: string
  address: string
  gwPort: number | null
  kind: 'local' | 'remote'
  status: 'online' | 'unreachable' | 'unknown'
  lastSeen: string | null
  createdAt: string
}

export interface ModuleStateDto {
  id?: string
  nodeId: string
  moduleId: string
  enabled: boolean
}

export interface NodeDto {
  id: string
  code: string
  name: string
  token?: string
  isDemo: boolean
  status: 'active' | 'suspended'
  hostId: string
  createdAt: string
  moduleStates: ModuleStateDto[]
}

export interface ModuleDto {
  id: string
  name: string
  version: string
  description: string
  author: string
  builtin: boolean
}

export interface DirectoryEntry {
  hostCode: string
  hostName?: string
  nodeCode: string
  nodeName: string
  modules: string[]
  adminOnline: boolean
}

export interface LogDto {
  id: string
  level: 'info' | 'warn' | 'error'
  scope: string
  message: string
  data: string
  createdAt: string
}

export interface MailRow {
  id: string
  envId: string
  channel: 'local' | 'remote'
  direction: 'in' | 'out'
  module: string
  type: string
  fromHost: string
  fromNode: string
  toHost: string
  toNode: string
  payload: string
  status: 'delivered' | 'queued' | 'forwarded' | 'dead'
  attempts: number
  error: string | null
  createdAt: string
  deliveredAt: string | null
}

export interface StatsDto {
  hostCode: string
  hostName: string
  uptimeSec: number
  adminsOnline: number
  modulesLoaded: string[]
  nodes: number
  modulesEnabled: number
  msgsDelivered: number
  msgsQueued: number
  msgsForwarded: number
  msgsDead: number
  hostsOnline: number
}

export interface BootstrapDto {
  ok: boolean
  host: HostDto
  nodes: NodeDto[]
  modules: ModuleDto[]
  hosts: HostDto[]
  directory: DirectoryEntry[]
  stats: StatsDto
  logs: LogDto[]
}

/** Console session — an admin bound to exactly ONE node. */
export interface ConsoleSession {
  hostCode: string
  hostName: string
  gwPort: number | null
  nodeCode: string
  nodeName: string
  token: string
}

export const STATUS_FA: Record<string, string> = {
  online: 'آنلاین',
  unreachable: 'دسترس‌ناپذیر (موقت)',
  unknown: 'نامشخص',
  delivered: 'تحویل‌شده',
  queued: 'در صف انتظار',
  forwarded: 'ارسال به میزبان دیگر',
  dead: 'منقضی‌شده',
}
