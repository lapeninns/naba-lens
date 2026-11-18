// S3-R11 (20261118129000): Suspend from use withdraws every approval.
//   W8  a photo accepted on a facility check that was later archived (or put
//       out of scope) is suspended, and its other approvals go with it; the
//       whole call no longer rolls back on amenity_photo_not_found.
//   W9  an admin can suspend a photo they uploaded once a place or facility
//       accepted it (no self_review_not_allowed); the Library still refuses
//       everyone who is not an aal2 admin.
// Real signed-in identities through PostgREST; psql builds fixtures and reads
// state back.
import { beforeAll, describe, expect, it } from "vitest"

import { type TestIdentity } from "../support/identities"
import { fails, ok, psql } from "./coverage-fixtures"
import { photo, world, yes, type World } from "./knowledge-fixtures"

let w: World

beforeAll(async () => {
  w = await world("s3-r11-suspend")
})

type Suspended = {
  changed: boolean
  slots: { dishes: number; places: number; facilities: number }
}

const suspend = (who: TestIdentity, asset: string, reason: string) =>
  who.client.rpc(
    "library_suspend_asset" as never,
    {
      p_asset_id: asset,
      p_reason: reason,
    } as never
  ) as unknown as Promise<{
    data: unknown
    error: { message: string; code?: string } | null
  }>

/** A facility answer by `who` with one photo, accepted by the manager. */
async function acceptedFacilityPhoto(who: TestIdentity, key: string) {
  const answer = await yes(who, w, key)
  const asset = psql(
    `select sa.asset_id from public.amenity_submission_assets sa
     where sa.submission_id = '${answer.submissionId}' limit 1`
  )
  await ok(
    w.manager.client.rpc("review_decide_amenity_photo", {
      p_check_id: w.checks[key]!,
      p_asset_id: asset,
      p_action: "accepted",
    })
  )
  return asset
}

/** Labels `asset` with a new place (added by its uploader), accepted by the manager. */
function acceptPlace(asset: string): string {
  return psql(
    `with a as (
       select id, venue_id, uploader_id from public.media_assets where id = '${asset}'
     ), s as (
       insert into public.knowledge_subjects (venue_id, kind, label, created_by)
       select a.venue_id, 'area', 'Suspend ' || left(md5(random()::text), 8), '${w.admin.id}'
       from a returning id, venue_id
     ), l as (
       insert into public.media_area_labels (asset_id, venue_id, subject_id, subject_kind, subject_label, added_by)
       select a.id, s.venue_id, s.id, 'area', 'Suspend place', a.uploader_id
       from s, a returning id, venue_id, asset_id
     )
     insert into public.area_photo_decisions (label_id, venue_id, asset_id, action, decided_by)
     select l.id, l.venue_id, l.asset_id, 'accepted', '${w.manager.id}' from l
     returning label_id`
  )
}

const latestFacility = (asset: string) =>
  psql(
    `select d.action || ':' || coalesce(d.reason, '') || ':' || (d.decided_by = '${w.admin.id}')
     from public.amenity_photo_decisions d
     where d.asset_id = '${asset}' order by d.id desc limit 1`
  )

const latestPlace = (label: string) =>
  psql(
    `select d.action || ':' || (d.decided_by = '${w.admin.id}')
     from public.area_photo_decisions d
     where d.label_id = '${label}' order by d.id desc limit 1`
  )

describe("W8: an archived facility check does not block Suspend from use", () => {
  it("withdraws the place and the archived check's approvals, and the Library use", async () => {
    const asset = await acceptedFacilityPhoto(w.staffA, "onsite_parking")
    const label = acceptPlace(asset)
    const check = w.checks.onsite_parking!
    // The check is archived (amenity_archive_check is no longer granted, so
    // the fixture sets the state it leaves); the acceptance stays in history.
    const setStatus = (status: string) =>
      psql(
        `update public.venue_amenity_checks set status = '${status}', revision = revision + 1
         where id = '${check}' returning status`
      )
    setStatus("archived")
    expect(
      psql(
        `select status from public.venue_amenity_checks where id = '${check}'`
      )
    ).toBe("archived")

    const { data, error } = await suspend(w.admin, asset, "Wrong car park")
    expect(error).toBeNull()
    expect(data as Suspended).toMatchObject({
      changed: true,
      slots: { dishes: 0, places: 1, facilities: 1 },
    })
    expect(latestPlace(label)).toBe("withdrawn:true")
    expect(latestFacility(asset)).toBe("withdrawn:Wrong car park:true")
    expect(psql(`select private.library_is_withdrawn('${asset}')::text`)).toBe(
      "true"
    )

    // Restoring the check does not bring the suspended photo back.
    setStatus("active")
    expect(
      psql(
        `select count(*) from private.amenity_photo_rows('${w.venue}') r
         where r.asset_id = '${asset}' and r.state = 'accepted'`
      )
    ).toBe("0")

    // A repeat writes nothing more.
    const again = await suspend(w.admin, asset, "Again")
    expect(again.error).toBeNull()
    expect((again.data as Suspended).changed).toBe(false)
    expect(
      psql(
        `select count(*) from public.amenity_photo_decisions where asset_id = '${asset}' and action = 'withdrawn'`
      )
    ).toBe("1")
  })
})

describe("W9: an admin suspends a photo they uploaded", () => {
  it("withdraws the facility and place approvals of the admin's own photo", async () => {
    const asset = await acceptedFacilityPhoto(w.admin, "guest_toilets")
    expect(
      psql(
        `select uploader_id = '${w.admin.id}' from public.media_assets where id = '${asset}'`
      )
    ).toBe("t")
    const label = acceptPlace(asset)

    const { data, error } = await suspend(w.admin, asset, "Not our toilets")
    expect(error).toBeNull()
    expect(data as Suspended).toMatchObject({
      changed: true,
      slots: { dishes: 0, places: 1, facilities: 1 },
    })
    expect(latestFacility(asset)).toBe("withdrawn:Not our toilets:true")
    expect(latestPlace(label)).toBe("withdrawn:true")
  })

  it("still refuses everyone who is not an admin, and writes nothing", async () => {
    const asset = await photo(w.staffB.id, w.venue)
    const label = acceptPlace(asset)
    for (const who of [w.manager, w.staffB, w.staffA]) {
      await fails(suspend(who, asset, "Nope"), "not_permitted")
    }
    expect(
      psql(
        `select count(*) from public.area_photo_decisions where asset_id = '${asset}' and action = 'withdrawn'`
      )
    ).toBe("0")
    expect(latestPlace(label)).toBe("accepted:false")
  })
})
