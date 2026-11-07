import { workFocus } from "@/lib/config/work-roles"
import type { SaveLabelsInput, SaveLabelsResult } from "@/lib/menus/types"
import {
  discardPendingLabels,
  getLabellingCatalogue,
  listPendingLabels,
  stageAssetLabels,
} from "@/lib/server/labels"
import { getMediaActor } from "@/lib/server/media/context"
import { isUuid } from "@/lib/server/menus/validate"

const headers = { "Cache-Control": "private, no-store" }

/**
 * Keep these requests independent of the Server Actions processing uploads.
 * No query: the caller's labelling catalogue. `?attention=1`: the caller's
 * stored upload drafts (PendingLabelItem[]).
 */
export async function GET(request: Request) {
  const auth = await getMediaActor("staff")
  if (!auth.ok)
    return Response.json(
      { ok: false, message: auth.message },
      { status: auth.status, headers }
    )
  const { actor } = auth

  if (new URL(request.url).searchParams.get("attention") === "1") {
    const listed = await listPendingLabels(actor)
    if (!listed.ok)
      return Response.json(
        { ok: false, message: listed.message },
        { status: listed.status, headers }
      )
    return Response.json({ ok: true, items: listed.items }, { headers })
  }

  if (!actor.profile.venueId)
    return Response.json(
      { ok: false, message: "Your account is not assigned to a venue." },
      { status: 403, headers }
    )
  const found = await getLabellingCatalogue(actor, actor.profile.venueId)
  if (!found.ok)
    return Response.json(
      { ok: false, message: "The menu could not be loaded. Try again." },
      { status: found.status, headers }
    )
  const work = actor.profile.work
  return Response.json(
    {
      ok: true,
      catalogue: found.catalogue,
      focus: work ? workFocus(work.roleKey, work.workAreas) : null,
    },
    { headers }
  )
}

/**
 * Labels for one of the caller's uploads: saved now when it is ready
 * (`state: "saved"`), otherwise stored for finalise (`state: "pending"`).
 */
export async function POST(request: Request) {
  function fail(
    assetId: string,
    code: Extract<SaveLabelsResult, { ok: false }>["code"],
    message: string,
    status: number
  ) {
    return Response.json(
      { ok: false, assetId, code, message },
      { status, headers }
    )
  }

  const auth = await getMediaActor("staff")
  if (!auth.ok) return fail("", "unavailable", auth.message, auth.status)
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
    return fail("", "invalid", "Expected a label draft.", 415)
  const body = (await request.json().catch(() => null)) as {
    venueId?: unknown
    input?: SaveLabelsInput
  } | null
  const input = body?.input
  if (!isUuid(input?.assetId) || !isUuid(body?.venueId))
    return fail("", "invalid", "This label draft was invalid.", 400)

  // The RPCs check ownership, purpose, venue and state under the asset row
  // lock, and validate the complete input before anything is stored or saved.
  const { status, result } = await stageAssetLabels(
    auth.actor,
    body.venueId,
    input
  )
  return Response.json(result, { status, headers })
}

/**
 * Discards the caller's stored draft of `?assetId=` (idempotent):
 * UploadLabelDiscardResult, `already_applied` when finalise applied it first.
 */
export async function DELETE(request: Request) {
  const auth = await getMediaActor("staff")
  if (!auth.ok)
    return Response.json(
      { ok: false, message: auth.message },
      { status: auth.status, headers }
    )
  const assetId = new URL(request.url).searchParams.get("assetId")
  if (!isUuid(assetId))
    return Response.json(
      { ok: false, message: "This upload could not be found." },
      { status: 400, headers }
    )
  const discarded = await discardPendingLabels(auth.actor, assetId)
  if (!discarded.ok)
    return Response.json(
      { ok: false, message: discarded.message },
      { status: discarded.status, headers }
    )
  return Response.json(discarded, { headers })
}
