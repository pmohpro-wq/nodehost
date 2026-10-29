/**
 * smoke-identity-host.ts — the ONE identity law + host identity + host
 * introduction, end to end:
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
  const r = await adminApi('/api/admin/host-identity', 'PATCH', ADMIN, { code: 'alfa' })
  const j = await r.json()
  check('rename back to alfa → ok', r.status === 200 && j.ok, j)
  const boot = await (await webApi('bootstrap', ADMIN)).json()
  check('bootstrap back to alfa', boot.host?.code === 'alfa')
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
  const r = await webApi('hosts', 'mani99', 'POST', { code: 'alfa', address: 'http://127.0.0.1:3013/ingress' })
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
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
