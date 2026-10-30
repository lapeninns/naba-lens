import { spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

function node(source: string, bootstrap = false) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      ...(bootstrap ? ["--import", "./scripts/lib/server-runtime.mjs"] : []),
      "--input-type=module",
      "--eval",
      source,
    ],
    { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } }
  )
}

describe("explicit Node server context", () => {
  it("preserves the default server-only rejection outside designated entrypoints", () => {
    const result = node('await import("./lib/server/archive/config.ts")')
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(
      "cannot be imported from a Client Component"
    )
  })

  it("loads operational server modules without changing React or retention enforcement", () => {
    const result = node(
      `const {readArchiveConfig} = await import("./lib/server/archive/config.ts");
       const React = await import("react");
       if(typeof React.createContext !== "function") throw new Error("React condition changed");
       if(readArchiveConfig({NEXT_PUBLIC_SUPABASE_URL:"http://127.0.0.1:64121"}) !== null) throw new Error("Local fixtures changed");
       try {
         readArchiveConfig({ NEXT_PUBLIC_SUPABASE_URL:"https://abcdefghijklmnopqrst.supabase.co", VERCEL_ENV:"production", NABALENS_ENVIRONMENT:"production", MEDIA_ARCHIVE_PRODUCTION_PROJECT_REF:"abcdefghijklmnopqrst", MEDIA_ARCHIVE_MODE:"disabled" });
         throw new Error("Retention bypassed");
       } catch(error) {
         if(error.message !== "archive_production_requires_retention") throw error;
       }
       await import("./lib/server/lifecycle/cleanup.ts");
       console.log("server-context-ok");`,
      true
    )
    expect(result.stderr).toBe("")
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe("server-context-ok")
  })
  it("fails a hosted cleanup CLI before contacting its source when archive config is missing", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/cleanup.ts"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_OPTIONS: "",
          VERCEL_ENV: "",
          NABALENS_ENVIRONMENT: "",
          MEDIA_ARCHIVE_MODE: "disabled",
          SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
          NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
          SUPABASE_SERVICE_ROLE_KEY: "fixture-not-real",
        },
      }
    )
    expect(result.status).toBe(2)
    expect(result.stderr.trim()).toBe("archive_environment_not_configured")
    expect(result.stdout).toBe("")
  })
})
