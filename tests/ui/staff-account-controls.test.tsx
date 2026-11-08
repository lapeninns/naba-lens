// @vitest-environment jsdom
// Admin account actions tell the truth (ADM-1, ADM-2). Resend and Reactivate
// run one at a time with a pending label. A rejected call (offline, reply lost)
// says the outcome couldn't be confirmed instead of clearing the notice; it
// never claims nothing changed, since the server may have acted. A second tap
// must never resend: each resend invalidates the link sent before it. An edit
// whose photo saved before the details failed says exactly that, and a retry
// does not upload the photo again.
import * as React from "react"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { StaffMember } from "@/components/nabalens"

const refresh = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}))

const setStaffActiveAction = vi.fn()
const resendInvitationAction = vi.fn()
const updateStaffAccountAction = vi.fn()
vi.mock("@/app/admin/staff/actions", () => ({
  setStaffActiveAction: (...args: unknown[]) => setStaffActiveAction(...args),
  resendInvitationAction: (...args: unknown[]) =>
    resendInvitationAction(...args),
  updateStaffAccountAction: (...args: unknown[]) =>
    updateStaffAccountAction(...args),
  inviteStaffAction: vi.fn(async () => ({ status: "sent" })),
}))

import { AccountHeader } from "@/app/admin/staff/[id]/account-header"
import { useAccountControls } from "@/app/admin/staff/account-controls"
import { EditStaffDialog } from "@/app/admin/staff/edit-staff-dialog"
import { StaffDirectory } from "@/app/admin/staff/staff-directory"

const member = (
  status: StaffMember["status"],
  extra: Partial<StaffMember> = {}
): StaffMember => ({
  id: "7c2e1a90-4b3d-4e8f-9a1c-2d5e6f7a8b22",
  displayName: "TEST Sam",
  avatarUrl: null,
  jobTitle: "Bartender",
  department: "foh",
  venueId: "5b0d8f43-2a1e-4c5f-8d4b-0e7c9a3f1b11",
  venueName: "TEST Venue",
  email: "sam@nabalens.test",
  status,
  ...extra,
})

function header(status: StaffMember["status"]) {
  return (
    <AccountHeader
      member={member(status)}
      venueActive
      venues={[]}
      maxAvatarBytes={5 * 1024 * 1024}
    />
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** What the account notice's polite live region holds right now. */
const announced = () =>
  Array.from(document.querySelectorAll('[aria-live="polite"]'))
    .map((region) => region.textContent ?? "")
    .join(" ")

/** Pending: refuses activation but keeps focus (aria-disabled, not native). */
function expectFocusableBlocked(button: HTMLElement) {
  expect(button.getAttribute("aria-disabled")).toBe("true")
  expect(button.hasAttribute("disabled")).toBe(false)
  act(() => button.focus())
  expect(document.activeElement).toBe(button)
}

async function openMenu(name = "TEST Sam") {
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: `More actions for ${name}` }))
  return screen.findByRole("menu")
}

beforeEach(() => {
  refresh.mockClear()
  setStaffActiveAction.mockReset()
  resendInvitationAction.mockReset()
  updateStaffAccountAction.mockReset()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("Resend invitation (ADM-1)", () => {
  it("is disabled with a pending label while sending, and a second tap sends nothing", async () => {
    const call = deferred<{ ok: true }>()
    resendInvitationAction.mockReturnValue(call.promise)
    render(header("invited"))
    const button = screen.getByRole("button", { name: "Resend invitation" })

    await act(async () => {
      fireEvent.click(button)
    })
    const pending = screen.getByRole("button", { name: "Sending invitation…" })
    expectFocusableBlocked(pending)
    expect(pending.getAttribute("aria-busy")).toBe("true")
    expect(announced()).toContain(
      "Sending the invitation to sam@nabalens.test…"
    )
    await act(async () => {
      fireEvent.click(pending)
    })
    // The menu offers the same action; it waits too.
    const menu = await openMenu()
    const item = within(menu).getByRole("menuitem", {
      name: "Sending invitation…",
    })
    expect(item.getAttribute("aria-disabled")).toBe("true")
    expect(
      within(menu)
        .getByRole("menuitem", { name: "Deactivate" })
        .getAttribute("aria-disabled")
    ).toBe("true")
    await act(async () => {
      fireEvent.click(item)
    })
    expect(resendInvitationAction).toHaveBeenCalledTimes(1)

    await act(async () => {
      call.resolve({ ok: true })
    })
    expect(announced()).toContain(
      "Invitation sent again to sam@nabalens.test. Earlier links stop working."
    )
    expect(
      screen.getByRole("button", { name: "Resend invitation" })
    ).toHaveProperty("disabled", false)
  })

  it("a rejected call can't confirm the send, and the button works again", async () => {
    resendInvitationAction.mockRejectedValue(new TypeError("Failed to fetch"))
    render(header("invited"))
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resend invitation" }))
    })
    expect(announced()).toContain(
      "We couldn't confirm the invitation to sam@nabalens.test was sent. Check your connection, then try again. A new invitation replaces any earlier link."
    )
    expect(
      screen.getByRole("button", { name: "Resend invitation" })
    ).toHaveProperty("disabled", false)
  })

  it("a refusal from the server is shown as the server worded it", async () => {
    resendInvitationAction.mockResolvedValue({
      ok: false,
      error: "TEST Sam has already signed in.",
    })
    render(header("invited"))
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resend invitation" }))
    })
    expect(announced()).toContain("TEST Sam has already signed in.")
  })
})

describe("pending buttons keep focus (review 2, D1)", () => {
  it("Resend invitation keeps keyboard focus while sending, and Enter again sends nothing", async () => {
    const call = deferred<{ ok: true }>()
    resendInvitationAction.mockReturnValue(call.promise)
    render(header("invited"))
    const user = userEvent.setup()
    const button = screen.getByRole("button", { name: "Resend invitation" })
    act(() => button.focus())
    await user.keyboard("{Enter}")
    const pending = screen.getByRole("button", { name: "Sending invitation…" })
    expect(document.activeElement).toBe(pending)
    await user.keyboard("{Enter}")
    expect(resendInvitationAction).toHaveBeenCalledTimes(1)
    await act(async () => {
      call.resolve({ ok: true })
    })
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Resend invitation" })
    )
  })

  it("Reactivate keeps keyboard focus while pending and after a failure", async () => {
    const call = deferred<never>()
    setStaffActiveAction.mockReturnValue(call.promise)
    render(header("inactive"))
    const user = userEvent.setup()
    act(() => screen.getByRole("button", { name: "Reactivate" }).focus())
    await user.keyboard("{Enter}")
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Reactivating…" })
    )
    await act(async () => {
      call.reject(new TypeError("Failed to fetch"))
    })
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Reactivate" })
    )
  })
})

describe("account notice live region (review 2, D3)", () => {
  /** Live regions from `element` up to the document. */
  const liveRegionsAround = (element: Element) => {
    const regions: Element[] = []
    for (let node: Element | null = element; node; node = node.parentElement) {
      const role = node.getAttribute("role")
      if (
        node.hasAttribute("aria-live") ||
        role === "status" ||
        role === "alert" ||
        role === "log"
      )
        regions.push(node)
    }
    return regions
  }

  it.each([
    ["success", { ok: true }, "Invitation sent again to sam@nabalens.test."],
    [
      "refusal",
      { ok: false, error: "TEST Sam has already signed in." },
      "TEST Sam has already signed in.",
    ],
  ] as const)(
    "a %s sits in exactly one polite live region",
    async (_kind, reply, message) => {
      resendInvitationAction.mockResolvedValue(reply)
      render(header("invited"))
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "Resend invitation" })
        )
      })
      const regions = liveRegionsAround(
        screen.getByText(message, { exact: false })
      )
      expect(regions).toHaveLength(1)
      expect(regions[0].getAttribute("aria-live")).toBe("polite")
    }
  )
})

describe("an edit waits for a pending resend or reactivate (review 2, D4)", () => {
  it("Edit details is unavailable from the header and the menu while reactivating", async () => {
    const call = deferred<{ ok: true; status: "active" }>()
    setStaffActiveAction.mockReturnValue(call.promise)
    render(header("inactive"))
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reactivate" }))
    })
    const edit = screen.getByRole("button", { name: "Edit details" })
    expectFocusableBlocked(edit)
    await act(async () => {
      fireEvent.click(edit)
    })
    expect(screen.queryByRole("dialog")).toBeNull()
    const menu = await openMenu()
    const item = within(menu).getByRole("menuitem", { name: "Edit details" })
    expect(item.getAttribute("aria-disabled")).toBe("true")
    await act(async () => {
      fireEvent.click(item)
    })
    expect(screen.queryByRole("dialog")).toBeNull()

    await act(async () => {
      call.resolve({ ok: true, status: "active" })
    })
    expect(
      screen
        .getByRole("button", { name: "Edit details" })
        .getAttribute("aria-disabled")
    ).not.toBe("true")
  })

  it("an open dialog's Save waits and sends nothing while an action is pending", async () => {
    const onSubmit = vi.fn(async () => ({ ok: true as const }))
    render(
      <EditStaffDialog
        member={member("active")}
        onClose={() => {}}
        venues={[]}
        grant={null}
        maxAvatarBytes={5 << 20}
        actionPending
        onSubmit={onSubmit}
      />
    )
    const user = userEvent.setup()
    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByRole("switch"))
    const save = within(dialog).getByRole("button", { name: "Save changes" })
    expect(save).toHaveProperty("disabled", true)
    expect(save.getAttribute("aria-describedby")).toBeTruthy()
    expect(
      within(dialog).getByText(
        "Waiting for the last account action to finish before saving."
      )
    ).toBeTruthy()
    fireEvent.submit(save.closest("form")!)
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe("status summary when Auth details are unavailable", () => {
  const people = [
    member("active", {
      id: "00000000-0000-4000-8000-0000000000a1",
      displayName: "Ana Rai",
    }),
    member("active", {
      id: "00000000-0000-4000-8000-0000000000a2",
      displayName: "Bo Lama",
    }),
    member("inactive", {
      id: "00000000-0000-4000-8000-0000000000a3",
      displayName: "Cy Tamang",
    }),
  ]

  it("doesn't claim an Active/Invited split it can't know", () => {
    render(
      <StaffDirectory
        staff={people}
        venues={[]}
        grants={[]}
        maxAvatarBytes={5 << 20}
        authDetails="unavailable"
      />
    )
    expect(
      screen.getByText("3 shown · 2 active or invited · 1 inactive")
    ).toBeTruthy()
  })

  it("splits them once Auth answered", () => {
    render(
      <StaffDirectory
        staff={[
          ...people,
          member("invited", {
            id: "00000000-0000-4000-8000-0000000000a4",
            displayName: "Di Sherpa",
          }),
        ]}
        venues={[]}
        grants={[]}
        maxAvatarBytes={5 << 20}
        authDetails="ok"
      />
    )
    expect(
      screen.getByText("4 shown · 2 active · 1 invited · 1 inactive")
    ).toBeTruthy()
  })
})

describe("Edit details explains why Save is unavailable", () => {
  it("an empty display name shows an inline error tied to the field and to Save", async () => {
    render(
      <EditStaffDialog
        member={member("active")}
        onClose={() => {}}
        venues={[]}
        grant={null}
        maxAvatarBytes={5 << 20}
        onSubmit={vi.fn(async () => ({ ok: true as const }))}
      />
    )
    const user = userEvent.setup()
    const dialog = await screen.findByRole("dialog")
    const name = within(dialog).getByLabelText("Display name")
    expect(name.getAttribute("aria-invalid")).toBeNull()
    expect(within(dialog).queryByText("Enter their name.")).toBeNull()

    await user.clear(name)
    const error = within(dialog)
      .getByText("Enter their name.")
      .closest('[data-slot="field-error"]')!
    expect(error.id).toBeTruthy()
    expect(name.getAttribute("aria-invalid")).toBe("true")
    expect(name.getAttribute("aria-describedby")).toBe(error.id)
    const save = within(dialog).getByRole("button", { name: "Save changes" })
    expect(save).toHaveProperty("disabled", true)
    expect(save.getAttribute("aria-describedby")).toBe(error.id)

    await user.type(name, "TEST Samir")
    expect(within(dialog).queryByText("Enter their name.")).toBeNull()
    expect(name.getAttribute("aria-invalid")).toBeNull()
    expect(save).toHaveProperty("disabled", false)
    expect(save.getAttribute("aria-describedby")).toBeNull()
  })
})

describe("Edit details: the saved notice says what an access change means", () => {
  async function editStatus(
    status: StaffMember["status"],
    savedStatus: StaffMember["status"]
  ) {
    updateStaffAccountAction.mockResolvedValue({
      ok: true,
      status: savedStatus,
    })
    render(header(status))
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Edit details" }))
    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByRole("switch"))
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" })
    )
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  }

  it("turning Account active off closes the dialog and says they can no longer sign in", async () => {
    await editStatus("active", "inactive")
    expect(announced()).toContain("Saved TEST Sam. TEST can no longer sign in.")
    expect(updateStaffAccountAction).toHaveBeenCalledWith(
      member("active").id,
      expect.objectContaining({ active: false })
    )
  })

  it("turning it back on says they can sign in again", async () => {
    await editStatus("inactive", "active")
    expect(announced()).toContain("Saved TEST Sam. TEST can sign in again.")
  })

  it("a status changed elsewhere isn't credited to an edit that left the switch alone", async () => {
    // Another admin deactivated the person while this dialog was open.
    updateStaffAccountAction.mockResolvedValue({ ok: true, status: "inactive" })
    render(header("active"))
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Edit details" }))
    const dialog = await screen.findByRole("dialog")
    await user.type(within(dialog).getByLabelText(/Job title/), " lead")
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" })
    )
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(announced()).toContain("Saved TEST Sam.")
    expect(announced()).not.toContain("can no longer sign in")
  })

  it("an edit that leaves access alone says only Saved", async () => {
    updateStaffAccountAction.mockResolvedValue({ ok: true })
    render(header("active"))
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Edit details" }))
    const dialog = await screen.findByRole("dialog")
    await user.type(within(dialog).getByLabelText(/Job title/), " lead")
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" })
    )
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(announced()).toContain("Saved TEST Sam.")
    expect(announced()).not.toContain("sign in")
  })
})

describe("Reactivate (ADM-1)", () => {
  it("is disabled with a pending label until the server answers", async () => {
    const call = deferred<{ ok: true; status: "active" }>()
    setStaffActiveAction.mockReturnValue(call.promise)
    render(header("inactive"))
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reactivate" }))
    })
    const pending = screen.getByRole("button", { name: "Reactivating…" })
    expectFocusableBlocked(pending)
    expect(announced()).toContain("Reactivating TEST Sam…")
    await act(async () => {
      fireEvent.click(pending)
    })
    expect(setStaffActiveAction).toHaveBeenCalledTimes(1)

    await act(async () => {
      call.resolve({ ok: true, status: "active" })
    })
    expect(announced()).toContain("TEST Sam can sign in again.")
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("a rejected call can't confirm the reactivation and keeps Inactive", async () => {
    setStaffActiveAction.mockRejectedValue(new TypeError("Failed to fetch"))
    render(header("inactive"))
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reactivate" }))
    })
    expect(announced()).toContain(
      "We couldn't confirm TEST Sam was reactivated. Check your connection, then refresh to see their status."
    )
    expect(screen.getByRole("button", { name: "Reactivate" })).toHaveProperty(
      "disabled",
      false
    )
    expect(
      screen.getAllByText("Inactive", { exact: true }).length
    ).toBeGreaterThan(0)
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe("one account action at a time (ADM-1)", () => {
  type Controls = ReturnType<typeof useAccountControls>
  function Harness({ onRender }: { onRender: (c: Controls) => void }) {
    const current = useAccountControls({ venues: [], maxAvatarBytes: 5 << 20 })
    React.useEffect(() => onRender(current))
    return current.dialogs
  }

  it("two taps in the same tick send one invitation", async () => {
    const call = deferred<{ ok: true }>()
    resendInvitationAction.mockReturnValue(call.promise)
    let controls: Controls | null = null
    render(
      <Harness
        onRender={(c) => {
          controls = c
        }}
      />
    )
    const invited = member("invited")
    await act(async () => {
      // Both before React re-renders, as a fast double tap can land.
      void controls!.resend(invited)
      void controls!.resend(invited)
      controls!.setActive(member("inactive"), true)
    })
    expect(resendInvitationAction).toHaveBeenCalledTimes(1)
    expect(setStaffActiveAction).not.toHaveBeenCalled()
    expect(controls!.busy).toEqual({ action: "resend", memberId: invited.id })
    await act(async () => {
      call.resolve({ ok: true })
    })
    expect(controls!.busy).toBeNull()
  })

  it("the directory menu shows the pending resend and waits for it", async () => {
    const call = deferred<{ ok: true }>()
    resendInvitationAction.mockReturnValue(call.promise)
    const josh = member("invited", {
      id: "00000000-0000-4000-8000-000000000001",
      displayName: "Josh Patel",
      email: "josh@nabalens.test",
    })
    const dan = member("active", {
      id: "00000000-0000-4000-8000-000000000002",
      displayName: "Dan Cooper",
      email: "dan@nabalens.test",
    })
    render(
      <StaffDirectory
        staff={[josh, dan]}
        venues={[]}
        grants={[]}
        maxAvatarBytes={5 << 20}
      />
    )
    const user = userEvent.setup()
    // Phone list and table both render in jsdom; the table's menu is the second.
    const joshMenu = () =>
      screen.getAllByRole("button", { name: "More actions for Josh Patel" })[1]
    await user.click(joshMenu())
    await user.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", {
        name: "Resend invitation",
      })
    )
    expect(announced()).toContain(
      "Sending the invitation to josh@nabalens.test…"
    )

    await user.click(joshMenu())
    const again = within(await screen.findByRole("menu")).getByRole(
      "menuitem",
      { name: "Sending invitation…" }
    )
    expect(again.getAttribute("aria-disabled")).toBe("true")
    await user.keyboard("{Escape}")
    await user.click(
      screen.getAllByRole("button", { name: "More actions for Dan Cooper" })[1]
    )
    expect(
      within(await screen.findByRole("menu"))
        .getByRole("menuitem", { name: "Deactivate" })
        .getAttribute("aria-disabled")
    ).toBe("true")
    expect(resendInvitationAction).toHaveBeenCalledTimes(1)
    await act(async () => {
      call.resolve({ ok: true })
    })
    expect(announced()).toContain(
      "Invitation sent again to josh@nabalens.test."
    )
  })
})

describe("Edit details after the photo saved (ADM-2)", () => {
  it("says the photo saved and the job title couldn't be confirmed, and a retry sends only the details", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
    )
    vi.stubGlobal("fetch", fetchMock)
    updateStaffAccountAction.mockRejectedValueOnce(
      new TypeError("Failed to fetch")
    )
    render(header("active"))
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Edit details" }))
    const dialog = await screen.findByRole("dialog")
    await user.upload(
      within(dialog).getByLabelText("Profile photo"),
      new File(["x"], "sam.jpg", { type: "image/jpeg" })
    )
    const job = within(dialog).getByLabelText(/Job title/)
    await user.clear(job)
    await user.type(job, "Head bartender")
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" })
    )

    const alert = await within(dialog).findByRole("alert")
    expect(alert.textContent).toContain("Some changes may not have saved")
    expect(alert.textContent).toContain(
      "The profile photo was saved. We couldn't confirm the changes to TEST's job title saved. Check your connection and try again."
    )
    expect(alert.textContent).not.toContain("weren't saved")
    expect(alert.textContent).not.toContain("could not be saved")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // The saved photo is cleared from the form, so nothing re-uploads it.
    expect(
      (within(dialog).getByLabelText("Profile photo") as HTMLInputElement).files
        ?.length ?? 0
    ).toBe(0)

    updateStaffAccountAction.mockResolvedValueOnce({ ok: true })
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" })
    )
    await vi.waitFor(() =>
      expect(updateStaffAccountAction).toHaveBeenCalledTimes(2)
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(updateStaffAccountAction).toHaveBeenLastCalledWith(
      member("active").id,
      expect.objectContaining({ jobTitle: "Head bartender" })
    )
    expect(await screen.findByText("Saved TEST Sam.")).toBeTruthy()
  })

  it("a refused details save after the photo says they weren't saved, in the server's words", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 }))
    )
    updateStaffAccountAction.mockResolvedValueOnce({
      ok: false,
      error: "Job titles can be up to 80 characters.",
    })
    render(header("active"))
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Edit details" }))
    const dialog = await screen.findByRole("dialog")
    await user.upload(
      within(dialog).getByLabelText("Profile photo"),
      new File(["x"], "sam.jpg", { type: "image/jpeg" })
    )
    const job = within(dialog).getByLabelText(/Job title/)
    await user.clear(job)
    await user.type(job, "Head bartender")
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" })
    )
    const alert = await within(dialog).findByRole("alert")
    expect(alert.textContent).toContain("Some changes didn't save")
    expect(alert.textContent).toContain(
      "The profile photo was saved. The changes to TEST's job title weren't saved. Job titles can be up to 80 characters."
    )
  })

  it("a photo-only edit whose details reply is lost says only that the photo saved", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 }))
    )
    updateStaffAccountAction.mockRejectedValueOnce(
      new TypeError("Failed to fetch")
    )
    render(header("active"))
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Edit details" }))
    const dialog = await screen.findByRole("dialog")
    await user.upload(
      within(dialog).getByLabelText("Profile photo"),
      new File(["x"], "sam.jpg", { type: "image/jpeg" })
    )
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" })
    )
    const status = await within(dialog).findByText(
      "The profile photo was saved."
    )
    expect(status.closest('[role="status"]')).toBeTruthy()
    expect(within(dialog).queryByRole("alert")).toBeNull()
    expect(within(dialog).queryByText(/try again/i)).toBeNull()
  })

  it("a rejected save with no photo can't confirm the changes", async () => {
    updateStaffAccountAction.mockRejectedValueOnce(
      new TypeError("Failed to fetch")
    )
    render(header("active"))
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Edit details" }))
    const dialog = await screen.findByRole("dialog")
    const job = within(dialog).getByLabelText(/Job title/)
    await user.clear(job)
    await user.type(job, "Head bartender")
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" })
    )
    const alert = await within(dialog).findByRole("alert")
    expect(alert.textContent).toBe(
      "We couldn't confirm your changes saved. Check your connection and try again."
    )
  })
})
