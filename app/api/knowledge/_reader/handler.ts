import "server-only"

import { randomUUID } from "node:crypto"

import { LIMITS, SUPPORTED_SCHEMAS, type ReaderAnswer } from "./contract"
import {
  bearerCredential,
  consumerQuestions,
  credentialOutsideHeader,
  readerConfigFromEnv,
  verifyCredential,
  type Consumer,
  type ReaderConfig,
} from "./credentials"
import { errorResponse, NO_STORE, type ReaderFailure } from "./errors"
import { ConsumerLimiter } from "./rate-limit"
import { parseAnswersRequest, parseMetaRequest } from "./request"
import {
  etagMatches,
  notPermittedAnswer,
  parseResolverRow,
  snapshotEtag,
  toAnswer,
} from "./answers"
import {
  notIntegratedSource,
  type ReaderSource,
  type ReaderSourceResult,
} from "./source"

export type ReaderLogEntry = {
  requestId: string
  route: "answers" | "meta"
  status: number
  consumerId: string | null
  audience: string | null
  purpose: string | null
  venueId: string | null
  keys: readonly string[]
  revisions: Record<string, number | null>
  note: string | null
  durationMs: number
}

export type ReaderDeps = {
  config: () => ReaderConfig
  source: ReaderSource
  limiter: ConsumerLimiter
  now: () => number
  requestId: () => string
  sourceTimeoutMs: number
  /** Request metadata only: never a credential, digest or answer content. */
  log: (entry: ReaderLogEntry) => void
}

let defaults: ReaderDeps | null = null

export function defaultReaderDeps(): ReaderDeps {
  defaults ??= {
    config: () => readerConfigFromEnv(),
    source: notIntegratedSource,
    limiter: new ConsumerLimiter(),
    now: Date.now,
    requestId: randomUUID,
    sourceTimeoutMs: LIMITS.sourceTimeoutMs,
    log: (entry) => console.info("[knowledge-reader]", entry),
  }
  return defaults
}

type Context = {
  deps: ReaderDeps
  requestId: string
  head: boolean
  started: number
  log: Omit<ReaderLogEntry, "status" | "durationMs">
}

function finish(ctx: Context, response: Response): Response {
  ctx.deps.log({
    ...ctx.log,
    status: response.status,
    durationMs: ctx.deps.now() - ctx.started,
  })
  return response
}

const fail = (
  ctx: Context,
  failure: ReaderFailure,
  note: string | null = null
) =>
  finish(
    { ...ctx, log: { ...ctx.log, note } },
    errorResponse(failure, ctx.requestId, ctx.head)
  )

function jsonResponse(ctx: Context, body: unknown, etag?: string): Response {
  const json = JSON.stringify(body)
  if (Buffer.byteLength(json) > LIMITS.maxResponseBytes)
    return fail(ctx, { code: "internal_error" }, "response_too_large")
  const headers = new Headers({
    "content-type": "application/json",
    "cache-control": NO_STORE,
    "x-request-id": ctx.requestId,
  })
  if (etag) headers.set("etag", etag)
  return finish(
    ctx,
    new Response(ctx.head ? null : json, { status: 200, headers })
  )
}

/** Method, URL size, configuration and credential: shared by every route. */
function authenticate(
  request: Request,
  ctx: Context
): { ok: true; consumer: Consumer } | { ok: false; response: Response } {
  if (request.method !== "GET" && request.method !== "HEAD")
    return { ok: false, response: fail(ctx, { code: "method_not_allowed" }) }
  if (Buffer.byteLength(request.url) > LIMITS.maxUrlBytes)
    return { ok: false, response: fail(ctx, { code: "request_too_large" }) }
  const config = ctx.deps.config()
  if (!config.ok)
    return {
      ok: false,
      response: fail(ctx, { code: "reader_unavailable" }, config.reason),
    }
  const consumer = credentialOutsideHeader(request)
    ? null
    : verifyCredential(
        config.registry,
        bearerCredential(request.headers),
        ctx.deps.now()
      )
  if (!consumer)
    return { ok: false, response: fail(ctx, { code: "unauthenticated" }) }
  ctx.log.consumerId = consumer.id
  return { ok: true, consumer }
}

function begin(
  request: Request,
  deps: ReaderDeps,
  route: "answers" | "meta"
): Context {
  return {
    deps,
    requestId: deps.requestId(),
    head: request.method === "HEAD",
    started: deps.now(),
    log: {
      requestId: "",
      route,
      consumerId: null,
      audience: null,
      purpose: null,
      venueId: null,
      keys: [],
      revisions: {},
      note: null,
    },
  }
}

async function readWithTimeout(
  deps: ReaderDeps,
  venueId: string,
  keys: readonly string[]
): Promise<ReaderSourceResult | "timeout" | "error"> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve("timeout")
    }, deps.sourceTimeoutMs)
  })
  try {
    return await Promise.race([
      deps.source({ venueId, keys, signal: controller.signal }),
      timeout,
    ])
  } catch {
    return "error"
  } finally {
    clearTimeout(timer)
  }
}

/** GET /api/knowledge/v1/venues/{venueId}/answers */
export async function handleAnswersRequest(
  request: Request,
  venueIdParam: string,
  deps: ReaderDeps = defaultReaderDeps()
): Promise<Response> {
  const ctx = begin(request, deps, "answers")
  ctx.log.requestId = ctx.requestId
  const auth = authenticate(request, ctx)
  if (!auth.ok) return auth.response
  const { consumer } = auth

  const parsed = parseAnswersRequest(new URL(request.url), venueIdParam)
  if (!parsed.ok) return fail(ctx, parsed.failure)
  const query = parsed.value
  if (
    !consumer.schemaMajors.has(query.schema.major) ||
    !consumer.audiences.has(query.audience) ||
    !consumer.purposes.has(query.purpose)
  )
    return fail(ctx, { code: "forbidden" })
  ctx.log = {
    ...ctx.log,
    audience: query.audience,
    purpose: query.purpose,
    venueId: query.venueId,
    keys: query.keys,
  }
  // Outside the credential's venues looks exactly like an unknown venue.
  if (!consumer.venues.has(query.venueId))
    return fail(ctx, { code: "venue_not_found" })

  const slot = deps.limiter.acquire(consumer.id)
  if (!slot.ok)
    return fail(ctx, {
      code: "rate_limited",
      retryAfterSeconds: slot.retryAfterSeconds,
    })
  try {
    const permitted = new Set(consumerQuestions(consumer))
    const readable = query.keys.filter((key) => permitted.has(key))
    const byKey = new Map<string, ReaderAnswer>()
    if (readable.length > 0) {
      const result = await readWithTimeout(deps, query.venueId, readable)
      if (result === "timeout")
        return fail(
          ctx,
          { code: "reader_unavailable", retryAfterSeconds: 5 },
          "source_timeout"
        )
      if (result === "error" || !result.ok) {
        if (result !== "error" && result.error === "venue_not_found")
          return fail(ctx, { code: "venue_not_found" })
        return fail(
          ctx,
          { code: "reader_unavailable", retryAfterSeconds: 30 },
          "source_unavailable"
        )
      }
      for (const raw of result.rows) {
        const row = parseResolverRow(raw)
        const answer =
          row && readable.includes(row.question_key)
            ? toAnswer(row, query.audience)
            : null
        if (!answer || byKey.has(answer.key))
          return fail(ctx, { code: "internal_error" }, "resolver_contract")
        byKey.set(answer.key, answer)
      }
      if (byKey.size !== readable.length)
        return fail(ctx, { code: "internal_error" }, "resolver_contract")
    }

    const answers = query.keys.map(
      (key) => byKey.get(key) ?? notPermittedAnswer(key)
    )
    ctx.log.revisions = Object.fromEntries(
      answers.map((a) => [a.key, a.revision])
    )
    const etag = snapshotEtag({
      venueId: query.venueId,
      audience: query.audience,
      schema: query.schema.text,
      answers,
    })
    if (etagMatches(request.headers.get("if-none-match"), etag)) {
      const headers = new Headers({
        etag,
        "cache-control": NO_STORE,
        "x-request-id": ctx.requestId,
      })
      return finish(ctx, new Response(null, { status: 304, headers }))
    }
    return jsonResponse(
      ctx,
      {
        schema: query.schema.text,
        venue: { id: query.venueId },
        audience: query.audience,
        purpose: query.purpose,
        snapshot: { readAt: new Date(deps.now()).toISOString(), etag },
        answers,
      },
      etag
    )
  } finally {
    slot.release()
  }
}

/** GET /api/knowledge/v1/meta: what this credential may read. */
export async function handleMetaRequest(
  request: Request,
  deps: ReaderDeps = defaultReaderDeps()
): Promise<Response> {
  const ctx = begin(request, deps, "meta")
  ctx.log.requestId = ctx.requestId
  const auth = authenticate(request, ctx)
  if (!auth.ok) return auth.response
  const { consumer } = auth
  const parsed = parseMetaRequest(new URL(request.url))
  if (!parsed.ok) return fail(ctx, parsed.failure)
  const slot = deps.limiter.acquire(consumer.id)
  if (!slot.ok)
    return fail(ctx, {
      code: "rate_limited",
      retryAfterSeconds: slot.retryAfterSeconds,
    })
  try {
    return jsonResponse(ctx, {
      supportedSchemas: SUPPORTED_SCHEMAS,
      consumer: {
        id: consumer.id,
        venues: [...consumer.venues].sort(),
        audiences: [...consumer.audiences],
        purposes: [...consumer.purposes],
        questions: consumerQuestions(consumer),
        schemaMajors: [...consumer.schemaMajors],
      },
    })
  } finally {
    slot.release()
  }
}
