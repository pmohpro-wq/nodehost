/**
 * smoke-identity-host.ts — the ONE identity law + host identity + host
 * introduction + REAL-people contacts + admin node deletion, end to end:
 *
 *   A. identity gate at POST /api/auth/enter
 *      - legacy Persian login still works (exact match)
 *      - new ids: English-only, shape-checked, case-alias-guarded
 *   B. host identity (Task 17)
 *      - admin-only PATCH /api/admin/host-identity
 *      - kernel flips self code live; bootstrap reflects it
 *      - live module contexts re-address (contacts me.host follows)
 *   C. introduce a remote NodeHost (Task 16)
 *      - every signed-in user may POST nh/hosts; delete stays admin-only
 *      - local-code collision rejected
 *   D. contacts accept REAL people only (Request 12)
 *      - fake local id → 422; real local id → ok
 *      - unintroduced remote host → 422; introduced host, absent node → 422
 *   E. admin node deletion (Request 13)
 *      - admin-only, never one's own node; cascade removes the account
 *      - the freed id can register again fresh
 *
 * Run with the stack up:  bun tests/smoke-identity-host.ts
 */

// module marker: this file runs top-level awaits under bun, but tsc needs an
// import/export for module detection to allow them.
export {}

const WEB = process.env.NH_WEB ?? 'http://127.0.0.1:3000'
const KERNEL = process.env.NH_KERNEL ?? 'http://127.0.0.1:3013'
const ADMIN = 'aaa' // first registrant of the base db = admin
const ADMIN_H = { 'x-nh-user': ADMIN, 'content-type': 'application/json' }

// The host id is ADMIN-OWNED state (Task 17) — the suite renames it in B
// and must restore EXACTLY what was there, whatever the owner chose.
const BASE_HOST = (
  await (await fetch(`${KERNEL}/internal/bootstrap`)).json()
).host?.code

let pass = 0
let fail = 0
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.error(`  ✗ ${name}`, extra ?? '')
  }
}

const enter = async (name: string) =>
  fetch(`${WEB}/api/auth/enter`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })

const webApi = async (
  path: string,
  user: string | null,
  method = 'GET',
  body?: unknown,
) =>
  fetch(`${WEB}/api/nh/${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(user ? { 'x-nh-user': user } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const adminApi = (path: string, method: string, user: string | null, body?: unknown) =>
  fetch(`${WEB}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(user ? { 'x-nh-user': user } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

// ------------------------------------------------------------------
// LEFTOVER CLEANUP — the suite is re-runnable: if a previous run died
// mid-way, its test accounts (mani99/delme1) are wiped here first via
// the very admin-deletion power section E exercises.
// ------------------------------------------------------------------
console.log('0. leftover cleanup')
{
  const boot = await (await webApi('bootstrap', ADMIN)).json()
  const strays = (boot.nodes ?? []).filter((n: { ownerName?: string | null }) =>
    n.ownerName === 'mani99' || n.ownerName === 'delme1',
  )
  for (const s of strays) {
    const r = await webApi(`nodes/${s.id}`, ADMIN, 'DELETE')
    check(`leftover node wiped (${s.ownerName})`, r.status === 200, r.status)
  }
  if (!strays.length) console.log('  · none')
}

// ------------------------------------------------------------------
console.log('A. identity gate (/api/auth/enter)')

{
  const r = await enter('میلی')
  const j = await r.json()
  check('legacy Persian login works', r.status === 200 && j.ok && j.created === false, j)
}
{
  const r = await enter('MANI-NEW-فارسی')
  const j = await r.json()
  check('new Persian id rejected (English law)', r.status === 422 && /انگلیسی/.test(j.error ?? ''), j)
}
{
  const r = await enter('AAA')
  const j = await r.json()
  check('case-alias of existing id rejected', r.status === 409, j)
}
{
  const r = await enter('a|b')
  check('pipe in id rejected', r.status === 422)
}
{
  const r = await enter('9ali')
  const j = await r.json()
  check('digit-start id rejected (English law)', r.status === 422 && /انگلیسی/.test(j.error ?? ''), j)
}
{
  const r = await enter('mani99')
  const j = await r.json()
  check('new English id registers (account+node)', r.status === 200 && j.ok && j.created === true && j.nodeCreated === true, j)
}
{
  const r = await enter('mani99')
  const j = await r.json()
  check('same id re-enter = login (idempotent)', r.status === 200 && j.created === false, j)
}

// ------------------------------------------------------------------
console.log('B. host identity (Task 17)')

{
  const r = await adminApi('/api/admin/host-identity', 'PATCH', null, { code: 'myhost' })
  check('guest PATCH → 401', r.status === 401)
}
{
  const r = await adminApi('/api/admin/host-identity', 'PATCH', 'mani99', { code: 'myhost' })
  check('non-admin PATCH → 403', r.status === 403)
}
{
  const r = await adminApi('/api/admin/host-identity', 'PATCH', ADMIN, { code: '9bad' })
  const j = await r.json()
  check('invalid shape rejected → 422', r.status === 422, j)
}
{
  const r = await adminApi('/api/admin/host-identity', 'PATCH', ADMIN, { code: 'MyHost' })
  const j = await r.json()
  check('uppercase rejected (English law) → 422', r.status === 422 && /انگلیسی/.test(j.error ?? ''), j)
}
{
  const r = await adminApi('/api/admin/host-identity', 'PATCH', ADMIN, { code: 'myhost' })
  const j = await r.json()
  check('admin renames host → ok', r.status === 200 && j.ok && j.code === 'myhost', j)
}
{
  const res = await fetch(`${KERNEL}/internal/bootstrap`)
  const j = await res.json()
  check('kernel bootstrap reports new code', j.host?.code === 'myhost', j.host?.code)
}
{
  const r = await webApi('bootstrap', ADMIN)
  const j = await r.json()
  check('web bootstrap reports new code', j.host?.code === 'myhost', j.host?.code)
}
{
  // The reactive chain: mani99 enables contacts, the list's me.host must
  // address from the NEW host id (live context refresh, no restart).
  const boot = await (await webApi('bootstrap', 'mani99')).json()
  const mine = boot.nodes?.find((n: { ownerId?: string | null }) => n.ownerId === boot.viewer?.id)
  check('mani99 owns a node', !!mine, boot.nodes?.length)
  if (mine) {
    await webApi(`nodes/${mine.id}/modules`, 'mani99', 'POST', { moduleId: 'contacts', enabled: true })
    const list = await (
      await webApi(`nodes/${mine.id}/apps/contacts/list`, 'mani99')
    ).json()
    check('contacts me.host follows the rename (live)', list.me?.host === 'myhost', list.me)
    const add = await webApi(`nodes/${mine.id}/apps/contacts/add`, 'mani99', 'POST', {
      host: 'myhost',
      node: 'میلی',
    })
    check('contact add with new host id → ok', add.status === 200)
  }
}
{
  const r = await adminApi('/api/admin/host-identity', 'PATCH', ADMIN, { code: BASE_HOST })
  const j = await r.json()
  check(`rename back to "${BASE_HOST}" → ok`, r.status === 200 && j.ok, j)
  const boot = await (await webApi('bootstrap', ADMIN)).json()
  check('bootstrap back to the owner-chosen id', boot.host?.code === BASE_HOST)
}

// ------------------------------------------------------------------
console.log('C. introduce a remote NodeHost (Task 16)')

{
  const r = await webApi('hosts', null, 'POST', { code: 'beta', address: 'http://127.0.0.1:3014/ingress' })
  check('guest introduce → 401', r.status === 401)
}
{
  const r = await webApi('hosts', 'mani99', 'POST', { code: 'beta', address: 'http://127.0.0.1:3014/ingress' })
  const j = await r.json()
  check('plain user introduces a NodeHost → ok', r.status === 200 && j.ok, j)
}
{
  const r = await webApi('hosts', 'mani99', 'POST', { code: BASE_HOST, address: 'http://127.0.0.1:3013/ingress' })
  check("introducing THIS host's own id → 409", r.status === 409)
}
{
  const r = await webApi('hosts', 'mani99', 'POST', { code: 'bad|code', address: 'http://x.example.com/ingress' })
  check('bad peer id shape → 422', r.status === 422)
}
{
  const boot = await (await webApi('bootstrap', 'mani99')).json()
  check('introduced host visible in bootstrap', (boot.hosts ?? []).some((h: { code: string }) => h.code === 'beta'), boot.hosts)
}
{
  const r = await webApi('hosts/beta', 'mani99', 'DELETE')
  check('non-admin delete host → 403', r.status === 403)
}
{
  const r = await webApi('hosts/beta', ADMIN, 'DELETE')
  check('admin delete host → ok', r.status === 200)
}

// ------------------------------------------------------------------
console.log('D. contacts accept REAL people only (Request 12)')

{
  const boot = await (await webApi('bootstrap', 'mani99')).json()
  const mine = boot.nodes?.find((n: { ownerId?: string | null }) => n.ownerId === boot.viewer?.id)
  if (!mine) {
    check('mani99 owns a node (precondition)', false)
  } else {
    // Local scope — the node table is authoritative.
    const ghost = await webApi(`nodes/${mine.id}/apps/contacts/add`, 'mani99', 'POST', {
      host: BASE_HOST,
      node: 'ghost404',
    })
    const ghostJ = await ghost.json()
    check(
      'fake local id rejected → 422 «وجود ندارد»',
      ghost.status === 422 && /وجود ندارد/.test(ghostJ.error ?? ''),
      ghostJ,
    )
    const real = await webApi(`nodes/${mine.id}/apps/contacts/add`, 'mani99', 'POST', {
      host: BASE_HOST,
      node: ADMIN,
    })
    check('real local id (the admin) accepted → ok', real.status === 200, await real.json())

    // Remote scope — an unintroduced host can never pass.
    const unknown = await webApi(`nodes/${mine.id}/apps/contacts/add`, 'mani99', 'POST', {
      host: 'nowhere-host',
      node: 'x1',
    })
    const unknownJ = await unknown.json()
    check(
      'unintroduced remote host rejected → 422 «شناخته‌شده نیست»',
      unknown.status === 422 && /شناخته‌شده نیست/.test(unknownJ.error ?? ''),
      unknownJ,
    )

    // Known host, absent node — beta is introduced but DOWN (no roster).
    await webApi('hosts', 'mani99', 'POST', { code: 'beta', address: 'http://127.0.0.1:3014/ingress' })
    const absent = await webApi(`nodes/${mine.id}/apps/contacts/add`, 'mani99', 'POST', {
      host: 'beta',
      node: 'node-b1',
    })
    const absentJ = await absent.json()
    check(
      'known host + absent node rejected → 422 «پیدا نشد»',
      absent.status === 422 && /پیدا نشد/.test(absentJ.error ?? ''),
      absentJ,
    )
    // Editing an EXISTING row stays validation-free (offline peers stay editable).
    const edit = await webApi(`nodes/${mine.id}/apps/contacts/update`, 'mani99', 'POST', {
      host: BASE_HOST,
      node: ADMIN,
      note: 'smoke note',
    })
    check('existing contact still editable → ok', edit.status === 200, await edit.json())
  }
}

// ------------------------------------------------------------------
console.log('E. admin node deletion (Request 13)')

{
  const enter1 = await enter('delme1')
  const j1 = await enter1.json()
  check('delme1 registers fresh', enter1.status === 200 && j1.created === true, j1)

  const boot = await (await webApi('bootstrap', ADMIN)).json()
  const delme = boot.nodes?.find((n: { ownerName?: string | null }) => n.ownerName === 'delme1')
  const adminNode = boot.nodes?.find(
    (n: { ownerId?: string | null }) => n.ownerId === boot.viewer?.id,
  )
  check('delme1 node visible to admin (ownerName resolved)', !!delme, boot.nodes?.length)
  check('admin owns a node (self-guard precondition)', !!adminNode)
  if (delme && adminNode) {
    const nonAdmin = await webApi(`nodes/${delme.id}`, 'mani99', 'DELETE')
    check('non-admin delete node → 403', nonAdmin.status === 403, nonAdmin.status)

    const selfDel = await webApi(`nodes/${adminNode.id}`, ADMIN, 'DELETE')
    check('admin deleting OWN node → 422', selfDel.status === 422, selfDel.status)

    const gone = await webApi(`nodes/${delme.id}`, ADMIN, 'DELETE')
    const goneJ = await gone.json()
    check(
      'admin deletes delme1 node → ok + account cascade',
      gone.status === 200 && goneJ.ok && goneJ.accountRemoved === 'delme1',
      goneJ,
    )

    const users = await (await adminApi('/api/admin/users', 'GET', ADMIN)).json()
    check(
      'delme1 account removed from the users list',
      !(users.users ?? []).some((u: { name: string }) => u.name === 'delme1'),
      users.users?.map((u: { name: string }) => u.name),
    )

    const boot2 = await (await webApi('bootstrap', ADMIN)).json()
    check(
      'delme1 node gone from bootstrap',
      !(boot2.nodes ?? []).some((n: { ownerName?: string | null }) => n.ownerName === 'delme1'),
    )

    const again = await enter('delme1')
    const againJ = await again.json()
    check('freed id registers again fresh', again.status === 200 && againJ.created === true, againJ)

    const boot3 = await (await webApi('bootstrap', ADMIN)).json()
    const delme2 = boot3.nodes?.find(
      (n: { ownerName?: string | null }) => n.ownerName === 'delme1',
    )
    if (delme2) {
      const cleanup = await webApi(`nodes/${delme2.id}`, ADMIN, 'DELETE')
      check('cleanup: delme2 wiped too', cleanup.status === 200, cleanup.status)
    }

    const missing = await webApi('nodes/nonexistent-node-id', ADMIN, 'DELETE')
    check('deleting a missing node → 404', missing.status === 404, missing.status)

    // Suite cleanup: remove mani99 (sections A–D artifacts) via the same
    // admin power — the db returns to its base state, host id included.
    const boot4 = await (await webApi('bootstrap', ADMIN)).json()
    const mani = boot4.nodes?.find(
      (n: { ownerName?: string | null }) => n.ownerName === 'mani99',
    )
    if (mani) {
      const wipe = await webApi(`nodes/${mani.id}`, ADMIN, 'DELETE')
      const wipeJ = await wipe.json()
      check(
        'cleanup: mani99 node+account wiped',
        wipe.status === 200 && wipeJ.accountRemoved === 'mani99',
        wipeJ,
      )
    }
    const beta = await webApi('hosts/beta', ADMIN, 'DELETE')
    check('cleanup: beta host row removed', beta.status === 200 || beta.status === 404, beta.status)
  }
}

// ------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
