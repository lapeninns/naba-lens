// @vitest-environment jsdom
// The capture form's "Sign in again" link returns to this capture page.
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { CheckSummary } from "@/lib/amenities/contract"

const { form } = vi.hoisted(() => ({ form: { signInHref: "" } }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/staff/tasks/amenities/check-1/capture",
}))
vi.mock("@/app/_amenities/actions", () => ({
  listSubmittableAssetsAction: vi.fn(),
  submitFindingAction: vi.fn(),
}))
vi.mock("@/app/_media/use-media-uploader", () => ({
  useMediaUploader: () => null,
}))
vi.mock("@/components/nabalens/shell/add-context", () => ({
  useAddQueue: () => null,
  useAddRefreshSignal: () => 0,
}))
vi.mock("@/components/nabalens/amenities/capture", () => ({
  CaptureForm: ({ signInHref }: { signInHref: string }) => {
    form.signInHref = signInHref
    return null
  },
}))

import { CaptureClient } from "@/app/staff/tasks/amenities/_capture/capture-client"

afterEach(cleanup)

describe("CaptureClient", () => {
  it("signs in again back to the capture page", () => {
    render(
      <CaptureClient
        check={{ id: "check-1" } as CheckSummary}
        viewerId="me"
        initialAssets={{ ok: true, assets: [] }}
        canUpload={false}
        canAttachLegacy={false}
        doneHref="/staff/tasks"
      />
    )
    expect(form.signInHref).toBe(
      "/login?next=%2Fstaff%2Ftasks%2Famenities%2Fcheck-1%2Fcapture"
    )
  })
})
