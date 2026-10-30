import { isSameOriginRequest } from "@/lib/server/http/same-origin"
import { PRIVATE_HEADERS } from "@/lib/server/media/access"
import { getMediaActor } from "@/lib/server/media/context"
import type { MediaActor, MediaPage } from "@/lib/server/media/types"

type Listed =
  | { ok: true; items: MediaPage["items"]; nextCursor: string | null }
  | { ok: false; status: number; message: string }

function json(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: {
      ...PRIVATE_HEADERS,
      ...(status === 503 ? { "retry-after": "5" } : {}),
    },
  })
}

/**
 * A gallery page as JSON for the foreground refresh, with the same checks and
 * result shape as the Server Functions (loadMyMedia, loadLibraryPage): a fresh
 * profile read for `role`, then the RLS-scoped list. A Route Handler rather
 * than a Server Function so the browser can abort a slow refresh: Server
 * Functions take no signal and run one at a time, so an abandoned one would
 * hold up later actions such as uploads (final review F5). Never cached.
 */
export async function mediaPageResponse(
  request: Request,
  role: "staff" | "admin",
  list: (actor: MediaActor, params: URLSearchParams) => Promise<Listed>
) {
  if (!isSameOriginRequest(request.headers)) {
    return json({ ok: false, message: "Forbidden." }, 403)
  }
  const auth = await getMediaActor(role)
  if (!auth.ok) {
    return json({ ok: false, message: auth.message }, auth.status)
  }
  const result = await list(auth.actor, new URL(request.url).searchParams)
  if (!result.ok) {
    return json({ ok: false, message: result.message }, result.status)
  }
  const page: MediaPage = { items: result.items, nextCursor: result.nextCursor }
  return json({ ok: true, page }, 200)
}
