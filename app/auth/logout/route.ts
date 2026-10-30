import { seeOther } from "@/app/auth/redirect"
import { createClient } from "@/lib/supabase/server"

/** POST-only sign-out for this browser session; see app/auth/sign-out-button.tsx. */
export async function POST() {
  const supabase = await createClient()
  await supabase.auth.signOut({ scope: "local" })
  return seeOther("/login?signed_out=1")
}
