import {
  API_MAJOR,
  AUDIENCES,
  LIMITS,
  PURPOSES,
  QUESTION_KEYS,
  SUPPORTED_SCHEMAS,
  type Audience,
  type Purpose,
} from "./contract"
import { UUID } from "./credentials"
import type { ReaderFailure } from "./errors"

export type AnswersQuery = {
  venueId: string
  keys: string[]
  audience: Audience
  purpose: Purpose
  schema: { major: number; minor: number; text: string }
}

export type Parsed<T> =
  { ok: true; value: T } | { ok: false; failure: ReaderFailure }

const invalid = { ok: false, failure: { code: "invalid_request" } } as const
const ANSWER_PARAMS = ["keys", "audience", "purpose", "schema"] as const
const KEY = /^[a-z0-9_]{1,40}$/
const SCHEMA = /^(\d{1,3})\.(\d{1,3})$/

/** Every parameter appears exactly once and no other parameter appears. */
function singleParams(
  url: URL,
  allowed: readonly string[]
): Record<string, string> | null {
  const out: Record<string, string> = {}
  for (const name of new Set(url.searchParams.keys())) {
    if (!allowed.includes(name)) return null
    const values = url.searchParams.getAll(name)
    if (values.length !== 1) return null
    out[name] = values[0]
  }
  return out
}

export function parseAnswersRequest(
  url: URL,
  venueIdParam: string
): Parsed<AnswersQuery> {
  const params = singleParams(url, ANSWER_PARAMS)
  if (!params) return invalid
  const { keys: rawKeys, audience, purpose, schema } = params
  if (!rawKeys || !audience || !purpose || !schema) return invalid

  const venueId = venueIdParam.toLowerCase()
  if (!UUID.test(venueId)) return invalid

  const keys = rawKeys.split(",")
  if (keys.length > LIMITS.maxKeys) return invalid
  if (new Set(keys).size !== keys.length) return invalid
  for (const key of keys) {
    if (!KEY.test(key) || !QUESTION_KEYS.includes(key)) return invalid
  }

  if (!(AUDIENCES as readonly string[]).includes(audience)) return invalid
  if (!(PURPOSES as readonly string[]).includes(purpose)) return invalid

  const version = SCHEMA.exec(schema)
  if (!version) return invalid
  const major = Number(version[1])
  const minor = Number(version[2])
  const text = `${major}.${minor}`
  if (
    major !== API_MAJOR ||
    text !== schema ||
    !(SUPPORTED_SCHEMAS as readonly string[]).includes(text)
  )
    return {
      ok: false,
      failure: { code: "unsupported_version", supported: SUPPORTED_SCHEMAS },
    }

  return {
    ok: true,
    value: {
      venueId,
      keys,
      audience: audience as Audience,
      purpose: purpose as Purpose,
      schema: { major, minor, text },
    },
  }
}

/** `meta` takes no parameters. */
export function parseMetaRequest(url: URL): Parsed<null> {
  return [...url.searchParams.keys()].length === 0
    ? { ok: true, value: null }
    : invalid
}
