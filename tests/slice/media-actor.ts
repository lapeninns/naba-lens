import { randomUUID } from "node:crypto"

import sharp from "sharp"

import { loadProfile } from "../../lib/auth/profile"
import type { MediaActor } from "../../lib/server/media/types"
import { serviceClient, type TestIdentity } from "../support/identities"
import { getLocalSupabaseEnv } from "../support/local-supabase"

/**
 * The same MediaActor the app builds per request (lib/server/media/context.ts),
 * from a real signed-in identity: its own RLS-scoped client, a fresh profile
 * read, and the service role for the post-check processing steps.
 */
export async function actorFor(identity: TestIdentity): Promise<MediaActor> {
  const profile = await loadProfile(
    identity.client,
    identity.id,
    identity.email
  )
  if (!profile) throw new Error(`No profile for ${identity.email}`)
  const env = getLocalSupabaseEnv()
  return {
    profile,
    db: identity.client,
    service: serviceClient(),
    storage: { url: env.url, serviceKey: env.serviceRoleKey },
  }
}

/** A synthetic JPEG with a unique colour, so every upload has distinct bytes. */
export async function syntheticJpeg(width = 640, height = 480) {
  const seed = randomUUID()
  const colour = Number.parseInt(seed.slice(0, 6), 16)
  return new Uint8Array(
    await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: {
          r: (colour >> 16) & 255,
          g: (colour >> 8) & 255,
          b: colour & 255,
        },
      },
    })
      .jpeg({ quality: 85 })
      .toBuffer()
  )
}

export const newKey = () => randomUUID()
