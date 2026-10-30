import { NextResponse, type NextRequest } from "next/server"

import { authorize } from "@/lib/auth"
import { MEDIA_LIMITS } from "@/lib/config/media"
import { createAvatarDerivative } from "@/lib/media"
import {
  replaceProfileAvatar,
  type AccountErrorCode,
} from "@/lib/server/accounts"
import { accountsContext } from "@/lib/server/accounts/request"
import { isSameOriginRequest } from "@/lib/server/http/same-origin"

// A Route Handler rather than a Server Function: avatars may be 4 MiB and Server
// Functions default to a 1 MB body limit.

const STATUS: Partial<Record<AccountErrorCode, number>> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid_input: 400,
}

// Multipart framing on top of the file itself.
const MAX_BODY_BYTES = MEDIA_LIMITS.maxAvatarBytes + 64 * 1024
const AVATAR_MB = Math.round(MEDIA_LIMITS.maxAvatarBytes / (1024 * 1024))

// HEIC decode (15 s deadline) plus queueing; well inside every plan's cap.
export const maxDuration = 120

function json(status: number, body: object) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
}

/** POST multipart `file`: replace a staff member's profile photo (admin only). */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Same-origin only; session cookies are SameSite=Lax but check anyway.
  if (!isSameOriginRequest(request.headers)) {
    return json(403, { ok: false, error: "Forbidden." })
  }

  // Authorise before reading a multi-megabyte body.
  const auth = await authorize("admin")
  if (!auth.ok) return json(auth.status, { ok: false, error: "Forbidden." })

  const declared = Number(request.headers.get("content-length") ?? "0")
  if (declared > MAX_BODY_BYTES) {
    return json(413, {
      ok: false,
      error: `Profile photos can be up to ${AVATAR_MB} MB.`,
      fieldErrors: { avatar: `Profile photos can be up to ${AVATAR_MB} MB.` },
    })
  }

  let file: FormDataEntryValue | null = null
  try {
    file = (await request.formData()).get("file")
  } catch {
    file = null
  }
  if (!(file instanceof File)) {
    return json(400, {
      ok: false,
      error: "Choose a photo.",
      fieldErrors: { avatar: "Choose a photo." },
    })
  }
  if (file.size > MEDIA_LIMITS.maxAvatarBytes) {
    return json(413, {
      ok: false,
      error: `Profile photos can be up to ${AVATAR_MB} MB.`,
      fieldErrors: { avatar: `Profile photos can be up to ${AVATAR_MB} MB.` },
    })
  }

  const { id } = await params
  const result = await replaceProfileAvatar(
    await accountsContext(),
    id,
    new Uint8Array(await file.arrayBuffer()),
    async (bytes) => new Uint8Array(await createAvatarDerivative(bytes))
  )
  if (!result.ok) {
    return json(STATUS[result.code] ?? 500, {
      ok: false,
      error: result.error,
      fieldErrors: result.fieldErrors,
    })
  }
  return json(200, { ok: true })
}
