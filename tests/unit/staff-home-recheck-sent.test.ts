// B03 UI design §6.2: Home's sent notice says a recheck stays open only when
// the person's own read of that check's rechecks shows one still open, and
// only for a finding that awaits confirmation. A failed read claims nothing.
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
const services = vi.hoisted(() => ({ getCheckRechecks: vi.fn() }))
vi.mock("@/lib/knowledge-client/services", () => ({
  knowledgeServices: services,
}))

import { withRecheckSent } from "@/app/staff/tasks/sent-recheck"
import type { FindingSentCopy } from "@/components/nabalens/amenities/capture/finding-sent-notice"
import { RECHECK_COPY } from "@/components/nabalens/knowledge/copy"
import type { FindingSummary } from "@/lib/knowledge-client/contract"
import type { MediaActor } from "@/lib/server/media/types"

const actor = { db: {} } as MediaActor
const COPY: FindingSentCopy = {
  title: "Finding sent",
  body: "It agrees with the recorded answer; your manager confirms it.",
  extra: "TEST recognition line",
  tone: "positive",
}
const slot = (state: FindingSummary["state"]) => ({
  checkId: "c1",
  myLatest: { state } as FindingSummary,
})

beforeEach(() => services.getCheckRechecks.mockReset())

describe("Home's sent notice and an open recheck", () => {
  it("adds Recheck sent when the check's recheck is still open", async () => {
    services.getCheckRechecks.mockResolvedValue({
      ok: true,
      count: 1,
      tasks: [],
    })
    expect(
      await withRecheckSent(actor, slot("awaiting_confirmation"), COPY)
    ).toEqual({ ...COPY, recheck: RECHECK_COPY.sentOpen })
    expect(services.getCheckRechecks).toHaveBeenCalledWith(actor, {
      checkId: "c1",
    })
  })

  it("adds nothing once no recheck is open", async () => {
    services.getCheckRechecks.mockResolvedValue({
      ok: true,
      count: 0,
      tasks: [],
    })
    expect(
      await withRecheckSent(actor, slot("awaiting_confirmation"), COPY)
    ).toBe(COPY)
  })

  it("claims nothing when the read is refused or fails", async () => {
    services.getCheckRechecks.mockResolvedValueOnce({
      ok: false,
      code: "unavailable",
      message: "no",
    })
    expect(
      await withRecheckSent(actor, slot("awaiting_confirmation"), COPY)
    ).toBe(COPY)
    services.getCheckRechecks.mockRejectedValueOnce(new Error("offline"))
    expect(
      await withRecheckSent(actor, slot("awaiting_confirmation"), COPY)
    ).toBe(COPY)
  })

  it("doesn't read rechecks for a finding that doesn't await confirmation", async () => {
    for (const state of ["current", "submitted"] as const)
      expect(await withRecheckSent(actor, slot(state), COPY)).toBe(COPY)
    expect(
      await withRecheckSent(actor, { checkId: "c1", myLatest: null }, COPY)
    ).toBe(COPY)
    expect(services.getCheckRechecks).not.toHaveBeenCalled()
  })
})
