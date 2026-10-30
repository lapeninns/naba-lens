import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

import type { AccountsContext } from "./context"

/** Context for the current request: the signed-in user's client plus the service client. */
export async function accountsContext(): Promise<AccountsContext> {
  return { caller: await createClient(), service: createAdminClient() }
}
