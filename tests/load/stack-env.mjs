// Connection details of the isolated load stack, read from `supabase status`.
// Never prints keys. Refuses anything but a local host.
import { execFileSync, spawn } from "node:child_process"

function status(workdir) {
  // `supabase status` occasionally fails while Docker is saturated; the stack
  // itself is fine. Setup only: measured requests are never retried.
  for (let attempt = 1; ; attempt++) {
    try {
      return execFileSync(
        "supabase",
        ["--workdir", workdir, "status", "-o", "json"],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }
      )
    } catch (e) {
      if (attempt >= 4) throw e
      execFileSync("sleep", ["2"])
    }
  }
}

export function stackEnv(workdir) {
  const raw = status(workdir)
  const s = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1))
  const env = {
    url: s.API_URL,
    publishableKey: s.PUBLISHABLE_KEY ?? s.ANON_KEY,
    serviceRoleKey: s.SERVICE_ROLE_KEY ?? s.SECRET_KEY,
  }
  const host = new URL(env.url).hostname
  if (host !== "127.0.0.1" && host !== "localhost")
    throw new Error(`Refusing non-local Supabase host ${host}`)
  return env
}

export function appEnv(env, extra = {}) {
  return {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: env.url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: env.publishableKey,
    SUPABASE_SERVICE_ROLE_KEY: env.serviceRoleKey,
    NEXT_TELEMETRY_DISABLED: "1",
    ...extra,
  }
}

// CLI: node tests/load/stack-env.mjs <workdir> <command...>
// Runs the command (e.g. `pnpm build`) with the stack's env.
if (import.meta.url === `file://${process.argv[1]}`) {
  const [workdir, cmd, ...args] = process.argv.slice(2)
  const child = spawn(cmd, args, {
    stdio: "inherit",
    env: appEnv(stackEnv(workdir), {
      NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3615",
    }),
  })
  child.on("exit", (code) => process.exit(code ?? 1))
}
