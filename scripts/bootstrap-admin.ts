/**
 * Promote an EXISTING auth user to an active NabaLens admin.
 *
 *   pnpm bootstrap:admin --email owner@example.com [--name "Display Name"]
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY
 * in the environment (export them, or run
 * `pnpm exec tsx --env-file=.env.local scripts/bootstrap-admin.ts --email ...`).
 * It never creates auth users and never promotes "the first sign-up": the account
 * must already exist (created by an operator in the Supabase dashboard, e.g.
 * Authentication > Users > Invite user). See README "First admin".
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { pathToFileURL } from "node:url"

import type { Database } from "../lib/db/types"
import { createServiceClientFromEnv, parseArgs } from "./lib/service-client"

export type BootstrapResult = {
  userId: string
  action: "created_profile" | "promoted" | "already_admin"
}

export async function findAuthUserIdByEmail(
  admin: SupabaseClient<Database>,
  email: string
): Promise<string | null> {
  const target = email.trim().toLowerCase()
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    })
    if (error) throw new Error(`Could not list users: ${error.message}`)
    const match = data.users.find((u) => u.email?.toLowerCase() === target)
    if (match) return match.id
    if (data.users.length < 1000) return null
  }
}

export async function bootstrapAdmin(
  admin: SupabaseClient<Database>,
  input: { email: string; displayName?: string }
): Promise<BootstrapResult> {
  const userId = await findAuthUserIdByEmail(admin, input.email)
  if (!userId) {
    throw new Error(
      "No auth user with that email. Create/invite the user first; this script never creates accounts."
    )
  }

  const { data: existing, error: readError } = await admin
    .from("profiles")
    .select("id, role, active")
    .eq("id", userId)
    .maybeSingle()
  if (readError) throw new Error(`Could not read profile: ${readError.message}`)

  if (!existing) {
    const displayName = input.displayName?.trim()
    if (!displayName) {
      throw new Error(
        'This user has no profile yet: pass --name "Display Name".'
      )
    }
    const { error } = await admin.from("profiles").insert({
      id: userId,
      display_name: displayName,
      role: "admin",
      active: true,
    })
    if (error)
      throw new Error(`Could not create admin profile: ${error.message}`)
    return { userId, action: "created_profile" }
  }

  if (existing.role === "admin" && existing.active) {
    return { userId, action: "already_admin" }
  }

  const { error } = await admin
    .from("profiles")
    .update({ role: "admin", active: true })
    .eq("id", userId)
  if (error) throw new Error(`Could not promote profile: ${error.message}`)
  return { userId, action: "promoted" }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (typeof args.email !== "string") {
    console.error(
      'Usage: pnpm bootstrap:admin --email <email> [--name "Display Name"]'
    )
    process.exit(2)
  }
  const result = await bootstrapAdmin(createServiceClientFromEnv(), {
    email: args.email,
    displayName: typeof args.name === "string" ? args.name : undefined,
  })
  console.log(`bootstrap-admin: ${result.action} (user ${result.userId})`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(
      `bootstrap-admin: ${error instanceof Error ? error.message : String(error)}`
    )
    process.exit(1)
  })
}
