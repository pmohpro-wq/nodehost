/**
 * config.ts — every kernel tunable in ONE place.
 *
 * No behavior lives here; these are the knobs the rest of the kernel
 * reads. Keeping them named (instead of magic numbers scattered across
 * files) is what makes the store-and-forward and heartbeat behavior
 * auditable at a glance.
 */

/** Federation heartbeat sweep (sys.hello to every known remote host). */
export const HEARTBEAT_MS = 8_000

/** Store-and-forward drain sweep for queued outbound envelopes. */
export const RETRY_SWEEP_MS = 7_000

/** Attempts before a queued outbound envelope is dead-lettered. */
export const MAX_SEND_ATTEMPTS = 6

/**
 * Exponential backoff between retries of one queued envelope:
 *   delay(attempts) = RETRY_SWEEP_MS * 2^(attempts - 1), capped.
 * attempts=1 → 7s, 2 → 14s, 3 → 28s, 4 → 56s, 5 → 112s (capped).
 */
export const MAX_BACKOFF_MS = 120_000

export const backoffDelayMs = (attempts: number) =>
  Math.min(RETRY_SWEEP_MS * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS)

/** Batch size of the retry drain sweep. */
export const RETRY_BATCH = 50

/** Timeout of one HTTP forward POST to a remote ingress. */
export const POST_TIMEOUT_MS = 5_000

/** Default wait for a correlated reply in ctx.request(). */
export const REQUEST_TIMEOUT_MS = 10_000

/** Mailbox rows replayed to an admin right after login. */
export const MAILBOX_REPLAY = 60

/** Max mailbox rows returned by mailbox:list / GET /internal/mailbox. */
export const MAILBOX_LIST = 80

/** Max rows returned by chat:history (per conversation). */
export const CHAT_HISTORY = 200

/** SysLog rows kept after boot-time trim (older rows are deleted). */
export const LOG_TRIM_KEEP = 400

// ------------------------------------------------------------
// Discovery & scale (NHP 1.1) — the knobs that keep federation
// bounded when the network grows from a handful of hosts to
// thousands. Every heartbeat payload is capped, every learned
// entry expires, and first contact resolves via well-known.
// ------------------------------------------------------------

/** Max remote-host hints carried in ONE hello (gossip fan-out bound). */
export const GOSSIP_HOSTS_MAX = 200

/** Max roster entries carried in ONE hello (nodes offering apps). */
export const ROSTER_MAX = 500

/** Roster entries (netDirectory rows) unseen for this long are dropped. */
export const DIR_TTL_MS = 24 * 60 * 60 * 1000 // 24h

/** Remote hosts unreachable for this long are dropped + their roster rows. */
export const HOST_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

/** How often the TTL sweep runs (and at boot, once, immediately). */
export const DIR_SWEEP_MS = 30 * 60 * 1000 // 30 min

/** Timeout of one well-known resolution fetch. */
export const RESOLVE_TIMEOUT_MS = 4_000

/** After a failed resolution, do not re-probe the same host for this long. */
export const RESOLVE_COOLDOWN_MS = 60_000
