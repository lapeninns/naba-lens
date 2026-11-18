// S1-PRIVACY (spec §3.2, §3.3, §16; decisions FA-20, FA-21, FA-23):
//   20261118107000  colleagues read accepted media at their own venue only
//   20261118107100  accepted originals are kept; removal requests; admin
//                   removal with reason, impact token and publication check
//   20261118107200  admins act as admins only on an aal2 session
// Every new function is called as staff at the venue, a colleague, staff at
// another venue, the venue's manager, another venue's manager, an admin, an
// admin without the second step, an inactive account and anon. Real
// signed-in identities through PostgREST; psql and the service role only
// build fixtures and read state back.
import { randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it } from "vitest"

import {
  anonClient,
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import { elevateToAal2 } from "../support/totp"
import { makeManager, psql } from "./coverage-fixtures"
import { reserveReady } from "./menus-fixtures"
import { acceptAsset } from "./privacy-fixtures"

const service = serviceClient()

let venueA: string
let venueB: string
let admin: TestIdentity
/** An admin profile whose session never passed the second step. */
let adminAal1: TestIdentity
let manager: TestIdentity
let managerB: TestIdentity
let uploader: TestIdentity
let colleague: TestIdentity
let elsewhere: TestIdentity
let leaver: TestIdentity

type Rpc = { data: unknown; error: { message: string; code?: string } | null }
const rpc = (
  who: TestIdentity | null,
  fn: string,
  args: Record<string, unknown> = {}
) =>
  (who?.client ?? anonClient()).rpc(
    fn as never,
    args as never
  ) as unknown as Promise<Rpc>

async function refusedWith(call: Promise<Rpc>, message: string, code?: string) {
  const { data, error } = await call
  expect(data ?? null).toBeNull()
  expect(error?.message).toBe(message)
  if (code) expect(error?.code).toBe(code)
}

async function anonRefused(fn: string, args: Record<string, unknown>) {
  const { data, error } = await rpc(null, fn, args)
  expect(error).not.toBeNull()
  expect(data ?? null).toBeNull()
}

const readable = async (who: TestIdentity, ids: string[]) => {
  const { data, error } = await rpc(who, "community_readable_assets", {
    p_asset_ids: ids,
  })
  expect(error).toBeNull()
  return ((data as { id: string }[]) ?? []).map((r) => r.id).sort()
}

const ready = async (who: TestIdentity) => (await reserveReady(service, who)).id
const events = (asset: string) =>
  psql(
    `select coalesce(string_agg(action, ',' order by id), '') from public.media_removal_events where asset_id = '${asset}'`
  )

beforeAll(async () => {
  venueA = (await createVenue(service, "privacy-a")).id
  venueB = (await createVenue(service, "privacy-b")).id
  admin = await createIdentity(service, {
    label: "privacy-admin",
    role: "admin",
  })
  // Staff at sign-in (no second step), then made admin: an aal1 admin.
  adminAal1 = await createIdentity(service, {
    label: "privacy-admin-aal1",
    role: "staff",
    venueId: venueA,
  })
  const promoted = await service
    .from("profiles")
    .update({ role: "admin", venue_id: null })
    .eq("id", adminAal1.id)
  if (promoted.error) throw promoted.error
  const staff = (label: string, venueId: string) =>
    createIdentity(service, { label, role: "staff", venueId })
  manager = await staff("privacy-mgr", venueA)
  managerB = await staff("privacy-mgr-b", venueB)
  await makeManager(admin, manager, venueA)
  await makeManager(admin, managerB, venueB)
  uploader = await staff("privacy-uploader", venueA)
  colleague = await staff("privacy-colleague", venueA)
  elsewhere = await staff("privacy-elsewhere", venueB)
  leaver = await createIdentity(service, {
    label: "privacy-leaver",
    role: "staff",
    venueId: venueA,
    active: false,
  })
})

describe("colleague media (FA-20)", () => {
  it("shows a waiting photo to its uploader, the venue's manager scope and admins only", async () => {
    const waiting = await ready(uploader)
    expect(await readable(uploader, [waiting])).toEqual([waiting])
    expect(await readable(admin, [waiting])).toEqual([waiting])
    expect(await readable(colleague, [waiting])).toEqual([])
    expect(await readable(elsewhere, [waiting])).toEqual([])
    // A manager account reads nothing through the staff community (as before).
    expect(await readable(manager, [waiting])).toEqual([])
    expect(await readable(leaver, [waiting])).toEqual([])
    await anonRefused("community_readable_assets", { p_asset_ids: [waiting] })
  })

  it("shows an accepted photo to colleagues at its venue, never at another", async () => {
    const shown = await ready(uploader)
    acceptAsset(shown, admin.id)
    expect(await readable(colleague, [shown])).toEqual([shown])
    expect(await readable(elsewhere, [shown])).toEqual([])
    expect(await readable(leaver, [shown])).toEqual([])
    const feed = await rpc(colleague, "community_media_page", {
      p_uploader: uploader.id,
    })
    expect((feed.data as { id: string }[]).map((r) => r.id)).toContain(shown)
  })

  it("keeps the predicates private", () => {
    expect(
      psql(
        `select string_agg(has_function_privilege('anon', f, 'execute')::text, ',')
         from unnest(array['private.asset_is_accepted(uuid)', 'private.can_view_venue_album(uuid)',
           'private.media_visible_to_caller(uuid)']) f`
      )
    ).toBe("false,false,false")
  })
})

describe("withdrawing an upload (delete_media_asset, FA-21)", () => {
  it("lets the uploader withdraw an unreviewed upload, recorded once", async () => {
    const asset = await ready(uploader)
    expect(
      (await rpc(uploader, "delete_media_asset", { p_asset_id: asset })).error
    ).toBeNull()
    expect(
      (await rpc(uploader, "delete_media_asset", { p_asset_id: asset })).error
    ).toBeNull()
    expect(events(asset)).toBe("withdrawn")
  })

  it("keeps an accepted original, even from its uploader and an admin", async () => {
    const asset = await ready(uploader)
    acceptAsset(asset, admin.id)
    for (const who of [uploader, admin])
      await refusedWith(
        rpc(who, "delete_media_asset", { p_asset_id: asset }),
        "media_asset_retained",
        "P0001"
      )
    expect(
      psql(
        `select deleted_at is null from public.media_assets where id = '${asset}'`
      )
    ).toBe("t")
  })

  it("refuses a colleague, a manager, another venue, an inactive account and anon", async () => {
    const asset = await ready(uploader)
    for (const who of [colleague, manager, managerB, elsewhere, adminAal1])
      await refusedWith(
        rpc(who, "delete_media_asset", { p_asset_id: asset }),
        "media_asset_not_found",
        "P0002"
      )
    const own = await ready(colleague)
    await service
      .from("profiles")
      .update({ active: false })
      .eq("id", colleague.id)
    await refusedWith(
      rpc(colleague, "delete_media_asset", { p_asset_id: own }),
      "media_asset_not_found",
      "P0002"
    )
    await service
      .from("profiles")
      .update({ active: true })
      .eq("id", colleague.id)
    await anonRefused("delete_media_asset", { p_asset_id: asset })
  })
})

describe("removal requests (FA-21)", () => {
  let accepted: string
  let requestId: string

  beforeAll(async () => {
    accepted = await ready(uploader)
    acceptAsset(accepted, admin.id)
  })

  it("lets the uploader ask once for an accepted photo, with a reason", async () => {
    await refusedWith(
      rpc(uploader, "request_media_removal", {
        p_asset_id: accepted,
        p_reason: " x ",
      }),
      "reason_required",
      "22023"
    )
    const first = await rpc(uploader, "request_media_removal", {
      p_asset_id: accepted,
      p_reason: "Shows a guest's face",
    })
    expect(first.error).toBeNull()
    const made = first.data as { requestId: string; created: boolean }
    expect(made.created).toBe(true)
    requestId = made.requestId
    const again = await rpc(uploader, "request_media_removal", {
      p_asset_id: accepted,
      p_reason: "Asked again",
    })
    expect(again.data).toEqual({
      requestId,
      state: "open",
      created: false,
    })
    expect(events(accepted)).toBe("requested")
  })

  it("tells the uploader to withdraw an unreviewed upload instead", async () => {
    const waiting = await ready(uploader)
    await refusedWith(
      rpc(uploader, "request_media_removal", {
        p_asset_id: waiting,
        p_reason: "Wrong photo",
      }),
      "withdraw_instead",
      "P0001"
    )
  })

  it("lets the venue's manager ask, and nobody else", async () => {
    const byManager = await rpc(manager, "request_media_removal", {
      p_asset_id: accepted,
      p_reason: "Old menu",
    })
    expect(byManager.error).toBeNull()
    for (const who of [colleague, elsewhere, managerB])
      await refusedWith(
        rpc(who, "request_media_removal", {
          p_asset_id: accepted,
          p_reason: "Not mine",
        }),
        "media_asset_not_found",
        "P0002"
      )
    await refusedWith(
      rpc(leaver, "request_media_removal", {
        p_asset_id: accepted,
        p_reason: "Gone",
      }),
      "not_active_user",
      "42501"
    )
    await anonRefused("request_media_removal", {
      p_asset_id: accepted,
      p_reason: "Anon",
    })
  })

  it("lists requests to admins, the venue's manager and the requester only", async () => {
    const list = async (who: TestIdentity) => {
      const { data, error } = await rpc(who, "media_removal_requests", {
        p_state: "open",
      })
      expect(error).toBeNull()
      return (data as { requestId: string; assetId: string; mine: boolean }[])
        .filter((r) => r.assetId === accepted)
        .map((r) => r.mine)
    }
    expect(await list(uploader)).toEqual([true])
    expect((await list(manager)).sort()).toEqual([false, true])
    expect(await list(admin)).toEqual([false, false])
    for (const who of [colleague, elsewhere, managerB, adminAal1])
      expect(await list(who)).toEqual([])
    await refusedWith(
      rpc(admin, "media_removal_requests", { p_state: "nope" }),
      "invalid_state",
      "22023"
    )
    await anonRefused("media_removal_requests", {})
  })

  it("lets only the requester cancel, once", async () => {
    for (const who of [colleague, manager, admin])
      await refusedWith(
        rpc(who, "cancel_media_removal_request", { p_request_id: requestId }),
        "request_not_found",
        "P0002"
      )
    const cancelled = await rpc(uploader, "cancel_media_removal_request", {
      p_request_id: requestId,
    })
    expect(cancelled.data).toEqual({ requestId, state: "cancelled" })
    const again = await rpc(uploader, "cancel_media_removal_request", {
      p_request_id: requestId,
    })
    expect(again.data).toEqual({ requestId, state: "cancelled" })
  })

  it("lets only an aal2 admin decline, with a reason, and only while open", async () => {
    const open = (
      (
        await rpc(uploader, "request_media_removal", {
          p_asset_id: accepted,
          p_reason: "Please remove",
        })
      ).data as { requestId: string }
    ).requestId
    for (const who of [uploader, manager, adminAal1])
      await refusedWith(
        rpc(who, "decline_media_removal_request", {
          p_request_id: open,
          p_reason: "Keep it",
        }),
        "not_permitted",
        "42501"
      )
    await refusedWith(
      rpc(admin, "decline_media_removal_request", {
        p_request_id: open,
        p_reason: "",
      }),
      "reason_required"
    )
    const declined = await rpc(admin, "decline_media_removal_request", {
      p_request_id: open,
      p_reason: "Still on the menu",
    })
    expect(declined.data).toEqual({ requestId: open, state: "declined" })
    await refusedWith(
      rpc(admin, "decline_media_removal_request", {
        p_request_id: open,
        p_reason: "Twice",
      }),
      "request_closed"
    )
  })
})

describe("admin removal (FA-21)", () => {
  async function impact(who: TestIdentity, asset: string) {
    const { data, error } = await rpc(who, "media_removal_impact", {
      p_asset_id: asset,
    })
    if (error) throw new Error(error.message)
    return data as {
      token: string
      accepted: boolean
      blocked: boolean
      areas: unknown[]
      openRequests: number
      publicUses: number
    }
  }

  it("previews the impact to admins and the venue's manager only", async () => {
    const asset = await ready(uploader)
    acceptAsset(asset, admin.id)
    const seen = await impact(admin, asset)
    expect(seen).toMatchObject({
      accepted: true,
      blocked: false,
      publicUses: 0,
    })
    expect(seen.areas).toHaveLength(1)
    expect((await impact(manager, asset)).token).toBe(seen.token)
    for (const who of [uploader, colleague, elsewhere, managerB, adminAal1])
      await refusedWith(
        rpc(who, "media_removal_impact", { p_asset_id: asset }),
        "media_asset_not_found",
        "P0002"
      )
    await refusedWith(
      rpc(leaver, "media_removal_impact", { p_asset_id: asset }),
      "not_active_user"
    )
    await anonRefused("media_removal_impact", { p_asset_id: asset })
  })

  it("removes an accepted photo with a reason and the current token, closing requests", async () => {
    const asset = await ready(uploader)
    acceptAsset(asset, admin.id)
    const request = (
      (
        await rpc(uploader, "request_media_removal", {
          p_asset_id: asset,
          p_reason: "Shows paperwork",
        })
      ).data as { requestId: string }
    ).requestId
    const stale = (await impact(admin, asset)).token
    // A new request after the preview changes what the removal touches.
    await rpc(manager, "request_media_removal", {
      p_asset_id: asset,
      p_reason: "Agreed",
    })
    const args = (token: string, reason = "Personal information") => ({
      p_asset_id: asset,
      p_reason: reason,
      p_impact_token: token,
    })
    await refusedWith(
      rpc(admin, "admin_delete_media_asset", args(stale)),
      "impact_changed",
      "40001"
    )
    const token = (await impact(admin, asset)).token
    await refusedWith(
      rpc(admin, "admin_delete_media_asset", args(token, "no")),
      "reason_required"
    )
    for (const who of [uploader, manager, adminAal1])
      await refusedWith(
        rpc(who, "admin_delete_media_asset", args(token)),
        "not_permitted",
        "42501"
      )
    await anonRefused("admin_delete_media_asset", args(token))

    const removed = await rpc(admin, "admin_delete_media_asset", args(token))
    expect(removed.error).toBeNull()
    const closed = (removed.data as { closedRequests: string[] }).closedRequests
    expect(closed).toContain(request)
    expect(closed).toHaveLength(2)
    expect(
      psql(
        `select deleted_at is not null from public.media_assets where id = '${asset}'`
      )
    ).toBe("t")
    expect(
      psql(
        `select string_agg(distinct state, ',') from public.media_removal_requests where asset_id = '${asset}'`
      )
    ).toBe("completed")
    expect(events(asset)).toBe("requested,requested,removed,removed")
    expect(
      psql(
        `select reason || '|' || (impact ->> 'accepted') from public.media_removal_events where asset_id = '${asset}' and action = 'removed' limit 1`
      )
    ).toBe("Personal information|true")
    // Repeating is harmless.
    expect(
      (await rpc(admin, "admin_delete_media_asset", args("anything"))).data
    ).toMatchObject({ removed: true })
  })

  it("refuses while a public use is in force", async () => {
    const asset = await ready(uploader)
    acceptAsset(asset, admin.id)
    psql(`set session_replication_role = replica;
      insert into public.media_use_grants (asset_id, venue_id, destination_key, audience, purpose,
        subject_kind, derivative_profile_key, effective_from, authorised_by, authority_basis,
        clearance_version, clearance, request_key)
      values ('${asset}', '${venueA}', 'test_privacy_public', 'public', 'general_gallery', 'none',
        'website', now() - interval '1 hour', '${admin.id}', 'admin', 'test', '{}',
        'TESTprivacy${randomUUID().replaceAll("-", "")}')`)
    const seen = await impact(admin, asset)
    expect(seen).toMatchObject({ publicUses: 1, blocked: true })
    await refusedWith(
      rpc(admin, "admin_delete_media_asset", {
        p_asset_id: asset,
        p_reason: "Remove anyway",
        p_impact_token: seen.token,
      }),
      "media_asset_published",
      "P0001"
    )
  })
})

describe("tables and history", () => {
  it("gives clients no table access and keeps events append-only", async () => {
    for (const table of ["media_removal_requests", "media_removal_events"]) {
      const { error } = await admin.client.from(table as never).select("*")
      expect(error?.code, table).toBe("42501")
    }
    expect(() =>
      psql(
        `update public.media_removal_events set reason = 'x' where id = (select min(id) from public.media_removal_events)`
      )
    ).toThrow(/audit_append_only/)
  })
})

describe("admin second step (FA-23)", () => {
  it("reports the session level and verified factors to the caller", async () => {
    expect((await rpc(admin, "my_mfa_status")).data).toEqual({
      aal: "aal2",
      verifiedFactors: 1,
    })
    expect((await rpc(uploader, "my_mfa_status")).data).toEqual({
      aal: "aal1",
      verifiedFactors: 0,
    })
    await anonRefused("my_mfa_status", {})
  })

  it("treats an admin without the second step as no admin, until it is passed", async () => {
    await refusedWith(
      rpc(adminAal1, "menu_label_counts", { p_venue_id: venueA }),
      "not_active_admin",
      "42501"
    )
    expect(
      (await adminAal1.client.from("profiles").select("id")).data?.map(
        (r) => r.id
      )
    ).toEqual([adminAal1.id])
    await elevateToAal2(adminAal1.client)
    expect((await rpc(adminAal1, "my_mfa_status")).data).toEqual({
      aal: "aal2",
      verifiedFactors: 1,
    })
    expect(
      (await rpc(adminAal1, "menu_label_counts", { p_venue_id: venueA })).error
    ).toBeNull()
    expect(
      ((await adminAal1.client.from("profiles").select("id")).data ?? []).length
    ).toBeGreaterThan(1)
  })
})
