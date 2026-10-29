// Runs the disposable-worker processing path, including repeated/failure bounds.
import { execFileSync } from "node:child_process"
execFileSync(
  "pnpm",
  [
    "exec",
    "vitest",
    "run",
    "tests/media/heic-memory.test.ts",
    "--disableConsoleIntercept",
    "--silent=false",
  ],
  { stdio: "inherit" }
)
