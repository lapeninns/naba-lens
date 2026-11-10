// @vitest-environment jsdom
// "Log out anyway" while uploads run: Log out is a native POST, so the page
// unloads in the same tick, before the stopped queue removes its beforeunload
// listener. The person already chose to leave, so the browser must not ask
// again.
import * as React from "react"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  LeaveGuard,
  useLeaveGuard,
} from "@/components/nabalens/shell/leave-guard"
import { useUploadQueue } from "@/components/nabalens/use-upload-queue"
import {
  UploadQueue,
  type UploadContext,
} from "@/components/nabalens/upload-queue"
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

describe("the native warning while files are processing", () => {
  type Queue = ReturnType<typeof useUploadQueue>
  type Run = { name: string; context: UploadContext }

  function Harness({
    runs,
    expose,
    parallel,
  }: {
    runs: Run[]
    expose: (queue: Queue) => void
    parallel: number
  }) {
    const queue = useUploadQueue({
      // In-memory gate: each file stays where the test moves it.
      upload: (file, context) => {
        runs.push({ name: file.name, context })
        return new Promise(() => {})
      },
      limits: { ...LIMITS, maxParallelUploads: parallel },
    })
    expose(queue)
    return null
  }

  function setup(parallel: number) {
    const runs: Run[] = []
    let queue!: Queue
    render(
      <Harness
        runs={runs}
        parallel={parallel}
        expose={(q) => {
          queue = q
        }}
      />
    )
    const send = (name: string) =>
      act(() => {
        queue.add([new File([new Uint8Array(8)], name, { type: "image/jpeg" })])
        queue.start()
      })
    const processing = (name: string) =>
      act(() => runs.find((r) => r.name === name)!.context.onProcessing())
    const status = () => queue.items.map((i) => i.status)
    return { send, processing, status, queue: () => queue }
  }

  it("does not ask when only processing remains; asks while one uploads", () => {
    const { send, processing, status, queue } = setup(2)
    send("a.jpg")
    expect(status()).toEqual(["uploading"])
    expect(unload()).toBe(true)

    processing("a.jpg")
    expect(status()).toEqual(["processing"])
    expect(queue().isActive).toBe(true)
    expect(unload()).toBe(false)

    send("b.jpg")
    expect(status()).toEqual(["processing", "uploading"])
    expect(unload()).toBe(true)

    processing("b.jpg")
    expect(unload()).toBe(false)
  })

  it("asks while another file is queued behind a processing one", () => {
    const { send, processing, status } = setup(1)
    send("a.jpg")
    processing("a.jpg")
    send("b.jpg")
    expect(status()).toEqual(["processing", "queued"])
    expect(unload()).toBe(true)
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

describe("a deliberate leave that does not leave (I2)", () => {
  it("ends when a new upload starts", async () => {
    leaveDeliberately()
    expect(isLeavingDeliberately()).toBe(true)
    const queue = new UploadQueue(() => new Promise(() => {}), LIMITS)
    queue.add([new File([new Uint8Array(8)], "b.jpg", { type: "image/jpeg" })])
    queue.start()
    await vi.waitFor(() => expect(isLeavingDeliberately()).toBe(false))
    queue.cancelAll()
  })

  it("ends when the page comes back from the back-forward cache", () => {
    leaveDeliberately()
    window.dispatchEvent(
      Object.assign(new Event("pageshow"), { persisted: false })
    )
    expect(isLeavingDeliberately()).toBe(true)
    window.dispatchEvent(
      Object.assign(new Event("pageshow"), { persisted: true })
    )
    expect(isLeavingDeliberately()).toBe(false)
  })
})
