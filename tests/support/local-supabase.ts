import { execFileSync } from "node:child_process"

export type LocalSupabaseEnv = {
  url: string
  publishableKey: string
  serviceRoleKey: string
  mailpitUrl: string | null
}

let cached: LocalSupabaseEnv | null = null

/**
 * Connection details for the LOCAL Supabase stack. Uses explicit env vars when set
 * (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
 * SUPABASE_SERVICE_ROLE_KEY), otherwise asks `supabase status`. Refuses to run
 * against anything but localhost so tests can never touch a hosted project.
 */
export function getLocalSupabaseEnv(): LocalSupabaseEnv {
  if (cached) return cached

  let env: LocalSupabaseEnv
  if (
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    env = {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      mailpitUrl: process.env.MAILPIT_URL ?? null,
    }
  } else {
    let raw: string
    try {
      raw = execFileSync("supabase", ["status", "-o", "json"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
    } catch {
      throw new Error(
        "Local Supabase is not running. Start it with `supabase start` (Docker required)."
      )
    }
    const status = JSON.parse(
      raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)
    )
    env = {
      url: status.API_URL,
      publishableKey: status.PUBLISHABLE_KEY ?? status.ANON_KEY,
      serviceRoleKey: status.SERVICE_ROLE_KEY ?? status.SECRET_KEY,
      mailpitUrl: status.MAILPIT_URL ?? status.INBUCKET_URL ?? null,
    }
  }

  const host = new URL(env.url).hostname
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(
      `Refusing to run tests against non-local Supabase host ${host}.`
    )
  }
  cached = env
  return env
}
