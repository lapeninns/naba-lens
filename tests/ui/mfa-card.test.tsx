// @vitest-environment jsdom
// The second sign-in step (FA-23): set up an authenticator app, or enter its
// code. Server functions are mocked; the card's states and words are real.
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { MfaCard } from "@/app/auth/mfa/mfa-card"

const startMfaEnrolment = vi.fn()
const confirmMfaCode = vi.fn()
vi.mock("@/app/auth/mfa/actions", () => ({
  startMfaEnrolment: () => startMfaEnrolment(),
  confirmMfaCode: (...args: unknown[]) => confirmMfaCode(...args),
}))

afterEach(() => {
  cleanup()
  startMfaEnrolment.mockReset()
  confirmMfaCode.mockReset()
})

describe("MfaCard", () => {
  it("asks for the code when a factor exists", () => {
    render(<MfaCard mode="verify" required />)
    expect(
      screen.getByRole("heading", { name: "Enter your sign-in code" })
    ).toBeTruthy()
    const field = screen.getByLabelText("6-digit code")
    expect(field.getAttribute("autocomplete")).toBe("one-time-code")
    expect(field.getAttribute("inputmode")).toBe("numeric")
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy()
  })

  it("explains why an admin must set it up, then shows the QR code and key", async () => {
    startMfaEnrolment.mockResolvedValue({
      ok: true,
      factorId: "f1",
      qrCode: "data:image/svg+xml;utf-8,<svg/>",
      secret: "JBSWY3DPEHPK3PXP",
    })
    render(<MfaCard mode="enrol" required />)
    expect(screen.getByText(/Admin accounts need a code/)).toBeTruthy()
    fireEvent.click(
      screen.getByRole("button", { name: "Set up with an authenticator app" })
    )
    expect(
      await screen.findByRole("heading", { name: "Scan this code" })
    ).toBeTruthy()
    expect(
      screen.getByRole("img", { name: "QR code for your authenticator app" })
    ).toBeTruthy()
    expect(screen.getByTestId("mfa-secret").textContent).toBe(
      "JBSWY3DPEHPK3PXP"
    )
    const hidden = document.querySelector<HTMLInputElement>(
      'input[name="factorId"]'
    )
    expect(hidden?.value).toBe("f1")
    expect(screen.getByRole("button", { name: "Confirm code" })).toBeTruthy()
  })

  it("words a manager's own choice and shows a failed start beside the button", async () => {
    startMfaEnrolment.mockResolvedValue({
      ok: false,
      error: "Couldn't reach the sign-in service. Try again.",
    })
    render(<MfaCard mode="enrol" required={false} />)
    expect(
      screen.getByText(/each time you sign in to this account/)
    ).toBeTruthy()
    fireEvent.click(
      screen.getByRole("button", { name: "Set up with an authenticator app" })
    )
    expect(
      await screen.findByText("Couldn't reach the sign-in service. Try again.")
    ).toBeTruthy()
  })
})
