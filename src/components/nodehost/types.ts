/** Shared DTOs between the kernel REST API and the UI. */

import type { NhpAddress } from '@/core/nodehost/protocol'

/** Outgoing NHP send request from an admin console panel. */
export interface SendRequest {
  to: NhpAddress
  module: string
  type: string
  payload: unknown
}

/** Receipt returned by the kernel's nhp:send ack. */
export interface SendResult {
  ok: boolean
  outcome: string
  envId: string
}

/** Shared send callback — ONE implementation lives in the console socket context. */
export type SendFn = (p: SendRequest, cb?: (r: SendResult) => void) => void

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
  /** Creator stamped by the web layer (null on demo/legacy nodes). */
  ownerId?: string | null
  ownerName?: string | null
  createdAt: string
  moduleStates: ModuleStateDto[]
}

/** The signed-in web user, as reported by the proxy on every poll. */
export interface ViewerInfo {
  id: string
  name: string
  email: string
  role: 'user' | 'admin'
}

/** Per-host node quota enforced by the proxy (admin-configurable). */
export interface QuotaInfo {
  maxNodes: number
  used: number
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
  /** Demo nodes publish their token for test consoles. */
  demoToken?: string
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
  /** Full NHP envelope JSON (kept for raw view / queued replay). */
  envelope: string
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
  viewer: ViewerInfo | null
  quota: QuotaInfo
  /** True while the instance has no admin yet — first registrant wins. */
  firstUserPending: boolean
}

/** Admin directory of web users (GET /api/admin/users). */
export interface AdminUserDto {
  id: string
  email: string
  name: string
  role: 'user' | 'admin'
  status: 'active' | 'suspended'
  createdAt: string
  nodeCount: number
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
