import "server-only"

import { createHash, timingSafeEqual } from "node:crypto"

type Authorization = "ok" | "unconfigured" | "unauthorized"

function bearerAuthorized(
  request: Request,
  candidates: unknown[]
): Authorization {
  const secrets = candidates.filter(
    (value): value is string => typeof value === "string" && value.length >= 32
  )
  if (secrets.length === 0) return "unconfigured"
  const header = request.headers.get("authorization") ?? ""
  const given = header.startsWith("Bearer ") ? header.slice(7) : ""
  const digest = createHash("sha256").update(given).digest()
  // Always compare each configured credential. The monitor credential is only
  // supplied by the read-only status boundary, never by a mutating job.
  let matches = 0
  for (const secret of secrets) {
    matches |= Number(
      timingSafeEqual(digest, createHash("sha256").update(secret).digest())
    )
  }
  return matches ? "ok" : "unauthorized"
}

export function archiveBearerAuthorized(request: Request): Authorization {
  return bearerAuthorized(request, [process.env.CLEANUP_SECRET])
}

/** This narrower credential grants no authority to copy or remove media. */
export function archiveStatusBearerAuthorized(request: Request): Authorization {
  return bearerAuthorized(request, [
    process.env.CLEANUP_SECRET,
    process.env.MEDIA_ARCHIVE_MONITOR_SECRET,
  ])
}
