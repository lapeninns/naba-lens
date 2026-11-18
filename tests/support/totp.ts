import { createHmac } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * RFC 6238 TOTP (SHA-1, 6 digits, 30 s), as authenticator apps compute it
 * from the base32 secret Supabase Auth hands out at enrolment. Test use only:
 * admins must pass a second factor (FA-23).
 */
export function totpCode(secret: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  let bits = ""
  for (const char of secret.replace(/=+$/, "").toUpperCase()) {
    const value = alphabet.indexOf(char)
    if (value < 0) throw new Error("Invalid base32 secret")
    bits += value.toString(2).padStart(5, "0")
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8))
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2)
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)))
  const hmac = createHmac("sha1", Buffer.from(bytes)).update(counter).digest()
  const offset = hmac[hmac.length - 1]! & 0x0f
  const code =
    (((hmac[offset]! & 0x7f) << 24) |
      (hmac[offset + 1]! << 16) |
      (hmac[offset + 2]! << 8) |
      hmac[offset + 3]!) %
    1_000_000
  return code.toString().padStart(6, "0")
}

/** Factor per test account, so a second sign-in reuses it. */
const factors = new Map<string, { factorId: string; secret: string }>()

/** The enrolled factor's secret for an account this process enrolled. */
export function knownTotpSecret(userId: string): string | null {
  return factors.get(userId)?.secret ?? null
}

/** Remembers a factor enrolled elsewhere (an e2e browser). */
export function rememberTotpFactor(
  userId: string,
  factor: { factorId: string; secret: string }
) {
  factors.set(userId, factor)
}

/**
 * Raises a signed-in client's session to aal2: enrols a TOTP factor the first
 * time for this account, then verifies a fresh code.
 */
export async function elevateToAal2(client: SupabaseClient): Promise<void> {
  const { data: who, error: userError } = await client.auth.getUser()
  if (userError || !who.user) throw userError ?? new Error("Not signed in")
  let factor = factors.get(who.user.id)
  if (!factor) {
    const { data, error } = await client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `test-${Math.random().toString(36).slice(2, 10)}`,
    })
    if (error) throw error
    factor = { factorId: data.id, secret: data.totp.secret }
    factors.set(who.user.id, factor)
  }
  const verify = () =>
    client.auth.mfa.challengeAndVerify({
      factorId: factor.factorId,
      code: totpCode(factor.secret),
    })
  let { error } = await verify()
  // A loaded local stack can answer one verify with a 5xx
  // (AuthRetryableFetchError); S6-CI saw it fail a whole file's setup. Retry
  // that once, with a new challenge. A wrong code (4xx) is never retried.
  if (error && isRetryable(error)) {
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    ;({ error } = await verify())
  }
  if (error) throw error
}

function isRetryable(error: { name?: string; status?: number }): boolean {
  return (
    error.name === "AuthRetryableFetchError" ||
    (typeof error.status === "number" &&
      (error.status === 0 || error.status >= 500))
  )
}
