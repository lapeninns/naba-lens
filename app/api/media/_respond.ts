import { PRIVATE_HEADERS } from "@/lib/server/media/access"

/** Plain-text error with the private headers every media response carries. */
export function fail(status: number, message: string) {
  return new Response(message, {
    status,
    headers: {
      ...PRIVATE_HEADERS,
      "content-type": "text/plain; charset=utf-8",
    },
  })
}

/**
 * 302 to a freshly signed, 60-second storage URL. The redirect itself is
 * private and uncached, so every load re-runs the authorisation.
 */
export function redirectTo(url: string) {
  return new Response(null, {
    status: 302,
    headers: { ...PRIVATE_HEADERS, location: url },
  })
}
