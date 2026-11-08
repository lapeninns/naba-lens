// @vitest-environment jsdom
// "Log out anyway" while uploads run: Log out is a native POST, so the page
// unloads in the same tick, before the stopped queue removes its beforeunload
// listener. The person already chose to leave, so the browser must not ask
// again.
import * as React from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  LeaveGuard,
  useLeaveGuard,
} from "@/components/nabalens/shell/leave-guard"
import { useUploadQueue } from "@/components/nabalens/use-upload-queue"
import {
  guardBeforeUnload,
  isLeavingDeliberately,
  leaveDeliberately,
} from "@/lib/upload/before-unload"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))

afterEach(cleanup)
// Each test starts with no deliberate leave in effect.
beforeEach(() => leaveDeliberately(0))

const LIMITS = {
  maxBatchFiles: 10,
  maxParallelUploads: 2,
  maxPhotoBytes: 20 * 1024 * 1024,
  maxVideoBytes: 200 * 1024 * 1024,
}

function Uploading() {
  const queue = useUploadQueue({
    upload: () => new Promise(() => {}),
    limits: LIMITS,
  })
  useLeaveGuard(queue.summary.active, queue.cancelAll)
  const { add, start } = queue
  React.useEffect(() => {
    add([new File([new Uint8Array(8)], "a.jpg", { type: "image/jpeg" })])
    start()
  }, [add, start])
  return <p>{queue.summary.active} uploading</p>
}

const unload = () => {
  const event = new Event("beforeunload", { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

describe("Log out anyway while uploads run", () => {
  it("unloads without the browser asking again", async () => {
    const asked: boolean[] = []
    const user = userEvent.setup()
    render(
      <LeaveGuard>
        <Uploading />
        <form
          data-logout
          onSubmit={(event) => {
            event.preventDefault()
            // A native POST unloads the page right here.
            asked.push(unload())
          }}
        >
          <button type="submit">Log out</button>
        </form>
      </LeaveGuard>
    )
    await screen.findByText("1 uploading")
    expect(unload()).toBe(true)

    await user.click(screen.getByRole("button", { name: "Log out" }))
    await user.click(
      await screen.findByRole("button", { name: "Log out anyway" })
    )
    await waitFor(() => expect(asked).toEqual([false]))
  })
})

describe("leaveDeliberately", () => {
  it("silences the unload prompt briefly, then it asks again", () => {
    const remove = guardBeforeUnload(() => true)
    try {
      expect(unload()).toBe(true)
      const now = Date.now()
      leaveDeliberately(now)
      expect(isLeavingDeliberately(now + 1)).toBe(true)
      expect(unload()).toBe(false)
      expect(isLeavingDeliberately(now + 5_001)).toBe(false)
    } finally {
      remove()
    }
  })
})
