import { NextResponse } from "next/server"

import { MEDIA_LIMITS } from "@/lib/config/media"
import { getMediaActor } from "@/lib/server/media/context"
import { updateOwnProfile } from "@/lib/server/media/profile"

/**
 * Staff edit their own display name and profile photo (multipart: `displayName`,
 * optional `avatar`). A Route Handler rather than a Server Function because a
 * 5 MiB photo exceeds the Server Function body limit (1 MB by default).
 */
export async function POST(request: Request) {
  const noStore = { "cache-control": "private, no-store" }
  const auth = await getMediaActor("staff")
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.message },
      { status: auth.status, headers: noStore }
    )
  }
  const declared = Number(request.headers.get("content-length") ?? 0)
  if (declared > MEDIA_LIMITS.maxAvatarBytes + 64 * 1024) {
    return NextResponse.json(
      {
        ok: false,
        error: "This photo is too large.",
        fieldErrors: { avatar: "This photo is too large." },
      },
      { status: 413, headers: noStore }
    )
  }
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json(
      { ok: false, error: "Could not read the form." },
      { status: 400, headers: noStore }
    )
  }
  const file = form.get("avatar")
  const avatar =
    file instanceof File && file.size > 0
      ? file.size > MEDIA_LIMITS.maxAvatarBytes
        ? "too_large"
        : new Uint8Array(await file.arrayBuffer())
      : null
  if (avatar === "too_large") {
    const error = `Profile photos can be up to ${Math.round(MEDIA_LIMITS.maxAvatarBytes / (1024 * 1024))} MB.`
    return NextResponse.json(
      { ok: false, error, fieldErrors: { avatar: error } },
      { status: 413, headers: noStore }
    )
  }
  const result = await updateOwnProfile(auth.actor, {
    displayName: String(form.get("displayName") ?? ""),
    avatar,
  })
  if (!result.ok) {
    const { status, ...body } = result
    return NextResponse.json(body, { status, headers: noStore })
  }
  return NextResponse.json({ ok: true }, { headers: noStore })
}
