// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AddHost } from "@/app/staff/_shell/add-host"
import { CommunityGallery } from "@/app/staff/community/community-gallery"
import { loadCommunityPage } from "@/app/staff/community/actions"
import { StaffPortfolio } from "@/app/staff/staff-portfolio"
import { TaskSubmit } from "@/app/staff/tasks/task-submit"
import {
  loadSubmittablePhotosAction,
  submitPhotosAction,
} from "@/app/_coverage/actions"
import { AddTrigger } from "@/components/nabalens/shell/add-context"
import type { MediaItemView } from "@/lib/server/media/types"
import { photo } from "./tasks-fixtures"

const { refresh, supabase } = vi.hoisted(() => ({
  refresh: vi.fn(),
  supabase: {
    auth: {
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  },
}))

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
vi.mock("@/lib/supabase/browser", () => ({ createClient: () => supabase }))
vi.mock("@/app/_media/use-media-uploader", () => ({
  useMediaUploader: () => vi.fn(),
}))
vi.mock("@/app/_media/actions", () => ({
  logout: vi.fn(),
  deleteMedia: vi.fn(),
}))
vi.mock("@/app/_labels/actions", () => ({
  loadLabelEditorContext: vi.fn(),
  loadLabelCatalogue: vi.fn(),
  saveLabelBatch: vi.fn(),
}))
vi.mock("@/app/staff/actions", () => ({ loadMyMedia: vi.fn() }))
vi.mock("@/app/staff/community/actions", () => ({
  loadCommunityPage: vi.fn(),
}))
vi.mock("@/app/_coverage/actions", () => ({
  loadSubmittablePhotosAction: vi.fn(),
  submitPhotosAction: vi.fn(),
}))
vi.mock("@/components/nabalens", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/nabalens")>()
  return {
    ...actual,
    UploadDialog: ({
      open,
      onUploaded,
    }: {
      open: boolean
      onUploaded?: (count: number) => void
    }) =>
      open ? (
        <button onClick={() => onUploaded?.(1)}>Complete upload</button>
      ) : null,
  }
})

const OLD_ID = "0a6f3c2e-6a51-4f43-9a6a-2f1f8d1c0a01"
const NEW_ID = "0a6f3c2e-6a51-4f43-9a6a-2f1f8d1c0a02"

function item(id: string): MediaItemView {
  return {
    id,
    mediaType: "image",
    uploadState: "ready",
    thumbnailUrl: `/api/media/${id}/thumb`,
    previewUrl: `/api/media/${id}/preview`,
    mimeType: "image/jpeg",
    originalFilename: `${id}.jpg`,
    createdAt: "2026-10-29T12:00:00.000000+00:00",
    contributorId: "7c2e1a90-4b3d-4e8f-9a1c-2d5e6f7a8b22",
    contributorName: "TEST Staff",
    venueName: "TEST Venue",
    width: 64,
    height: 48,
    durationSeconds: null,
    sizeBytes: 4,
    labels: null,
  }
}

function host(children: React.ReactNode) {
  return (
    <AddHost blocked={null} captchaRequired={false} captchaSiteKey={null}>
      <AddTrigger kind="bar" />
      {children}
    </AddHost>
  )
}

const profile = {
  displayName: "TEST Staff",
  jobTitle: null,
  venueName: "TEST Venue",
  avatarUrl: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("matchMedia", () => ({ matches: true }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("global Add gallery refresh", () => {
  it.each([null, "6c000000-0000-4000-8000-0000000000aa"])(
    "refreshes the task picker for requirement %s and preserves its selection",
    async (requirementId) => {
      const user = userEvent.setup()
      const original = photo({
        assetId: OLD_ID,
        uploadedAt: "2026-11-02T10:00:00.000Z",
      })
      const uploaded = photo({
        assetId: NEW_ID,
        uploadedAt: "2026-11-02T15:00:00.000Z",
      })
      vi.mocked(loadSubmittablePhotosAction).mockResolvedValue({
        ok: true,
        items: [uploaded, original],
        nextCursor: null,
      })
      render(
        host(
          <TaskSubmit
            requirementId={requirementId}
            replacesSubmissionId={null}
            initialPhotos={{ ok: true, items: [original], nextCursor: null }}
          />
        )
      )
      const selected = screen.getByRole("button", {
        name: "Photo uploaded 2 Nov 2026, 10:00",
      })
      await user.click(selected)
      await user.click(screen.getByRole("button", { name: "Add photos" }))
      await user.click(screen.getByRole("button", { name: "Complete upload" }))
      expect(
        await screen.findByRole("button", {
          name: "Photo uploaded 2 Nov 2026, 15:00",
        })
      ).toBeTruthy()
      expect(selected.getAttribute("aria-pressed")).toBe("true")
      expect(loadSubmittablePhotosAction).toHaveBeenCalledExactlyOnceWith({
        requirementId,
        cursor: null,
      })
      expect(submitPhotosAction).not.toHaveBeenCalled()
    }
  )

  it("refreshes Photos after each completion without waiting for focus and retains filters", async () => {
    const user = userEvent.setup()
    const search = { venue: "venue-filter", type: "image" }
    vi.mocked(loadCommunityPage).mockResolvedValue({
      ok: true,
      page: { items: [item(NEW_ID), item(OLD_ID)], nextCursor: null },
    })
    render(
      host(
        <CommunityGallery
          initialPage={{ items: [item(OLD_ID)], nextCursor: null }}
          search={search}
        />
      )
    )
    expect(loadCommunityPage).not.toHaveBeenCalled()
    expect(document.querySelector(`[data-media-id="${NEW_ID}"]`)).toBeNull()

    await user.click(screen.getByRole("button", { name: "Add photos" }))
    await user.click(screen.getByRole("button", { name: "Complete upload" }))
    await waitFor(() =>
      expect(
        document.querySelector(`[data-media-id="${NEW_ID}"]`)
      ).not.toBeNull()
    )
    expect(loadCommunityPage).toHaveBeenLastCalledWith(search, null, undefined)
    expect(refresh).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole("button", { name: "Complete upload" }))
    await waitFor(() => expect(loadCommunityPage).toHaveBeenCalledTimes(2))
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it("refreshes Me after global Add and keeps the portfolio's own upload refresh", async () => {
    const user = userEvent.setup()
    const fetch = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            page: { items: [item(NEW_ID), item(OLD_ID)], nextCursor: null },
          }),
          { headers: { "content-type": "application/json" } }
        )
    )
    vi.stubGlobal("fetch", fetch)
    render(
      host(
        <StaffPortfolio
          profile={profile}
          uploadBlocked={null}
          initialPage={{ items: [item(OLD_ID)], nextCursor: null }}
        />
      )
    )
    expect(fetch).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Add photos" }))
    await user.click(screen.getByRole("button", { name: "Complete upload" }))
    await waitFor(() =>
      expect(
        document.querySelector(`[data-media-id="${NEW_ID}"]`)
      ).not.toBeNull()
    )
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/portfolio",
      expect.objectContaining({
        cache: "no-store",
        signal: expect.any(AbortSignal),
      })
    )

    await user.click(
      screen.getByRole("button", { name: "Upload photos or videos" })
    )
    await user.click(
      screen.getAllByRole("button", { name: "Complete upload" })[0]
    )
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
