import { isSameOriginRequest } from "@/lib/server/http/same-origin"
import { PRIVATE_HEADERS } from "@/lib/server/media/access"
import { getMediaActor } from "@/lib/server/media/context"
import { previewMenuImport } from "@/lib/server/menus"
import { MENU_IMPORT_LIMITS } from "@/lib/menus/types"

// A Route Handler rather than a Server Function: a menu file may be 1 MiB and
// Server Functions cap request bodies at 1 MB. The upload is decoded as text,
// parsed and compared with the active menu; it is never executed or stored,
// and nothing is written.

/** Multipart framing and the venue field on top of the file itself. */
const MAX_BODY_BYTES = MENU_IMPORT_LIMITS.maxBytes + 64 * 1024

function json(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: {
      ...PRIVATE_HEADERS,
      ...(status === 503 ? { "retry-after": "5" } : {}),
    },
  })
}

const tooLarge = () =>
  json({ ok: false, message: "Menu files can be up to 1 MiB." }, 413)

/** The request body, or null once it exceeds `limit` bytes (stops reading). */
async function readBounded(
  request: Request,
  limit: number
): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

/** POST multipart `file` + `venueId`: parse and diff a JSON/CSV menu file. */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request.headers)) {
    return json({ ok: false, message: "Forbidden." }, 403)
  }
  // Authorise (fresh profile read) before reading the body.
  const auth = await getMediaActor("admin")
  if (!auth.ok) return json({ ok: false, message: auth.message }, auth.status)

  const declared = Number(request.headers.get("content-length") ?? "0")
  if (declared > MAX_BODY_BYTES) return tooLarge()
  const contentType = request.headers.get("content-type") ?? ""
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return json({ ok: false, message: "Choose a JSON or CSV file." }, 400)
  }
  const body = await readBounded(request, MAX_BODY_BYTES)
  if (!body) return tooLarge()

  let form: FormData
  try {
    form = await new Response(body as Uint8Array<ArrayBuffer>, {
      headers: { "content-type": contentType },
    }).formData()
  } catch {
    return json({ ok: false, message: "Choose a JSON or CSV file." }, 400)
  }
  const file = form.get("file")
  const venueId = form.get("venueId")
  if (!(file instanceof File) || typeof venueId !== "string") {
    return json({ ok: false, message: "Choose a JSON or CSV file." }, 400)
  }
  if (file.size === 0) {
    return json({ ok: false, message: "The file is empty." }, 400)
  }
  if (file.size > MENU_IMPORT_LIMITS.maxBytes) return tooLarge()

  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(
      await file.arrayBuffer()
    )
  } catch {
    return json(
      {
        ok: false,
        message:
          "The file is not UTF-8 text. Only JSON or CSV text files can be imported.",
      },
      400
    )
  }

  const result = await previewMenuImport(auth.actor, {
    venueId,
    fileName: file.name,
    text,
  })
  if (!result.ok) {
    return json(
      {
        ok: false,
        message: result.message,
        ...("issues" in result ? { issues: result.issues } : {}),
      },
      result.status
    )
  }
  const { ok: _ok, ...preview } = result
  void _ok
  return json({ ok: true, preview }, 200)
}
