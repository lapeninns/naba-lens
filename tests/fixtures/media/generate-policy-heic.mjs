// Synthetic pixels only. Run from the repository root; requires macOS sips.
// A real narrow HEIC keeps MIME/FIFO checks independent of 12MP decode speed.
// Full-size processing and memory coverage keep their existing 12MP/39MP files.
import sharp from "sharp"
import { execFileSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"

const temporary = await mkdtemp(tmpdir() + "/nabalens-policy-heic-")
try {
  const source = temporary + "/policy.png"
  await sharp({
    create: { width: 4000, height: 64, channels: 3, background: "blue" },
  })
    .png()
    .toFile(source)
  execFileSync("sips", [
    "-s",
    "format",
    "heic",
    source,
    "--out",
    "tests/fixtures/media/synthetic-policy.heic",
  ])
} finally {
  await rm(temporary, { recursive: true, force: true })
}
