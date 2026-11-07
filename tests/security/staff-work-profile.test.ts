// Self-described work profiles (public.staff_work_profiles): staff write only
// their own row, only through the three RPCs, only while active staff; the
// admin-maintained profile fields never change; the table checks hold for the
// service role too; colleagues cannot read the row. Real identities.
import { beforeAll, describe, expect, it } from "vitest"

import { loadProfile } from "@/lib/auth/profile"
import { saveWorkProfile } from "@/lib/server/accounts/work-profile"

import {
  anonClient,
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import { fails, ok } from "./coverage-fixtures"

const service = serviceClient()
let venue: string
let admin: TestIdentity
let staffer: TestIdentity
let colleague: TestIdentity
let inactive: TestIdentity
let fresh: TestIdentity

const save = (
  who: TestIdentity,
  roleKey: string | null,
  roleTitle: string | null = null,
  areas: (string | null)[] | null = []
) =>
  who.client.rpc("save_work_profile", {
    p_role_key: roleKey as string,
    p_role_title: roleTitle as string,
    p_work_areas: areas as string[],
  })

async function stored(staffId: string) {
  const { data, error } = await service
    .from("staff_work_profiles")
    .select("*")
    .eq("staff_id", staffId)
    .maybeSingle()
  if (error) throw error
  return data
}

async function adminFields(staffId: string) {
  const { data, error } = await service
    .from("profiles")
    .select("display_name, job_title, department, role, venue_id, active")
    .eq("id", staffId)
    .single()
  if (error) throw error
  return data
}

beforeAll(async () => {
  venue = (await createVenue(service, "work-profile")).id
  admin = await createIdentity(service, { label: "wp-admin", role: "admin" })
  staffer = await createIdentity(service, {
    label: "wp-staff",
    role: "staff",
    venueId: venue,
  })
  colleague = await createIdentity(service, {
    label: "wp-colleague",
    role: "staff",
    venueId: venue,
  })
  inactive = await createIdentity(service, {
    label: "wp-inactive",
    role: "staff",
    venueId: venue,
    active: false,
  })
  fresh = await createIdentity(service, {
    label: "wp-fresh",
    role: "staff",
    venueId: venue,
  })
  const { error } = await service
    .from("profiles")
    .update({ job_title: "TEST Head chef", department: "boh" })
    .eq("id", staffer.id)
  if (error) throw error
})

describe("own row through the RPCs", () => {
  it("saves the caller's own row, ordered and deduplicated", async () => {
    const before = await adminFields(staffer.id)
    const row = await ok(
      save(staffer, "curry_chef", null, ["bar", "curry", "bar"])
    )
    expect(row).toMatchObject({
      staff_id: staffer.id,
      role_key: "curry_chef",
      role_title: null,
      work_areas: ["curry", "bar"],
      skipped_at: null,
    })
    expect(row.completed_at).not.toBeNull()
    expect(await adminFields(staffer.id)).toEqual(before)
  })

  it("skips without losing the role and keeps the first completion", async () => {
    const first = (await stored(staffer.id))!
    const skipped = await ok(staffer.client.rpc("skip_work_profile"))
    expect(skipped.role_key).toBe("curry_chef")
    expect(skipped.skipped_at).not.toBeNull()

    const saved = await ok(save(staffer, "other", "  TEST Pastry lead ", null))
    expect(saved).toMatchObject({
      role_key: "other",
      role_title: "TEST Pastry lead",
      work_areas: [],
      skipped_at: null,
      completed_at: first.completed_at,
    })
  })

  it("dismisses the welcome guide and shows it again", async () => {
    const on = await ok(
      staffer.client.rpc("set_welcome_dismissed", { p_dismissed: true })
    )
    expect(on.welcome_dismissed_at).not.toBeNull()
    const again = await ok(
      staffer.client.rpc("set_welcome_dismissed", { p_dismissed: true })
    )
    expect(again.welcome_dismissed_at).toBe(on.welcome_dismissed_at)
    const off = await ok(
      staffer.client.rpc("set_welcome_dismissed", { p_dismissed: false })
    )
    expect(off.welcome_dismissed_at).toBeNull()
    expect(off.role_key).toBe("other")
  })

  it("creates a row on a first skip or dismissal without a role", async () => {
    const row = await ok(
      fresh.client.rpc("set_welcome_dismissed", { p_dismissed: true })
    )
    expect(row).toMatchObject({
      staff_id: fresh.id,
      role_key: null,
      completed_at: null,
      work_areas: [],
    })
  })

  it("goes through the app's server module", async () => {
    const result = await saveWorkProfile(
      { db: colleague.client },
      {
        roleKey: "bartender",
        workAreas: ["service"],
        staffId: staffer.id,
      }
    )
    expect(result).toMatchObject({
      ok: true,
      work: { roleKey: "bartender", workAreas: ["service"] },
    })
    expect((await stored(staffer.id))!.role_key).toBe("other")
  })

  it("loads the row with the profile, or null without one", async () => {
    const own = await loadProfile(staffer.client, staffer.id, staffer.email)
    expect(own?.work).toMatchObject({
      roleKey: "other",
      roleTitle: "TEST Pastry lead",
      welcomeDismissedAt: null,
    })
    expect(own?.jobTitle).toBe("TEST Head chef")
    const none = await createIdentity(service, {
      label: "wp-none",
      role: "staff",
      venueId: venue,
    })
    expect((await loadProfile(none.client, none.id, none.email))?.work).toBe(
      null
    )
  })
})

describe("refusals", () => {
  it("rejects bad roles, titles and areas", async () => {
    await fails(save(staffer, "owner"), "invalid_work_role", "22023")
    await fails(save(staffer, null), "invalid_work_role", "22023")
    await fails(save(staffer, "other", "  "), "work_role_title_required")
    await fails(
      save(staffer, "other", "x".repeat(41)),
      "invalid_work_role_title"
    )
    await fails(save(staffer, "host", "TEST Title"), "invalid_work_role_title")
    await fails(save(staffer, "host", null, ["office"]), "invalid_work_areas")
    await fails(
      save(staffer, "host", null, ["bar", null]),
      "invalid_work_areas"
    )
    expect((await stored(staffer.id))!.role_key).toBe("other")
  })

  it("rejects inactive staff, admins and anonymous callers", async () => {
    await fails(save(inactive, "server"), "work_profile_forbidden", "42501")
    await fails(
      inactive.client.rpc("skip_work_profile"),
      "work_profile_forbidden"
    )
    await fails(
      inactive.client.rpc("set_welcome_dismissed", { p_dismissed: true }),
      "work_profile_forbidden"
    )
    await fails(save(admin, "manager"), "work_profile_forbidden", "42501")
    const { error } = await anonClient().rpc("skip_work_profile")
    expect(error).not.toBeNull()
    expect(await stored(inactive.id)).toBeNull()
    expect(await stored(admin.id)).toBeNull()
  })

  it("allows no direct insert, update or delete", async () => {
    const insert = await colleague.client.from("staff_work_profiles").insert({
      staff_id: colleague.id,
      role_key: "manager",
      completed_at: new Date().toISOString(),
    })
    expect(insert.error?.code).toBe("42501")

    const update = await staffer.client
      .from("staff_work_profiles")
      .update({ role_key: "manager" })
      .eq("staff_id", staffer.id)
    expect(update.error?.code).toBe("42501")

    const remove = await staffer.client
      .from("staff_work_profiles")
      .delete()
      .eq("staff_id", staffer.id)
    expect(remove.error?.code).toBe("42501")

    const adminUpdate = await admin.client
      .from("staff_work_profiles")
      .update({ role_key: "manager" })
      .eq("staff_id", staffer.id)
    expect(adminUpdate.error?.code).toBe("42501")
    expect((await stored(staffer.id))!.role_key).toBe("other")
  })
})

describe("reads", () => {
  it("shows the row to its owner and admins only", async () => {
    const own = await staffer.client
      .from("staff_work_profiles")
      .select("staff_id")
    expect(own.error).toBeNull()
    expect(own.data).toEqual([{ staff_id: staffer.id }])

    const other = await colleague.client
      .from("staff_work_profiles")
      .select("staff_id")
      .eq("staff_id", staffer.id)
    expect(other.error).toBeNull()
    expect(other.data).toEqual([])

    const asAdmin = await admin.client
      .from("staff_work_profiles")
      .select("staff_id, role_key")
      .eq("staff_id", staffer.id)
    expect(asAdmin.data).toEqual([{ staff_id: staffer.id, role_key: "other" }])

    const anon = await anonClient()
      .from("staff_work_profiles")
      .select("staff_id")
    expect(anon.data ?? []).toEqual([])
  })

  it("hides the owner's row once they are deactivated", async () => {
    const who = await createIdentity(service, {
      label: "wp-leaver",
      role: "staff",
      venueId: venue,
    })
    await ok(save(who, "server"))
    await service.from("profiles").update({ active: false }).eq("id", who.id)
    const { data } = await who.client
      .from("staff_work_profiles")
      .select("staff_id")
    expect(data ?? []).toEqual([])
  })
})

describe("table checks (service role too)", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["unknown role", { role_key: "owner", completed_at: "now()" }],
    ["unknown area", { work_areas: ["office"] }],
    ["repeated area", { work_areas: ["bar", "bar"] }],
    ["null area", { work_areas: ["bar", null] }],
    [
      "title for a listed role",
      { role_key: "host", role_title: "TEST", completed_at: "now()" },
    ],
    ["other without a title", { role_key: "other", completed_at: "now()" }],
    [
      "long title",
      { role_key: "other", role_title: "x".repeat(41), completed_at: "now()" },
    ],
    [
      "untrimmed title",
      { role_key: "other", role_title: " TEST ", completed_at: "now()" },
    ],
    ["role without completion", { role_key: "host" }],
    ["completion without role", { completed_at: "now()" }],
  ]

  it.each(cases)("rejects %s", async (_name, values) => {
    const who = await createIdentity(service, {
      label: "wp-check",
      role: "staff",
      venueId: venue,
      session: false,
    })
    const row = Object.fromEntries(
      Object.entries(values).map(([k, v]) => [
        k,
        v === "now()" ? new Date().toISOString() : v,
      ])
    )
    const { error } = await service
      .from("staff_work_profiles")
      .insert({ staff_id: who.id, ...row })
    expect(error?.code).toBe("23514")
  })

  it("removes the row with the profile", async () => {
    const who = await createIdentity(service, {
      label: "wp-cascade",
      role: "staff",
      venueId: venue,
    })
    await ok(save(who, "host"))
    const { error } = await service.from("profiles").delete().eq("id", who.id)
    expect(error).toBeNull()
    expect(await stored(who.id)).toBeNull()
  })
})
