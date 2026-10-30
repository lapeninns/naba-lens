import { randomUUID } from "node:crypto"

import { MEDIA_LIMITS } from "@/lib/config/media"
import { avatarObjectKey, STORAGE_BUCKETS } from "@/lib/config/storage"

import {
  fail,
  FORBIDDEN_MESSAGE,
  resolveCaller,
  type AccountResult,
  type AccountsContext,
} from "./context"
import { dbFailed, notFound } from "./invite"
import { isUuid } from "./validation"

/** Turns uploaded bytes into the avatar WebP; lib/media's createAvatarDerivative. */
export type AvatarDeriver = (bytes: Uint8Array) => Promise<Uint8Array>

/**
 * Replaces a profile photo. Allowed for the person themself or for an active
 * admin editing a staff account. The bytes are re-encoded server-side (never
 * stored as sent), written with the service role to a fresh key, then linked
 * through the caller's own client so RLS and the profile guard apply. The old
 * object is removed afterwards; a failed link removes the new one again.
 */
export async function replaceProfileAvatar(
  ctx: AccountsContext,
  profileId: unknown,
  bytes: Uint8Array,
  derive: AvatarDeriver
): Promise<AccountResult<{ avatarPath: string }>> {
  const who = await resolveCaller(ctx.caller)
  if (!who.ok) {
    return fail(
      who.code,
      who.code === "unauthenticated"
        ? "Your session has ended. Sign in again."
        : FORBIDDEN_MESSAGE
    )
  }
  if (!isUuid(profileId)) return notFound()

  const { data: target, error } = await ctx.caller
    .from("profiles")
    .select("id, role, avatar_path")
    .eq("id", profileId)
    .maybeSingle()
  if (error) return dbFailed()
  if (!target) return notFound()
  const isSelf = target.id === who.profile.id
  const isAdminOfStaff = who.profile.role === "admin" && target.role === "staff"
  if (!isSelf && !isAdminOfStaff) return fail("forbidden", FORBIDDEN_MESSAGE)

  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > MEDIA_LIMITS.maxAvatarBytes
  ) {
    return fail("invalid_input", "Choose a photo up to 5 MB.", {
      avatar: "Profile photos can be up to 5 MB.",
    })
  }

  let webp: Uint8Array
  try {
    webp = await derive(bytes)
  } catch {
    return fail("invalid_input", "That photo could not be used.", {
      avatar: "Use a JPEG, PNG, WebP or HEIC photo.",
    })
  }

  const key = avatarObjectKey(target.id, randomUUID())
  const bucket = ctx.service.storage.from(STORAGE_BUCKETS.avatars)
  const { error: uploadError } = await bucket.upload(key, webp, {
    contentType: "image/webp",
    upsert: false,
  })
  if (uploadError) {
    console.error("[accounts] avatar upload failed", {
      name: uploadError.name,
    })
    return fail("database_failed", "The photo could not be saved. Try again.")
  }

  const { data: updated, error: linkError } = await ctx.caller
    .from("profiles")
    .update({ avatar_path: key })
    .eq("id", target.id)
    .select("id")
  if (linkError || !updated?.length) {
    await bucket.remove([key])
    return linkError ? dbFailed() : fail("forbidden", FORBIDDEN_MESSAGE)
  }

  if (target.avatar_path && target.avatar_path !== key) {
    const { error: removeError } = await bucket.remove([target.avatar_path])
    if (removeError) {
      console.error("[accounts] old avatar removal failed", {
        name: removeError.name,
      })
    }
  }
  return { ok: true, avatarPath: key }
}
