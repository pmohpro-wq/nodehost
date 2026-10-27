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

/** Batch size of the retry drain sweep. */
export const RETRY_BATCH = 50

/** Timeout of one HTTP forward POST to a remote ingress. */
export const POST_TIMEOUT_MS = 5_000

/** Mailbox rows replayed to an admin right after login. */
export const MAILBOX_REPLAY = 60

/** Max mailbox rows returned by mailbox:list / GET /internal/mailbox. */
export const MAILBOX_LIST = 80

/** Max rows returned by chat:history (per conversation). */
export const CHAT_HISTORY = 200

/** SysLog rows kept after boot-time trim (older rows are deleted). */
export const LOG_TRIM_KEEP = 400
