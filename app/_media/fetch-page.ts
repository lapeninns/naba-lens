import type { MediaPage } from "@/lib/server/media/types"

export type PageResult =
  { ok: true; page: MediaPage } | { ok: false; message: string }

/**
 * GET a gallery page from /api/portfolio or /api/library. `signal` really
 * cancels it (unlike a Server Function call), so an abandoned refresh never
 * holds up later actions. Rejects on abort or a network failure.
 */
export async function fetchMediaPage(
  path: "/api/portfolio" | "/api/library",
  params: Record<string, string | null | undefined>,
  signal?: AbortSignal
): Promise<PageResult> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value)
  }
  const qs = query.toString()
  const response = await fetch(qs ? `${path}?${qs}` : path, {
    signal,
    cache: "no-store",
    headers: { accept: "application/json" },
  })
  const body = (await response.json().catch(() => null)) as PageResult | null
  if (response.ok && body?.ok) return { ok: true, page: body.page }
  return {
    ok: false,
    message:
      body && !body.ok && body.message
        ? body.message
        : "Could not refresh. Check your connection.",
  }
}
