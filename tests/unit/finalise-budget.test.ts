import { describe, expect, it } from "vitest"

import { MEDIA_LIMITS } from "@/lib/config/media"
import {
  BUSY_RETRIES,
  HEIC_FINALISE_WORST_CASE_MS,
} from "@/lib/server/media/finalise"

// Load follow-up: with lib/media's 15 s FIFO wait, 8 busy-retries made the
// worst-case HEIC finalise about 170 s. docs/runtime-sizing.md documents a
// 120 s maxDuration for the staff page's Server Actions; the HEIC step must
// leave at least half of it for storage reads and the database.
describe("finalise HEIC busy-retry budget", () => {
  it("keeps the worst-case HEIC step well under the function timeout", () => {
    expect(BUSY_RETRIES).toBe(1)
    expect(HEIC_FINALISE_WORST_CASE_MS).toBe(
      3 * MEDIA_LIMITS.heicTimeoutMs + 1000
    )
    expect(HEIC_FINALISE_WORST_CASE_MS).toBeLessThanOrEqual(60_000)
  })
})
