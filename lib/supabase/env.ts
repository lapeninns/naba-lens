/**
 * Supabase environment. Only the URL and publishable (anon) key are public; the
 * service-role key is read in lib/supabase/admin.ts, which is server-only.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing environment variable ${name}. See .env.example.`)
  }
  return value
}

export function getSupabasePublicEnv() {
  // Literal property access so Next.js can inline NEXT_PUBLIC_* in the browser.
  return {
    url: required(
      "NEXT_PUBLIC_SUPABASE_URL",
      process.env.NEXT_PUBLIC_SUPABASE_URL
    ),
    publishableKey: required(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ),
  }
}

/** Absolute origin used in auth emails, e.g. http://127.0.0.1:3000. */
export function getSiteUrl(): string {
  const url = process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:3000"
  return url.replace(/\/+$/, "")
}
