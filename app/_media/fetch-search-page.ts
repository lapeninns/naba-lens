import type {
  SearchPageFailure,
  SearchPageResult,
} from "@/components/nabalens/search/types"

/** A slow reply is given up after this long (and reported as no reply). */
export const SEARCH_FETCH_TIMEOUT_MS = 15_000

const NO_REPLY: SearchPageFailure = {
  ok: false,
  status: 0,
  code: "no_reply",
  message: "No reply.",
}

/** The caller's own abort, as fetch would throw it. */
function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Aborted", "AbortError")
}

/**
 * GET one page of asset search from /api/media/search with the screen's
 * canonical query string plus `cursor`. `signal` really cancels it (unlike a
 * Server Function call); a reply slower than 15 s is abandoned too. Never
 * rejects: a typed failure keeps the code and field errors. An abort by the
 * caller rethrows so a stale page can be ignored.
 *
 * The caller's signal and the timeout are combined by hand: AbortSignal.any
 * is missing from Safari before 17.4, which Next still supports.
 */
export async function fetchSearchPage(
  search: string,
  cursor: string | null,
  signal?: AbortSignal
): Promise<SearchPageResult> {
  if (signal?.aborted) throw abortError(signal)
  const query = new URLSearchParams(search)
  if (cursor) query.set("cursor", cursor)
  const qs = query.toString()
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal?.addEventListener("abort", onAbort, { once: true })
  const timer = setTimeout(onAbort, SEARCH_FETCH_TIMEOUT_MS)
  try {
    let response: Response
    try {
      response = await fetch(
        qs ? `/api/media/search?${qs}` : "/api/media/search",
        {
          signal: controller.signal,
          cache: "no-store",
          headers: { accept: "application/json" },
        }
      )
    } catch (error) {
      if (signal?.aborted) throw error
      return NO_REPLY
    }
    const body = (await response.json().catch(() => null)) as
      | SearchPageResult
      | { ok: false; code?: string; message?: string; fieldErrors?: unknown }
      | null
    if (signal?.aborted) throw abortError(signal)
    if (response.ok && body?.ok) return { ok: true, page: body.page }
    if (!body || body.ok) return { ...NO_REPLY, status: response.status }
    return {
      ok: false,
      status: response.status,
      code: (body.code as SearchPageFailure["code"]) ?? "unavailable",
      message: body.message ?? "",
      ...(body.fieldErrors && typeof body.fieldErrors === "object"
        ? { fieldErrors: body.fieldErrors as Record<string, string> }
        : {}),
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener("abort", onAbort)
  }
}
