// @vitest-environment jsdom
// B03 UI design §7.3, §7.4: sources, mapping reviews, dry runs and apply.
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh }),
}))

import {
  ApplyRunControl,
  DeclareSourceForm,
  MappingReviewControl,
  StartDryRunForm,
} from "@/components/nabalens/knowledge/reconcile-controls"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  window.sessionStorage.clear()
})

const VENUE = { id: "9b000000-0000-4000-8000-000000000201", name: "⟨Venue A⟩" }
const counts = {
  candidates: 5,
  proposals: 3,
  corroborating: 1,
  conflicting: 1,
  alreadyApplied: 0,
  skipped: 0,
}

describe("Declare a source", () => {
  it("needs a kind and a label, and sends them keyed", async () => {
    const user = userEvent.setup()
    const onDeclare = vi.fn(async () => ({
      ok: true as const,
      sourceId: "s1",
      replayed: false,
    }))
    render(<DeclareSourceForm venues={[VENUE]} onDeclare={onDeclare} />)
    expect(
      screen.getByText("Declare only sources the owner has agreed to use.")
    ).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Declare source" }))
    expect(onDeclare).not.toHaveBeenCalled()
    expect(screen.getByText("Choose what kind of source this is.")).toBeTruthy()
    await user.selectOptions(screen.getByLabelText("Kind"), "Venue website")
    await user.type(screen.getByLabelText("Label"), "⟨Source label⟩")
    await user.selectOptions(
      screen.getByLabelText("Venue (optional)"),
      "⟨Venue A⟩"
    )
    await user.click(screen.getByRole("button", { name: "Declare source" }))
    expect(onDeclare).toHaveBeenCalledWith({
      kind: "venue_website",
      label: "⟨Source label⟩",
      venueId: VENUE.id,
      idempotencyKey: expect.any(String),
    })
    expect(await screen.findByText("Source declared.")).toBeTruthy()
  })
})

describe("Review a mapping", () => {
  it("defaults to nothing, needs a question and a kind, and says what Exact means", async () => {
    const user = userEvent.setup()
    const onReview = vi.fn(async () => ({
      ok: true as const,
      mappingId: "m1",
      replayed: false,
    }))
    render(
      <MappingReviewControl
        legacyFactId="7f000000-0000-4000-8000-000000000001"
        legacyRevision={2}
        legacyKey="parking"
        questions={[{ key: "onsite_parking", label: "⟨Parking question⟩" }]}
        onReview={onReview}
      />
    )
    await user.click(screen.getByRole("button", { name: "Review" }))
    const dialog = await screen.findByRole("dialog", { name: "Review parking" })
    for (const name of ["Exact", "Candidate", "None"])
      expect(
        (within(dialog).getByRole("radio", { name }) as HTMLInputElement)
          .checked
      ).toBe(false)
    expect(
      within(dialog).getByText(
        "Exact means the old fact means the same as the question. Broad facts never establish a narrower question."
      )
    ).toBeTruthy()
    await user.type(within(dialog).getByLabelText(/Reason/), "⟨Reason⟩")
    await user.click(
      within(dialog).getByRole("button", { name: "Save review" })
    )
    expect(onReview).not.toHaveBeenCalled()
    await user.selectOptions(
      within(dialog).getByLabelText("Question"),
      "⟨Parking question⟩"
    )
    await user.click(within(dialog).getByRole("radio", { name: "Candidate" }))
    await user.click(
      within(dialog).getByRole("button", { name: "Save review" })
    )
    await waitFor(() =>
      expect(onReview).toHaveBeenCalledWith({
        legacyFactId: "7f000000-0000-4000-8000-000000000001",
        legacyRevision: 2,
        questionKey: "onsite_parking",
        kind: "candidate",
        reason: "⟨Reason⟩",
        idempotencyKey: expect.any(String),
      })
    )
  })
})

describe("Runs", () => {
  it("starts a dry run and opens its page", async () => {
    const user = userEvent.setup()
    const onReconcile = vi.fn(async () => ({
      ok: true as const,
      result: {
        runId: "r1",
        mode: "dry_run" as const,
        counts,
        conflicts: [],
        sourceRevisions: {},
      },
    }))
    render(
      <StartDryRunForm
        venues={[VENUE]}
        onReconcile={onReconcile}
        runHref={(id) => `/admin/knowledge/runs/${id}`}
      />
    )
    await user.click(screen.getByRole("radio", { name: "Other sources" }))
    await user.click(screen.getByRole("button", { name: "Start dry run" }))
    expect(onReconcile).toHaveBeenCalledWith({
      kind: "external",
      mode: "dry_run",
      venueId: null,
    })
    await waitFor(() =>
      expect(nav.push).toHaveBeenCalledWith("/admin/knowledge/runs/r1")
    )
  })

  it("asks before importing, then says what was imported", async () => {
    const user = userEvent.setup()
    const onReconcile = vi.fn(async () => ({
      ok: true as const,
      result: {
        runId: "r2",
        mode: "apply" as const,
        counts: { ...counts, alreadyApplied: 1 },
        created: 2,
        conflicts: [],
        sourceRevisions: {},
      },
    }))
    render(
      <ApplyRunControl
        count={3}
        kind="legacy"
        venueId={null}
        onReconcile={onReconcile}
        runsHref="/admin/knowledge/runs"
      />
    )
    await user.click(
      screen.getByRole("button", { name: "Import 3 for managers to decide" })
    )
    const dialog = await screen.findByRole("dialog", { name: "Import 3?" })
    expect(
      within(dialog).getByText(
        "Managers decide each one. Nothing becomes an answer by itself, and nothing replaces an answer in use."
      )
    ).toBeTruthy()
    await user.click(within(dialog).getByRole("button", { name: "Import" }))
    expect(onReconcile).toHaveBeenCalledWith({
      kind: "legacy",
      mode: "apply",
      venueId: null,
    })
    expect(
      await screen.findByText("Imported 2. 1 was already there.")
    ).toBeTruthy()
  })

  it("says to check the runs list when the reply to an import is lost", async () => {
    const user = userEvent.setup()
    render(
      <ApplyRunControl
        count={3}
        kind="legacy"
        venueId={null}
        onReconcile={vi.fn().mockRejectedValue(new Error("network"))}
        runsHref="/admin/knowledge/runs"
      />
    )
    await user.click(
      screen.getByRole("button", { name: "Import 3 for managers to decide" })
    )
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Import",
      })
    )
    expect(
      await screen.findByText(
        "We couldn't confirm the run started. Check the runs list before starting again; nothing is imported twice."
      )
    ).toBeTruthy()
  })
})
