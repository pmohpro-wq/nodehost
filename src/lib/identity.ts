/**
 * identity.ts — THE one identity law of NodeHost.
 *
 * One user = ONE id, and that id IS their name, their personal node's
 * routing code and their network address: (hostId, id). This module is
 * the single gatekeeper every id passes through — the web auth layer
 * (account ids) and the kernel (host id) both call it, so the rule can
 * never drift between layers.
 *
 * The ladder (why three steps):
 *   Early accounts were Persian (سارا، رضا…). They must keep working —
 *   exact match always wins. But EVERY NEW id is English-only lowercase
 *   (`[a-z][a-z0-9]*`): ids travel in URLs (?u=), headers, node codes
 *   and NHP addresses — ASCII-only ids are what makes addresses copy-
 *   paste-safe across servers, terminals and federation links.
 */

/** The law for NEW ids: lowercase English letters/digits, starts with a letter. */
export const ID_RE = /^[a-z][a-z0-9]*$/

/** The one error message for a non-English new id (UI + server share it). */
export const ENGLISH_ID_ERROR =
  'آیدی جدید فقط حروف انگلیسی کوچک و عدد است و باید با حرف شروع شود (مثلاً: ali22)'

export type IdGateResult =
  | { ok: true; id: string }
  | { ok: false; error: string; /** HTTP status the caller should reply with. */ status: 409 | 422 }

/**
 * Shape check — the syntactic half of the law (no DB access, pure).
 * Length 2..40, no `|` (conversation/storage key separator) and no
 * control characters (they break URLs and headers).
 */
export function checkIdShape(raw: string): IdGateResult {
  const id = String(raw ?? '').trim()
  if (id.length < 2 || id.length > 40)
    return { ok: false, error: 'آیدی باید بین ۲ تا ۴۰ نویسه باشد', status: 422 }
  if (/[\u0000-\u001f\u007f|]/.test(id))
    return { ok: false, error: 'این نویسه در آیدی مجاز نیست', status: 422 }
  return { ok: true, id }
}

/**
 * The full three-step ladder for CLAIMING an id (registration, host id):
 *   1. exact match  → taken (a legacy id holds it — never reassign)
 *   2. case-alias   → taken (same id in other letter-casing exists;
 *                      ids must stay unambiguous case-insensitively)
 *   3. English law  → new ids MUST match ID_RE (legacy holders keep
 *                      theirs — step 1/2 already let them log in)
 */
export function resolveIdGate(
  raw: string,
  exactExists: boolean,
  lowerExists: boolean,
): IdGateResult {
  const shape = checkIdShape(raw)
  if (!shape.ok) return shape
  if (exactExists)
    return { ok: false, error: 'این آیدی قبلاً در این نودهاست گرفته شده است', status: 409 }
  if (lowerExists)
    return {
      ok: false,
      error: 'این آیدی با حروف بزرگ/کوچک متفاوت قبلاً گرفته شده است',
      status: 409,
    }
  if (!ID_RE.test(shape.id)) return { ok: false, error: ENGLISH_ID_ERROR, status: 422 }
  return { ok: true, id: shape.id }
}
