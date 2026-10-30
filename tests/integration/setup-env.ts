// Points the app's env readers at the local stack before any integration test file
// loads app code. Without this, tests that call Route Handlers or Server Functions
// in-process (auth-*, gaps-*) depended on another file having set the env first.
// getLocalSupabaseEnv refuses any non-localhost Supabase URL.
import { getLocalSupabaseEnv } from "../support/local-supabase"

const env = getLocalSupabaseEnv()
process.env.NEXT_PUBLIC_SUPABASE_URL ??= env.url
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= env.publishableKey
process.env.SUPABASE_SERVICE_ROLE_KEY ??= env.serviceRoleKey
