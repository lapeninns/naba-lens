import { searchToFilters, toServiceFilters } from "@/app/_media/search-params"
import { isSameOriginRequest } from "@/lib/server/http/same-origin"
import { PRIVATE_HEADERS } from "@/lib/server/media/access"
import { getMediaActor } from "@/lib/server/media/context"
import { OWN_MEDIA_ROLES } from "@/lib/server/media/roles"
import { searchAssets } from "@/lib/server/media/search"

function json(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: {
      ...PRIVATE_HEADERS,
      ...(status === 503 ? { "retry-after": "5" } : {}),
    },
  })
}

const AUTH_CODE = {
  401: "signed_out",
  403: "not_permitted",
  503: "unavailable",
} as const

/**
 * One page of asset search (B05-06) as JSON for the search screen's Show more
 * and Search again: an abortable GET rather than a Server Function, which
 * takes no signal and would hold up later actions. Managers (legacy grant
 * holders included) search their venue and admins every venue; the database
 * decides, so staff are refused there (403), never pre-filtered here.
 * Params: the filter keys of the screen's URL, plus `cursor` and `limit`.
 * Thumbnails are /api/media/[id]/thumb. Never cached.
 */
export async function GET(request: Request) {
  if (!isSameOriginRequest(request.headers)) {
    return json(
      { ok: false, code: "not_permitted", message: "Forbidden." },
      403
    )
  }
  const auth = await getMediaActor(OWN_MEDIA_ROLES)
  if (!auth.ok) {
    return json(
      { ok: false, code: AUTH_CODE[auth.status], message: auth.message },
      auth.status
    )
  }
  const params = new URL(request.url).searchParams
  const rawLimit = params.get("limit")
  const result = await searchAssets(auth.actor, {
    filters: toServiceFilters(searchToFilters(params)),
    cursor: params.get("cursor"),
    // A number only when it is one; anything else reaches the service as
    // given, so it answers with fieldErrors.limit.
    limit:
      rawLimit === null
        ? undefined
        : /^\d+$/.test(rawLimit)
          ? Number(rawLimit)
          : rawLimit,
  })
  if (!result.ok) {
    const { status, code, message, fieldErrors } = result
    return json(
      { ok: false, code, message, ...(fieldErrors ? { fieldErrors } : {}) },
      status
    )
  }
  return json(
    { ok: true, page: { items: result.items, nextCursor: result.nextCursor } },
    200
  )
}
