import { beforeAll, describe, expect, it } from "vitest"

import { getStaffAccount, updateStaffAccount } from "@/lib/server/accounts"
import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"

const service = serviceClient()
let admin: TestIdentity
let colleague: TestIdentity

beforeAll(async () => {
  const venue = await createVenue(service, "department")
  admin = await createIdentity(service, {
    label: "department-admin",
    role: "admin",
  })
  colleague = await createIdentity(service, {
    label: "department-staff",
    role: "staff",
    venueId: venue.id,
  })
})

describe("admin-managed staff departments", () => {
  it("leaves existing/new staff unassigned until an admin assigns them", async () => {
    const { data } = await colleague.client
      .from("profiles")
      .select("department")
      .eq("id", colleague.id)
      .single()
    expect(data?.department).toBeNull()
    const result = await updateStaffAccount(
      { caller: admin.client, service },
      colleague.id,
      { department: "foh" }
    )
    expect(result).toEqual({ ok: true })
    const account = await getStaffAccount(
      { caller: admin.client, service },
      colleague.id
    )
    expect(account.ok && account.staff.department).toBe("foh")
  })

  it("refuses a staff member's department change through both app and direct database", async () => {
    await service
      .from("profiles")
      .update({ department: "foh" })
      .eq("id", colleague.id)
    expect(
      await updateStaffAccount(
        { caller: colleague.client, service },
        colleague.id,
        { department: "boh" }
      )
    ).toMatchObject({ ok: false, code: "forbidden" })
    const direct = await colleague.client
      .from("profiles")
      .update({ department: "boh" })
      .eq("id", colleague.id)
    expect(direct.error?.message).toBe("admin_only_fields")
    const { data } = await colleague.client
      .from("profiles")
      .select("department")
      .eq("id", colleague.id)
      .single()
    expect(data?.department).toBe("foh")
  })

  it("rejects unknown departments and lets an admin clear an assignment", async () => {
    expect(
      await updateStaffAccount(
        { caller: admin.client, service },
        colleague.id,
        { department: "management" }
      )
    ).toMatchObject({ ok: false, code: "invalid_input" })
    const direct = await admin.client
      .from("profiles")
      .update({ department: "management" })
      .eq("id", colleague.id)
    expect(direct.error?.code).toBe("23514")
    expect(
      await updateStaffAccount(
        { caller: admin.client, service },
        colleague.id,
        { department: null }
      )
    ).toEqual({ ok: true })
    const account = await getStaffAccount(
      { caller: admin.client, service },
      colleague.id
    )
    expect(account.ok && account.staff.department).toBeNull()
  })
})
