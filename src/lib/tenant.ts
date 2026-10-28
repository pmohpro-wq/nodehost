/**
 * tenant.ts — bootstrap sanitization for the multi-tenant web layer.
 *
 * The kernel's raw bootstrap is a TRUSTED-internal view (it contains every
 * node token). The web proxy reshapes it per viewer before it ever reaches
 * a browser:
 *
 *   guest  → demo nodes only, no tokens, no logs, no directory tokens
 *   user   → demo + own nodes (token only on own), no logs
 *   admin  → everything (still no user-owned tokens — owners hold them)
 *
 * Demo tokens stay public for signed-in members: that is their documented
 * purpose (testing the console without creating a node first).
 */
import { db } from '@/lib/db'
import { getMaxNodes, needsFirstAdmin, type SafeUser } from '@/lib/auth'

/** Subset of the kernel bootstrap the proxy needs to reshape. */
export interface RawBootstrap {
  host: unknown
  nodes: (Record<string, unknown> & {
    isDemo: boolean
    token?: string
    ownerId?: string | null
  })[]
  modules: unknown[]
  hosts: unknown[]
  directory: (Record<string, unknown> & { demoToken?: string })[]
  stats: unknown
  logs: unknown[]
}

export interface ViewerInfo {
  id: string
  name: string
  role: 'user' | 'admin'
}

export interface QuotaInfo {
  maxNodes: number
  used: number
}

/** Shape a node row per the viewer's rights (token visibility + owner name). */
function viewNode(
  node: RawBootstrap['nodes'][number],
  viewer: SafeUser | null,
  ownerNames: Map<string, string>,
) {
  const isOwn = !!viewer && node.ownerId === viewer.id
  // Demo tokens are public for SIGNED-IN members (console testing);
  // guests and non-owners never see user-owned tokens.
  return {
    ...node,
    token: isOwn || (node.isDemo && !!viewer) ? node.token : undefined,
    ownerName: node.ownerId ? (ownerNames.get(node.ownerId) ?? null) : null,
  }
}

/**
 * Build the per-viewer bootstrap payload.
 * `raw` is the kernel's untouched JSON; the return value is browser-safe.
 */
export async function sanitizeBootstrap(
  raw: RawBootstrap,
  viewer: SafeUser | null,
): Promise<Record<string, unknown>> {
  const isGuest = viewer === null
  const isAdmin = viewer?.role === 'admin'

  const allNodes = Array.isArray(raw.nodes) ? raw.nodes : []
  const visible = isGuest
    ? allNodes.filter((n) => n.isDemo)
    : isAdmin
      ? allNodes
      : allNodes.filter((n) => n.isDemo || n.ownerId === viewer!.id)

  // Resolve display names of owners (one small query per poll — fine).
  const ownerIds = [...new Set(visible.map((n) => n.ownerId).filter((v): v is string => !!v))]
  const owners = ownerIds.length
    ? await db.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } })
    : []
  const ownerNames = new Map(owners.map((o) => [o.id, o.name]))

  const directory = (Array.isArray(raw.directory) ? raw.directory : []).map((d) =>
    isGuest ? { ...d, demoToken: undefined } : d,
  )

  const [quota, firstUserPending] = await Promise.all([
    db.node.count({ where: { isDemo: false } }).then(async (used) => ({
      maxNodes: await getMaxNodes(),
      used,
    }) as QuotaInfo),
    needsFirstAdmin(),
  ])

  return {
    ok: true,
    host: raw.host,
    nodes: visible.map((n) => viewNode(n, viewer, ownerNames)),
    modules: raw.modules,
    hosts: raw.hosts,
    directory,
    stats: raw.stats,
    // Kernel logs expose cross-tenant activity — admins only.
    logs: isAdmin ? raw.logs : [],
    viewer: viewer
      ? ({ id: viewer.id, name: viewer.name, role: viewer.role } as ViewerInfo)
      : null,
    quota,
    firstUserPending,
  }
}

/** Can this viewer administer the given node (by ownerId)? */
export function canManageNode(
  viewer: SafeUser | null,
  node: { ownerId: string | null } | null,
): boolean {
  if (!viewer || !node) return false
  return viewer.role === 'admin' || node.ownerId === viewer.id
}
