import { isIP } from "node:net"

/** @param {string} host */
export function isPrivateIPv4(host) {
  if (isIP(host) !== 4) return false
  const [first, second] = host.split(".").map(Number)
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  )
}

/** @param {string | undefined} mode @param {string | undefined} supabaseUrl */
export function canUseFixtureSignIn(mode, supabaseUrl) {
  if (mode !== "development" || !supabaseUrl) return false
  try {
    const url = new URL(supabaseUrl)
    const host = url.hostname
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password &&
      (host === "localhost" ||
        host === "[::1]" ||
        (isIP(host) === 4 && host.startsWith("127.")) ||
        isPrivateIPv4(host) ||
        (isIP(host.slice(1, -1)) === 6 && /^\[f[cd]/.test(host)))
    )
  } catch {
    return false
  }
}
