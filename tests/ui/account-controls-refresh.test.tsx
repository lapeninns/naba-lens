// @vitest-environment jsdom
// Final review F9: saving an edit that changes activation refreshed the page
// twice (once on confirming the status, again after the save). One refresh is
// enough; each re-render re-reads Auth, media and venues on the server.
import { act, cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { StaffMember } from "@/components/nabalens"

const refresh = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}))

const updateStaffAccountAction = vi.fn()
const setStaffActiveAction = vi.fn()
vi.mock("@/app/admin/staff/actions", () => ({
  setStaffActiveAction: (...args: unknown[]) => setStaffActiveAction(...args),
  resendInvitationAction: vi.fn(async () => ({ ok: true })),
  updateStaffAccountAction: (...args: unknown[]) =>
    updateStaffAccountAction(...args),
}))

type DialogProps = {
  onSubmit: (values: Record<string, unknown>) => Promise<unknown>
}
let dialog: DialogProps | null = null
vi.mock("@/components/nabalens", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  EditProfileDialog: (props: DialogProps) => {
    dialog = props
    return null
  },
}))

import { useAccountControls } from "@/app/admin/staff/account-controls"

const member: StaffMember = {
  id: "7c2e1a90-4b3d-4e8f-9a1c-2d5e6f7a8b22",
  displayName: "TEST Sam",
  avatarUrl: null,
  jobTitle: "Bartender",
  venueId: "5b0d8f43-2a1e-4c5f-8d4b-0e7c9a3f1b11",
  venueName: "TEST Venue",
  email: "sam@nabalens.test",
  status: "active",
}

let controls: ReturnType<typeof useAccountControls> | null = null
function Harness() {
  controls = useAccountControls({ venues: [], maxAvatarBytes: 5 << 20 })
  return controls.dialogs
}

beforeEach(() => {
  refresh.mockClear()
  updateStaffAccountAction.mockReset()
  setStaffActiveAction.mockReset()
})
afterEach(cleanup)

describe("account controls refresh the page once per change (final review F9)", () => {
  it("an edit that deactivates refreshes once", async () => {
    updateStaffAccountAction.mockResolvedValue({ ok: true, status: "inactive" })
    render(<Harness />)
    act(() => controls!.edit(member))
    await act(async () => {
      await dialog!.onSubmit({ displayName: "TEST Sam", active: false })
    })
    expect(updateStaffAccountAction).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("reactivating from the list still refreshes once", async () => {
    setStaffActiveAction.mockResolvedValue({ ok: true, status: "active" })
    render(<Harness />)
    await act(async () => {
      controls!.setActive({ ...member, status: "inactive" }, true)
    })
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  })
})
