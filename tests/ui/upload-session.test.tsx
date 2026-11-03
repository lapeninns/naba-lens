// @vitest-environment jsdom
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  SessionGuardProvider,
  type SessionGuard,
} from "@/components/nabalens/session-guard"
import { UploadDialog } from "@/components/nabalens/upload-dialog"
import {
  SIGNED_OUT_MESSAGE,
  type Uploader,
} from "@/components/nabalens/upload-queue"

const LIMITS = {
  maxBatchFiles: 10,
  maxParallelUploads: 1,
  maxPhotoBytes: 20 * 1024 * 1024,
  maxVideoBytes: 200 * 1024 * 1024,
}

function jpeg(name: string) {
  return new File([new Uint8Array(64)], name, { type: "image/jpeg" })
}

afterEach(cleanup)

function heldUploader() {
  const held: {
    name: string
    resolve: () => void
    reject: (e: Error) => void
  }[] = []
  const upload: Uploader = (file) =>
    new Promise<void>((resolve, reject) => {
      held.push({ name: file.name, resolve, reject })
    })
  return { upload, held }
}

function setup() {
  let signedIn = true
  const sendLink = vi.fn(async () => ({}))
  const guard: SessionGuard = {
    email: "priya.gurung@example.test",
    captchaRequired: false,
    captchaSiteKey: null,
    sendLink,
    isSignedIn: async () => signedIn,
  }
  const { upload, held } = heldUploader()
  const onUploaded = vi.fn()
  render(
    <SessionGuardProvider value={guard}>
      <p>Page behind</p>
      <UploadDialog
        open
        onOpenChange={() => {}}
        uploader={upload}
        limits={LIMITS}
        onUploaded={onUploaded}
      />
    </SessionGuardProvider>
  )
  return {
    user: userEvent.setup(),
    held,
    sendLink,
    onUploaded,
    signOut: () => (signedIn = false),
    signIn: () => (signedIn = true),
  }
}

// E7 is modal over the upload sheet, which is hidden from the a11y tree meanwhile.
const uploadDialog = () =>
  screen.getByRole("dialog", { name: "Upload photos or videos", hidden: true })
const statusLine = () =>
  within(uploadDialog()).getAllByRole("status", { hidden: true }).at(-1)!

describe("UploadDialog when the session ends", () => {
  it("stops the running file, keeps the queue, sends a link and resumes waiting files after sign-in", async () => {
    const { user, held, sendLink, onUploaded, signOut, signIn } = setup()
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("a.jpg"),
      jpeg("b.jpg"),
      jpeg("c.jpg"),
    ])
    await user.click(screen.getByRole("button", { name: "Upload 3 files" }))
    await waitFor(() => expect(held).toHaveLength(1))
    await act(async () => held[0].resolve())
    await waitFor(() => expect(held).toHaveLength(2))

    signOut()
    await act(async () => held[1].reject(new Error("Sign in to continue.")))

    // E7 opens over the queue; the page and the queue stay.
    const e7 = await screen.findByRole("dialog", { name: "Sign in again" })
    expect(
      within(e7).getByText(
        "You were signed out after a while away. 1 photo finished uploading and is safe. 1 stopped."
      )
    ).toBeTruthy()
    expect(within(e7).getByText("priya.gurung@example.test")).toBeTruthy()
    expect(screen.getByText("Page behind")).toBeTruthy()
    expect(
      screen.getByText(new RegExp(SIGNED_OUT_MESSAGE.replace(/\./g, "\\.")))
    ).toBeTruthy()
    expect(statusLine().textContent).toBe("1 uploaded · 1 waiting · 1 stopped")
    // Nothing is refreshed while signed out; that would leave the page.
    expect(onUploaded).not.toHaveBeenCalled()
    expect(held).toHaveLength(2)

    await user.click(
      within(e7).getByRole("button", { name: "Send sign-in link" })
    )
    expect(sendLink).toHaveBeenCalledWith(
      "priya.gurung@example.test",
      undefined
    )
    expect(await within(e7).findByText("Check your email")).toBeTruthy()

    await user.click(within(e7).getByRole("button", { name: "Done" }))
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: /Sign in again|Check your email/ })
      ).toBeNull()
    )
    expect(within(uploadDialog()).getByText("You were signed out")).toBeTruthy()
    expect(
      within(uploadDialog()).getByRole("button", { name: "Sign in again" })
    ).toBeTruthy()

    // Signed in again in another tab: back here, the waiting file starts and
    // the stopped one waits for its own Retry.
    signIn()
    await act(async () => {
      window.dispatchEvent(new Event("focus"))
    })
    await waitFor(() => expect(held).toHaveLength(3))
    expect(held[2].name).toBe("c.jpg")
    expect(screen.queryByText("You were signed out")).toBeNull()
    await act(async () => held[2].resolve())
    await waitFor(() =>
      expect(statusLine().textContent).toBe("2 uploaded · 1 stopped")
    )
    expect(onUploaded).toHaveBeenCalledWith(2)

    await user.click(screen.getByRole("button", { name: "Retry b.jpg" }))
    await waitFor(() => expect(held).toHaveLength(4))
    expect(held[3].name).toBe("b.jpg")
  })

  it("never calls the uploader while signed out", async () => {
    const { user, held, signOut } = setup()
    signOut()
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("a.jpg"),
    ])
    await user.click(screen.getByRole("button", { name: "Upload 1 file" }))
    expect(
      await screen.findByRole("dialog", { name: "Sign in again" })
    ).toBeTruthy()
    expect(held).toHaveLength(0)
  })
})
