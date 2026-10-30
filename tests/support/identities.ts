import { randomUUID } from "node:crypto"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../../lib/db/types"
import { getLocalSupabaseEnv } from "./local-supabase"

export type Db = SupabaseClient<Database>

export function serviceClient(): Db {
  const env = getLocalSupabaseEnv()
  return createClient<Database>(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function anonClient(): Db {
  const env = getLocalSupabaseEnv()
  return createClient<Database>(env.url, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Unique per run so tests never collide with seed data or each other. */
export function testEmail(label: string): string {
  return `it-${label}-${randomUUID().slice(0, 8)}@nabalens.test`
}

export async function createVenue(admin: Db, label: string, active = true) {
  const suffix = randomUUID().slice(0, 8)
  const { data, error } = await admin
    .from("venues")
    .insert({
      name: `TEST Venue ${label} ${suffix}`,
      slug: `test-${label}-${suffix}`,
      active,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export type TestIdentity = {
  id: string
  email: string
  /** Signed in as this user through the real magic-link token path (anonymous when `session: false`). */
  client: Db
}

/**
 * Creates an invited-style account (auth user + profile) with the service role,
 * then signs in as that user with a magic-link token hash: a separate identity
 * whose requests go through RLS exactly like the app's.
 */
export async function createIdentity(
  admin: Db,
  opts: {
    label: string
    role: "staff" | "admin"
    venueId?: string | null
    active?: boolean
    profile?: boolean
    /** Sign in now (default). E2E tests sign in through the UI instead. */
    session?: boolean
  }
): Promise<TestIdentity> {
  const email = testEmail(opts.label)
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    })
  if (createError) throw createError
  const id = created.user.id

  if (opts.profile !== false) {
    const { error } = await admin.from("profiles").insert({
      id,
      display_name: `TEST ${opts.label}`,
      role: opts.role,
      venue_id: opts.venueId ?? null,
      active: true,
    })
    if (error) throw error
  }

  const client =
    opts.session === false ? anonClient() : await signIn(admin, email)

  if (opts.active === false) {
    const { error } = await admin
      .from("profiles")
      .update({ active: false })
      .eq("id", id)
    if (error) throw error
  }

  return { id, email, client }
}

export async function signIn(admin: Db, email: string): Promise<Db> {
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  })
  if (linkError) throw linkError

  const client = anonClient()
  const { error } = await client.auth.verifyOtp({
    type: "email",
    token_hash: link.properties.hashed_token,
  })
  if (error) throw error
  return client
}

/** Simulates the server processing path marking an asset ready (service role). */
export async function markReady(
  admin: Db,
  assetId: string,
  mime = "image/jpeg"
) {
  const { error: processingError } = await admin
    .from("media_assets")
    .update({ upload_state: "processing" })
    .eq("id", assetId)
  if (processingError) throw processingError
  const { error } = await admin
    .from("media_assets")
    .update({
      upload_state: "ready",
      validated_mime_type: mime,
      size_bytes: 4,
      width: 1,
      height: 1,
    })
    .eq("id", assetId)
  if (error) throw error
}

export const TINY_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
