import { execFileSync } from "node:child_process"

import { serviceClient, type Db } from "../../support/identities"
import { getLocalSupabaseEnv } from "../../support/local-supabase"

/**
 * The isolated journey stack. The service client here may only PROVISION
 * fixtures and inspect storage; every authorisation assertion runs as a real
 * user (or anonymous) in its own browser context.
 */
export function requireIsolatedStack() {
  if (process.env.E2E_ISOLATED_STACK !== "1") {
    throw new Error(
      "The release journey provisions DEV FIXTURE accounts and needs an isolated stack: " +
        "run with E2E_SUPABASE_WORKDIR=<dir from tests/e2e/prepare-stack.mjs>."
    )
  }
}

let service: Db | null = null
export function provisioner(): Db {
  requireIsolatedStack()
  service ??= serviceClient()
  return service
}

export function mailpitUrl(): string {
  const url = getLocalSupabaseEnv().mailpitUrl
  if (!url) throw new Error("Mailpit URL unavailable for this stack.")
  return url
}

/** Runs SQL on the isolated stack's database (time travel for expiry tests). */
export function psql(sql: string): string {
  requireIsolatedStack()
  const url = process.env.E2E_DB_URL
  if (!url) throw new Error("E2E_DB_URL is not set.")
  const host = new URL(url).hostname
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`Refusing to run SQL against ${host}.`)
  }
  return execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-Atc", sql], {
    encoding: "utf8",
  }).trim()
}

/** Object names left under `media/{uploader}/{asset}/` (service client, read-only). */
export async function storedObjects(uploaderId: string, assetId: string) {
  const { data, error } = await provisioner()
    .storage.from("media")
    .list(`${uploaderId}/${assetId}`)
  if (error) throw error
  return (data ?? []).map((o) => o.name).sort()
}
