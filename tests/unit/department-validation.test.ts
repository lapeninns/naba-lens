import { describe, expect, it } from "vitest"

import {
  parseAccountPatch,
  parseInviteInput,
} from "@/lib/server/accounts/validation"

const invite = {
  displayName: "TEST Colleague",
  email: "test@example.invalid",
  venueId: "05c4846a-6479-4455-8bcd-3d20d172a893",
}

describe("department assignment validation", () => {
  it("accepts FOH/BOH and explicit clearing without changing application roles", () => {
    expect(parseAccountPatch({ department: "foh", role: "admin" })).toEqual({
      ok: true,
      value: { department: "foh" },
    })
    expect(parseAccountPatch({ department: "boh" })).toEqual({
      ok: true,
      value: { department: "boh" },
    })
    expect(parseAccountPatch({ department: null })).toEqual({
      ok: true,
      value: { department: null },
    })
    expect(parseAccountPatch({ displayName: "TEST Name" })).toEqual({
      ok: true,
      value: { displayName: "TEST Name" },
    })
  })

  it.each(["FOH", "manager", "", false, 1, {}, []])(
    "rejects invalid department %j before writing",
    (department) => {
      expect(parseAccountPatch({ department })).toMatchObject({
        ok: false,
        fieldErrors: { department: expect.any(String) },
      })
      expect(parseInviteInput({ ...invite, department })).toMatchObject({
        ok: false,
        fieldErrors: { department: expect.any(String) },
      })
    }
  )

  it("keeps invitations unassigned unless an admin supplies a department", () => {
    expect(parseInviteInput(invite)).toMatchObject({
      ok: true,
      value: { department: null },
    })
    expect(parseInviteInput({ ...invite, department: "boh" })).toMatchObject({
      ok: true,
      value: { department: "boh" },
    })
  })
})
