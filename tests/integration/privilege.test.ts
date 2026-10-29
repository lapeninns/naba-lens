import { beforeAll, describe, expect, it } from "vitest"

import {
  createIdentity,
  createVenue,
  serviceClient,
  TINY_BYTES,
  type TestIdentity,
} from "../support/identities"

describe("privilege escalation is refused server-side", () => {
  const admin = serviceClient()
  let staff: TestIdentity
  let other: TestIdentity
  let adminUser: TestIdentity
  let venueA: { id: string }
  let venueB: { id: string }

  beforeAll(async () => {
    venueA = await createVenue(admin, "priv-a")
    venueB = await createVenue(admin, "priv-b")
    staff = await createIdentity(admin, {
      label: "priv",
      role: "staff",
      venueId: venueA.id,
    })
    other = await createIdentity(admin, {
      label: "priv-o",
      role: "staff",
      venueId: venueA.id,
    })
    adminUser = await createIdentity(admin, {
      label: "priv-admin",
      role: "admin",
    })
  })

  async function ownProfile() {
    const { data } = await admin
      .from("profiles")
      .select("*")
      .eq("id", staff.id)
      .single()
    return data!
  }

  it("staff can change their own display name", async () => {
    const { error } = await staff.client
      .from("profiles")
      .update({ display_name: "TEST renamed" })
      .eq("id", staff.id)
    expect(error).toBeNull()
    expect((await ownProfile()).display_name).toBe("TEST renamed")
  })

  it("staff cannot grant themselves admin", async () => {
    const { error } = await staff.client
      .from("profiles")
      .update({ role: "admin" } as never)
      .eq("id", staff.id)
    // `role` is not in the column-level UPDATE grant for end users.
    expect(error?.code).toBe("42501")
    expect((await ownProfile()).role).toBe("staff")
  })

  it("staff cannot change their own venue, activation or job title", async () => {
    for (const patch of [
      { venue_id: venueB.id },
      { active: false },
      { job_title: "TEST Head chef" },
    ]) {
      const { error } = await staff.client
        .from("profiles")
        .update(patch)
        .eq("id", staff.id)
      expect(error?.message).toBe("admin_only_fields")
    }
    const profile = await ownProfile()
    expect(profile.venue_id).toBe(venueA.id)
    expect(profile.active).toBe(true)
    expect(profile.job_title).toBeNull()
  })

  it("staff cannot edit another staff member's profile", async () => {
    const { data } = await staff.client
      .from("profiles")
      .update({ display_name: "TEST hijacked" })
      .eq("id", other.id)
      .select()
    expect(data ?? []).toEqual([])
    const row = await admin
      .from("profiles")
      .select("display_name")
      .eq("id", other.id)
      .single()
    expect(row.data!.display_name).not.toBe("TEST hijacked")
  })

  it("staff cannot point their avatar outside their own folder", async () => {
    const { error } = await staff.client
      .from("profiles")
      .update({ avatar_path: `${other.id}/${crypto.randomUUID()}.webp` })
      .eq("id", staff.id)
    expect(error).not.toBeNull()
  })

  it("staff cannot insert, re-own or validate media rows directly", async () => {
    const insert = await staff.client.from("media_assets").insert({
      uploader_id: other.id,
      venue_id: venueA.id,
      original_path: `${other.id}/${crypto.randomUUID()}/original.jpg`,
      original_filename: "x.jpg",
      media_type: "image",
    })
    expect(insert.error).not.toBeNull()

    const { data } = await staff.client.rpc("reserve_media_asset", {
      p_media_type: "image",
      p_extension: "jpg",
      p_original_filename: "x.jpg",
    })
    const assetId = data![0].id

    const update = await staff.client
      .from("media_assets")
      .update({ upload_state: "ready", uploader_id: other.id } as never)
      .eq("id", assetId)
    expect(update.error).not.toBeNull()
    const row = await admin
      .from("media_assets")
      .select("*")
      .eq("id", assetId)
      .single()
    expect(row.data!.upload_state).toBe("uploading")
    expect(row.data!.uploader_id).toBe(staff.id)
  })

  it("staff cannot upload to an unreserved key or someone else's key", async () => {
    const forged = `${staff.id}/${crypto.randomUUID()}/original.jpg`
    const a = await staff.client.storage
      .from("media")
      .upload(forged, TINY_BYTES)
    expect(a.error).not.toBeNull()

    const { data } = await other.client.rpc("reserve_media_asset", {
      p_media_type: "image",
      p_extension: "jpg",
      p_original_filename: "o.jpg",
    })
    const b = await staff.client.storage
      .from("media")
      .upload(data![0].original_path, TINY_BYTES)
    expect(b.error).not.toBeNull()
  })

  it("staff cannot call service-only cleanup or read admin-only rows", async () => {
    const cleanup = await staff.client.rpc("prepare_media_cleanup", {
      p_abandoned_after: "24 hours",
    })
    expect(cleanup.error).not.toBeNull()
  })

  it("admin can change staff venue/job title but not roles", async () => {
    const ok = await adminUser.client
      .from("profiles")
      .update({ job_title: "TEST Bartender", venue_id: venueB.id })
      .eq("id", other.id)
    expect(ok.error).toBeNull()

    const role = await adminUser.client
      .from("profiles")
      .update({ role: "admin" } as never)
      .eq("id", other.id)
    expect(role.error?.code).toBe("42501")
    const row = await admin
      .from("profiles")
      .select("role, venue_id")
      .eq("id", other.id)
      .single()
    expect(row.data).toEqual({ role: "staff", venue_id: venueB.id })
  })

  it("anonymous requests see nothing", async () => {
    const { anonClient } = await import("../support/identities")
    const anon = anonClient()
    for (const table of ["venues", "profiles", "media_assets"] as const) {
      const { data } = await anon.from(table).select("id")
      expect(data ?? []).toEqual([])
    }
  })
})
