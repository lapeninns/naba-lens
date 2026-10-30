/**
 * A one-line summary of a caught error that is safe for server logs: URLs
 * (signed storage links carry tokens), emails, JWTs and any long opaque string
 * (keys, token hashes, IDs) are replaced, and the result is capped. Keeps the
 * error's name and the shape of its message, for example
 * `Error: Could not load profile: PGRST205`.
 */
export function redactError(error: unknown): string {
  const raw =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : `non-error: ${typeof error}`
  return raw
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[url]")
    .replace(/[^\s@/]+@[^\s@/]+/g, "[email]")
    .replace(/\beyJ[\w-]*\.[\w-]*\.?[\w-]*/g, "[token]")
    .replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]")
    .slice(0, 300)
}
