import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match"
import { describe, expect, it } from "vitest"

import nextConfig from "@/next.config"

/** The headers Next sends for a path: every matching entry, later ones win. */
async function effectiveHeaders(path: string) {
  const entries = (await nextConfig.headers?.()) ?? []
  const result = new Map<string, string>()
  for (const entry of entries) {
    if (getPathMatch(entry.source)(path) === false) continue
    for (const { key, value } of entry.headers) result.set(key, value)
  }
  return result
}

describe("next.config headers", () => {
  it("keeps no-referrer on private media, evidence and avatar routes", async () => {
    const page = await effectiveHeaders("/staff")
    for (const path of [
      "/api/media/00000000-0000-4000-8000-000000000001/thumb",
      "/api/media/00000000-0000-4000-8000-000000000001/stream",
      "/api/coverage/evidence/00000000-0000-4000-8000-000000000001/preview",
      "/api/avatars/00000000-0000-4000-8000-000000000001",
    ]) {
      const headers = await effectiveHeaders(path)
      expect(headers.get("Referrer-Policy"), path).toBe("no-referrer")
      // Every other security header is unchanged.
      headers.delete("Referrer-Policy")
      const others = new Map(page)
      others.delete("Referrer-Policy")
      expect(headers, path).toEqual(others)
    }
  })

  it("leaves pages and other API routes on strict-origin-when-cross-origin", async () => {
    for (const path of [
      "/staff",
      "/staff/tasks",
      "/admin/coverage",
      "/api/internal/coverage/monthly-preparation",
    ]) {
      expect((await effectiveHeaders(path)).get("Referrer-Policy"), path).toBe(
        "strict-origin-when-cross-origin"
      )
    }
  })

  it("caches /guide/v1 examples as immutable, and nothing else", async () => {
    const guide = await effectiveHeaders("/guide/v1/mixed-grill-45.webp")
    expect(guide.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable"
    )
    // Every security header still applies.
    const page = await effectiveHeaders("/staff")
    guide.delete("Cache-Control")
    expect(guide).toEqual(page)
    for (const path of [
      "/staff/tasks/guide",
      "/guide/v2/mixed-grill-45.webp",
      "/api/media/00000000-0000-4000-8000-000000000001/thumb",
    ]) {
      expect((await effectiveHeaders(path)).has("Cache-Control"), path).toBe(
        false
      )
    }
  })
})
