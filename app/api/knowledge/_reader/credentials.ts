import "server-only"

import { createHash, timingSafeEqual } from "node:crypto"

import {
  API_MAJOR,
  AUDIENCES,
  LIMITS,
  PURPOSES,
  QUESTION_KEYS,
  type Audience,
  type Purpose,
} from "./contract"

export type Consumer = {
  id: string
  credentials: readonly { digest: Buffer; expiresAt: number }[]
  venues: ReadonlySet<string>
  audiences: ReadonlySet<Audience>
  purposes: ReadonlySet<Purpose>
  /** `all` is every key the audience may read (QUESTION_KEYS in v1). */
  questions: ReadonlySet<string> | "all"
  schemaMajors: ReadonlySet<number>
  disabled: boolean
}

export type Registry = ReadonlyMap<string, Consumer>

export type ReaderConfig =
  | { ok: true; registry: Registry }
  | { ok: false; reason: "disabled" | "invalid_registry" }

export const CREDENTIAL_PATTERN =
  /^nlr_([a-z0-9-]{3,40})_([A-Za-z0-9_-]{43,256})$/
const CONSUMER_ID = /^[a-z0-9-]{3,40}$/
const SHA256_HEX = /^[0-9a-f]{64}$/
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const ENTRY_KEYS = new Set([
  "id",
  "credentials",
  "venues",
  "audiences",
  "purposes",
  "questions",
  "schemaMajors",
  "disabled",
])

/** The digest stored in the registry for a credential (operators use this). */
export function credentialDigest(credential: string): string {
  return createHash("sha256").update(credential).digest("hex")
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

function subset<T extends string | number>(
  value: unknown,
  allowed: readonly T[]
): Set<T> | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const out = new Set<T>()
  for (const item of value) {
    if (!allowed.includes(item as T) || out.has(item as T)) return null
    out.add(item as T)
  }
  return out
}

function parseEntry(raw: unknown): Consumer | null {
  if (!isObject(raw)) return null
  if (Object.keys(raw).some((key) => !ENTRY_KEYS.has(key))) return null
  const { id, credentials, venues, disabled } = raw
  if (typeof id !== "string" || !CONSUMER_ID.test(id)) return null

  if (
    !Array.isArray(credentials) ||
    credentials.length === 0 ||
    credentials.length > LIMITS.maxCredentialsPerConsumer
  )
    return null
  const parsedCredentials: { digest: Buffer; expiresAt: number }[] = []
  for (const c of credentials) {
    if (!isObject(c) || Object.keys(c).sort().join() !== "expiresAt,sha256")
      return null
    if (typeof c.sha256 !== "string" || !SHA256_HEX.test(c.sha256)) return null
    if (typeof c.expiresAt !== "string") return null
    const expiresAt = Date.parse(c.expiresAt)
    if (!Number.isFinite(expiresAt)) return null
    parsedCredentials.push({ digest: Buffer.from(c.sha256, "hex"), expiresAt })
  }

  if (!Array.isArray(venues) || venues.length === 0) return null
  const venueSet = new Set<string>()
  for (const v of venues) {
    if (typeof v !== "string" || !UUID.test(v.toLowerCase())) return null
    venueSet.add(v.toLowerCase())
  }

  const audiences = subset(raw.audiences, AUDIENCES)
  const purposes = subset(raw.purposes, PURPOSES)
  const schemaMajors = subset(raw.schemaMajors, [API_MAJOR])
  const questions =
    raw.questions === "all" ? "all" : subset(raw.questions, QUESTION_KEYS)
  if (!audiences || !purposes || !schemaMajors || !questions) return null
  if (disabled !== undefined && typeof disabled !== "boolean") return null

  return {
    id,
    credentials: parsedCredentials,
    venues: venueSet,
    audiences,
    purposes,
    questions,
    schemaMajors,
    disabled: disabled ?? false,
  }
}

/**
 * The consumer registry from its JSON configuration, or null when any part is
 * invalid: a malformed registry disables the reader rather than guessing.
 */
export function parseRegistry(raw: string | undefined): Registry | null {
  if (!raw) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > LIMITS.maxConsumers
  )
    return null
  const registry = new Map<string, Consumer>()
  for (const entry of value) {
    const consumer = parseEntry(entry)
    if (!consumer || registry.has(consumer.id)) return null
    registry.set(consumer.id, consumer)
  }
  return registry
}

let cached: { raw: string; registry: Registry | null } | null = null

/**
 * v1 configuration: `KNOWLEDGE_READER_ENABLED=true` switches the reader on and
 * `KNOWLEDGE_READER_CONSUMERS` holds the registry (digests, never credentials).
 */
export function readerConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): ReaderConfig {
  if (env.KNOWLEDGE_READER_ENABLED !== "true")
    return { ok: false, reason: "disabled" }
  const raw = env.KNOWLEDGE_READER_CONSUMERS ?? ""
  if (cached?.raw !== raw) cached = { raw, registry: parseRegistry(raw) }
  return cached.registry
    ? { ok: true, registry: cached.registry }
    : { ok: false, reason: "invalid_registry" }
}

/** The bearer credential, or null when the header is absent or not Bearer. */
export function bearerCredential(headers: Headers): string | null {
  const header = headers.get("authorization")
  if (!header || header.length > LIMITS.maxCredentialLength + 7) return null
  const match = /^Bearer ([^\s]+)$/i.exec(header)
  return match ? match[1] : null
}

/**
 * True when something that looks like a reader credential arrived outside the
 * Authorization header: the query string or a cookie. Such requests are
 * refused, so a credential pasted into a URL never works.
 */
export function credentialOutsideHeader(request: Request): boolean {
  const url = new URL(request.url)
  for (const [name, value] of url.searchParams) {
    if (name.includes("nlr_") || value.includes("nlr_")) return true
  }
  return (request.headers.get("cookie") ?? "").includes("nlr_")
}

const NO_MATCH = Buffer.alloc(32)

/**
 * The consumer a credential belongs to, if it is well formed, its digest
 * matches one of the consumer's (both slots are always compared, in constant
 * time), it has not expired and the consumer is not disabled.
 */
export function verifyCredential(
  registry: Registry,
  credential: string | null,
  now: number
): Consumer | null {
  const match = credential ? CREDENTIAL_PATTERN.exec(credential) : null
  const digest = createHash("sha256")
    .update(credential ?? "")
    .digest()
  const consumer = match ? registry.get(match[1]) : undefined
  let accepted = false
  for (let slot = 0; slot < LIMITS.maxCredentialsPerConsumer; slot++) {
    const stored = consumer?.credentials[slot]
    const same = timingSafeEqual(digest, stored?.digest ?? NO_MATCH)
    if (same && stored && stored.expiresAt > now) accepted = true
  }
  if (!match || !consumer || !accepted || consumer.disabled) return null
  return consumer
}

/** The keys a consumer may read, in registry order. */
export function consumerQuestions(consumer: Consumer): readonly string[] {
  const { questions } = consumer
  return questions === "all"
    ? QUESTION_KEYS
    : QUESTION_KEYS.filter((key) => questions.has(key))
}
