// S3-R3 V7 and K2 (AC11, AC12, review R10). A staff member who works at two
// venues matches photos at A, then switches to B before some of them have
// their turn. The app sends A with each reservation (p_venue_id): the
// database must refuse it while B is active, rather than reserve the photo at
// B. A reservation made at A before the switch still finishes at A, and
// stops once the membership at A ends.
import { randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it } from "vitest"

import {
  createIdentity,
  createVenue,
  type TestIdentity,
} from "../support/identities"
import { ok, psql } from "./coverage-fixtures"
import { admin, service } from "./knowledge-fixtures"

let venueA: string
let venueB: string
let person: TestIdentity
let adminId: TestIdentity

const reserveAt = (venueId?: string) =>
  person.client.rpc("reserve_media_asset", {
    p_client_upload_key: randomUUID(),
    p_size_bytes: 4,
    p_media_type: "image",
    p_extension: "jpg",
    p_original_filename: "TEST match-venue.jpg",
    ...(venueId ? { p_venue_id: venueId } : {}),
  })
const switchTo = (venueId: string) =>
  ok(person.client.rpc("switch_active_venue", { p_venue_id: venueId }))
const allowed = (assetId: string) =>
  psql(
    `select private.media_upload_venue_allowed(a.uploader_id, a.uploader_role, a.venue_id)
     from public.media_assets a where a.id = '${assetId}'`
  )

beforeAll(async () => {
  adminId = await admin()
  ;[venueA, venueB] = (
    await Promise.all([
      createVenue(service, "r3-match-a"),
      createVenue(service, "r3-match-b"),
    ])
  ).map((v) => v.id)
  person = await createIdentity(service, {
    label: "r3-match-staff",
    role: "staff",
    venueId: venueA,
  })
  await ok(
    adminId.client.rpc("admin_set_venue_membership", {
      p_profile_id: person.id,
      p_venue_id: venueB,
      p_role: "staff",
      p_reason: "TEST covers shifts at B",
    })
  )
})

describe("a matched photo is reserved only at the venue it was matched for", () => {
  it("refuses A's photo once B is active, and never reserves it at B", async () => {
    await switchTo(venueA)
    const atA = await reserveAt(venueA)
    expect(atA.error).toBeNull()
    expect(atA.data![0]!.venue_id).toBe(venueA)

    await switchTo(venueB)
    const before = psql(
      `select count(*) from public.media_assets where uploader_id = '${person.id}'`
    )
    const refused = await reserveAt(venueA)
    expect(refused.error?.message).toBe("wrong_venue")
    expect(
      psql(
        `select count(*) from public.media_assets where uploader_id = '${person.id}'`
      )
    ).toBe(before)

    // B's own photos still go to B.
    const atB = await reserveAt(venueB)
    expect(atB.error).toBeNull()
    expect(atB.data![0]!.venue_id).toBe(venueB)
  })

  it("lets a reservation made at A finish after the switch, until A's membership ends (K2)", async () => {
    await switchTo(venueA)
    const atA = await reserveAt(venueA)
    expect(atA.error).toBeNull()
    const assetId = atA.data![0]!.id
    await switchTo(venueB)
    expect(allowed(assetId)).toBe("t")

    await ok(
      adminId.client.rpc("remove_venue_member", {
        p_profile_id: person.id,
        p_venue_id: venueA,
        p_reason: "TEST left A",
      })
    )
    expect(allowed(assetId)).toBe("f")
  })
})
