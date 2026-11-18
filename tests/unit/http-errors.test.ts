// The shared error envelope (spec §13; lib/server/http/errors.ts): distinct
// codes and statuses, a field and next action, retryable only for service
// failures, and never database text in what reaches a person.
import { describe, expect, it } from "vitest"

import {
  apiError,
  errorResponse,
  fromDbError,
  toApiError,
  type ApiErrorCode,
} from "@/lib/server/http/errors"

describe("apiError", () => {
  it("gives every code a distinct meaning, status and next action", () => {
    const expected: Record<ApiErrorCode, number> = {
      unauthenticated: 401,
      account_inactive: 403,
      forbidden: 403,
      not_found: 404,
      invalid_input: 400,
      stale_version: 409,
      conflict: 409,
      unsupported_media: 415,
      too_large: 413,
      unavailable: 503,
    }
    for (const [code, status] of Object.entries(expected)) {
      const e = apiError(code as ApiErrorCode)
      expect(e.status).toBe(status)
      expect(e.nextAction.length).toBeGreaterThan(0)
      expect(e.retryable).toBe(code === "unavailable")
    }
  })

  it("keeps the file and field it is about", () => {
    expect(
      apiError("too_large", { fileId: "f1", field: "file" })
    ).toMatchObject({ fileId: "f1", field: "file", status: 413 })
  })
})

describe("fromDbError", () => {
  it("maps by exception message and SQLSTATE", () => {
    expect(fromDbError({ message: "not_admin", code: "42501" }).code).toBe(
      "forbidden"
    )
    expect(
      fromDbError({ message: "not_active_user", code: "P0001" }).code
    ).toBe("account_inactive")
    expect(fromDbError({ message: "stale_revision", code: "40001" }).code).toBe(
      "stale_version"
    )
    expect(fromDbError({ message: "invalid_patch", code: "22023" }).code).toBe(
      "invalid_input"
    )
    expect(
      fromDbError(
        { message: "invalid_quiet_hours", code: "22023" },
        { invalid_quiet_hours: { field: "quietStart", message: "Use 21:00." } }
      )
    ).toMatchObject({ field: "quietStart", message: "Use 21:00." })
  })

  it("never shows database text for an unknown failure", () => {
    const e = fromDbError({
      message: 'relation "secret_table" does not exist',
      code: "42P01",
    })
    expect(e).toMatchObject({ code: "unavailable", retryable: true })
    expect(e.message).not.toContain("secret_table")
  })
})

describe("toApiError", () => {
  it("maps domain failures and keeps their plain words", () => {
    expect(
      toApiError({ code: "not_permitted", status: 403, message: "No." })
    ).toMatchObject({ code: "forbidden", message: "No." })
    expect(
      toApiError({
        code: "revision_conflict",
        status: 409,
        message: "Changed.",
      })
    ).toMatchObject({ code: "stale_version" })
    expect(
      toApiError({
        code: "invalid_input",
        status: 400,
        message: "Check it.",
        fieldErrors: { reason: "Required" },
      })
    ).toMatchObject({ field: "reason" })
    expect(toApiError({ status: 503, message: "Later." })).toMatchObject({
      code: "unavailable",
      retryable: true,
    })
  })
})

describe("errorResponse", () => {
  it("answers with the envelope, uncached, with Retry-After when retryable", async () => {
    const response = errorResponse(apiError("unavailable"))
    expect(response.status).toBe(503)
    expect(response.headers.get("Cache-Control")).toContain("no-store")
    expect(response.headers.get("Retry-After")).toBe("30")
    expect((await response.json()).error).toMatchObject({
      code: "unavailable",
      retryable: true,
    })
    expect(
      errorResponse(apiError("forbidden")).headers.get("Retry-After")
    ).toBeNull()
  })
})
