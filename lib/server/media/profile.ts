import { randomUUID } from "node:crypto"

import { MEDIA_LIMITS } from "@/lib/config/media"
import { avatarObjectKey, STORAGE_BUCKETS } from "@/lib/config/storage"
import { createAvatarDerivative, MediaError } from "@/lib/media"

import { signedUrlTtlSeconds } from "./access"
import { validationMessage } from "./errors"
import type { Db, MediaActor, Outcome } from "./types"

export type ProfileUpdate = {
  displayName: string
  /** New profile photo bytes, or null to keep the current one. */
  avatar: Uint8Array | null
}

type FieldErrors = Partial<Record<"displayName" | "avatar", string>>

export type ProfileUpdateOutcome =
  | { ok: true }
  | { ok: false; status: number; error: string; fieldErrors?: FieldErrors }

/**
 * Validates an avatar with lib/media and stores the 256 px WebP derivative at
 * `avatars/{userId}/{uuid}.webp` with the service role (end users cannot write
 * that bucket). Returns the new key. The caller must already have authorised
 * the change to `userId`'s profile.
 */
export async function storeAvatar(
  service: Db,
  userId: string,
  bytes: Uint8Array
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  if (bytes.byteLength === 0) return { ok: false, error: "This file is empty." }
  if (bytes.byteLength > MEDIA_LIMITS.maxAvatarBytes) {
    return {
      ok: false,
      error: `Profile photos can be up to ${Math.round(MEDIA_LIMITS.maxAvatarBytes / (1024 * 1024))} MB.`,
    }
  }
  let webp: Uint8Array
  try {
    webp = await createAvatarDerivative(bytes)
  } catch (e) {
    const code = e instanceof MediaError ? e.code : "corrupt_media"
    return {
      ok: false,
      error:
        code === "decoder_busy"
          ? "The server is busy processing photos. Try again."
          : code === "unsupported_type"
            ? "Use a JPEG, PNG, WebP or HEIC photo."
            : validationMessage(code),
    }
  }
  const path = avatarObjectKey(userId, randomUUID())
  const { error } = await service.storage
    .from(STORAGE_BUCKETS.avatars)
    .upload(path, webp, {
      contentType: "image/webp",
      cacheControl: String(MEDIA_LIMITS.signedUrlExpirySeconds),
      upsert: false,
    })
  if (error) return { ok: false, error: "Could not save the photo. Try again." }
  return { ok: true, path }
}

/**
 * Staff edit their own display name and photo (spec §2). The row update runs as
 * the caller, so RLS and the column grants decide what may change; role, venue,
 * job title and activation are not touched here.
 */
export async function updateOwnProfile(
  actor: MediaActor,
  input: ProfileUpdate
): Promise<ProfileUpdateOutcome> {
  const displayName = String(input.displayName ?? "").trim()
  if (displayName.length < 1 || displayName.length > 80) {
    return {
      ok: false,
      status: 400,
      error: "Check the highlighted field.",
      fieldErrors: { displayName: "Enter a name of up to 80 characters." },
    }
  }

  let avatarPath: string | undefined
  if (input.avatar) {
    const stored = await storeAvatar(
      actor.service,
      actor.profile.id,
      input.avatar
    )
    if (!stored.ok) {
      return {
        ok: false,
        status: 400,
        error: stored.error,
        fieldErrors: { avatar: stored.error },
      }
    }
    avatarPath = stored.path
  }

  const { data, error } = await actor.db
    .from("profiles")
    .update({
      display_name: displayName,
      ...(avatarPath ? { avatar_path: avatarPath } : {}),
    })
    .eq("id", actor.profile.id)
    .select("id")
  if (error || !data?.length) {
    if (avatarPath) {
      await actor.service.storage
        .from(STORAGE_BUCKETS.avatars)
        .remove([avatarPath])
        .catch(() => {})
    }
    return { ok: false, status: 403, error: "Could not save your profile." }
  }

  // The replaced photo is no longer referenced; removing it is best effort.
  const previous = actor.profile.avatarPath
  if (avatarPath && previous && previous !== avatarPath) {
    await actor.service.storage
      .from(STORAGE_BUCKETS.avatars)
      .remove([previous])
      .catch(() => {})
  }
  return { ok: true }
}

/** Signed 60 s profile photo URL: own, an active colleague, or any as admin. */
export async function signAvatar(
  actor: MediaActor,
  userId: string
): Promise<Outcome<{ url: string }>> {
  const notFound = { ok: false, status: 404, message: "Not found." } as const
  if (
    !actor.profile.active ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      userId
    )
  )
    return notFound
  let avatarPath: string | null = null
  if (actor.profile.role === "admin" || userId === actor.profile.id) {
    const { data } = await actor.db
      .from("profiles")
      .select("avatar_path")
      .eq("id", userId)
      .maybeSingle()
    avatarPath = data?.avatar_path ?? null
  } else {
    // Raw profiles remain own/admin-only. The RPC exposes only an active
    // colleague's safe organization fields and rechecks the current viewer.
    const { data, error } = await actor.db.rpc("community_members", {
      p_member: userId,
      p_limit: 1,
    })
    if (error) return { ok: false, status: 503, message: "Try again." }
    avatarPath = data?.[0]?.avatar_path ?? null
  }
  if (!avatarPath) return notFound
  // Only sign after the caller-scoped profile/RPC authorization above. No end
  // user can mint storage URLs directly or increase their lifetime.
  const signed = await actor.service.storage
    .from(STORAGE_BUCKETS.avatars)
    .createSignedUrl(avatarPath, signedUrlTtlSeconds())
  if (signed.error || !signed.data) return notFound
  return { ok: true, url: signed.data.signedUrl }
}
