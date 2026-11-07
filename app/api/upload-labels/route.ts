import { workFocus } from "@/lib/config/work-roles"
import type { SaveLabelsInput, SaveLabelsResult } from "@/lib/menus/types"
import { getLabellingCatalogue, saveAssetLabels } from "@/lib/server/labels"
import { getMediaActor } from "@/lib/server/media/context"
import { isUuid } from "@/lib/server/menus/validate"

const headers = { "Cache-Control": "private, no-store" }

/** Keep these requests independent of the Server Actions processing uploads. */
export async function GET() {
  const auth = await getMediaActor("staff")
  if (!auth.ok)
    return Response.json(
      { ok: false, message: auth.message },
      { status: auth.status, headers }
    )
  const { actor } = auth
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

  const { actor } = auth
  const asset = await actor.db
    .from("media_assets")
    .select("venue_id")
    .eq("id", input.assetId)
    .eq("uploader_id", actor.profile.id)
    .eq("upload_state", "ready")
    .eq("purpose", "general")
    .is("deleted_at", null)
    .maybeSingle()
  if (asset.error)
    return fail(
      input.assetId,
      "unavailable",
      "Could not check this upload. Try again.",
      503
    )
  if (!asset.data || asset.data.venue_id !== body.venueId)
    return fail(
      input.assetId,
      "not_found",
      "These labels could not be applied to this upload. Check the file in your portfolio.",
      404
    )

  // The RPC validates the complete input, catalogue and revision, and rechecks
  // that the caller still owns a ready asset before writing.
  return Response.json(await saveAssetLabels(actor, input), { headers })
}
