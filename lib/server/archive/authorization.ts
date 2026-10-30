import "server-only"

import { createHash, timingSafeEqual } from "node:crypto"

export function archiveBearerAuthorized(
  request: Request
): "ok" | "unconfigured" | "unauthorized" {
  const secret = process.env.CLEANUP_SECRET
  if (!secret || secret.length < 32) return "unconfigured"
  const header = request.headers.get("authorization") ?? ""
  const given = header.startsWith("Bearer ") ? header.slice(7) : ""
  return timingSafeEqual(
    createHash("sha256").update(given).digest(),
    createHash("sha256").update(secret).digest()
  )
    ? "ok"
    : "unauthorized"
}
