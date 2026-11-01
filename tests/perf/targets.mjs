// Picks the people, venues, items and cursor positions each measurement uses,
// from the PERF rows currently in the database (so they follow the volume).
import { query } from "./lib.mjs"

const PERF = "(select id from public.venues where slug like 'perf-venue-%')"
const READY_FEED = `deleted_at is null and upload_state = 'ready' and venue_id in ${PERF}`

const one = (dbUrl, sql) => query(dbUrl, sql)[0] ?? []

export function pickTargets(dbUrl) {
  const t = {}

  const venues = query(
    dbUrl,
    `select v.id, v.name, v.slug, count(a.id)
     from public.venues v left join public.media_assets a on a.venue_id = v.id and a.deleted_at is null
     where v.slug like 'perf-venue-%' group by 1, 2, 3 order by 4 desc, 3`
  ).map(([id, name, slug, n]) => ({ id, name, slug, media: Number(n) }))
  t.venues = venues
  t.bigVenue = venues[0]
  t.smallVenue = venues[venues.length - 1]
  t.midVenue = venues[Math.floor(venues.length / 2)]

  t.admin = {
    email: "perf-admin-1@perf.nabalens.test",
    ...(() => {
      const [id] = one(dbUrl, `select id from auth.users where email = 'perf-admin-1@perf.nabalens.test'`)
      return { id, role: "admin", venueId: null, displayName: "PERF Admin 1" }
    })(),
  }

  const staff = query(
    dbUrl,
    `select p.id, u.email, p.display_name, p.venue_id, p.active, count(a.id)
     from public.profiles p join auth.users u on u.id = p.id
     left join public.media_assets a on a.uploader_id = p.id and a.deleted_at is null
     where p.role = 'staff' and u.email like 'perf-staff-%' and p.active
     group by 1, 2, 3, 4, 5 having count(a.id) > 0 order by 6 desc`
  ).map(([id, email, displayName, venueId, , n]) => ({
    id, email, displayName, venueId, role: "staff", media: Number(n),
  }))
  t.staffHeavy = staff[0]
  t.staffMedian = staff[Math.floor(staff.length / 2)]
  t.staffLight = staff[staff.length - 1]
  t.staffCount = staff.length

  // Counts of the feeds the cursors point into.
  t.readyFeed = Number(one(dbUrl, `select count(*) from public.media_assets where ${READY_FEED}`)[0])
  const feedCursor = (where, frac) => {
    const [n] = one(dbUrl, `select count(*) from public.media_assets where ${where}`)
    const off = Math.max(0, Math.floor(Number(n) * frac) - 1)
    const [createdAt, id] = one(
      dbUrl,
      `select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"'), id
       from public.media_assets where ${where} order by created_at desc, id desc offset ${off} limit 1`
    )
    return { createdAt, id, offset: off, of: Number(n) }
  }
  t.cursors = {
    feed: [0.1, 0.5, 0.9].map((f) => ({ frac: f, ...feedCursor(READY_FEED, f) })),
    bigVenue: [0.5, 0.9].map((f) => ({
      frac: f, ...feedCursor(`${READY_FEED} and venue_id = '${t.bigVenue.id}'`, f),
    })),
    staffHeavyOwn: [0.5, 0.9].map((f) => ({
      frac: f,
      ...feedCursor(`deleted_at is null and uploader_id = '${t.staffHeavy.id}'`, f),
    })),
    staffMedianOwn: [0.5].map((f) => ({
      frac: f,
      ...feedCursor(`deleted_at is null and uploader_id = '${t.staffMedian.id}'`, f),
    })),
    heavyStaffAdmin: [0.5, 0.9].map((f) => ({
      frac: f,
      ...feedCursor(`${READY_FEED} and uploader_id = '${t.staffHeavy.id}'`, f),
    })),
    category: [0.5].map((f) => ({
      frac: f,
      ...feedCursor(
        `${READY_FEED} and exists (select 1 from public.media_label_items li where li.asset_id = media_assets.id and li.section_slug = 'curries')`,
        f
      ),
    })),
  }

  // Label targets inside the big venue.
  const items = query(
    dbUrl,
    `select li.item_id, count(*) from public.media_label_items li
     where li.venue_id = '${t.bigVenue.id}' group by 1 order by 2 desc`
  )
  t.popularItem = { id: items[0][0], labels: Number(items[0][1]) }
  const rare = items.find(([, n]) => Number(n) <= 3) ?? items[items.length - 1]
  t.rareItem = { id: rare[0], labels: Number(rare[1]) }
  const [variantId, variantN] = one(
    dbUrl,
    `select variant_id, count(*) from public.media_label_items where venue_id = '${t.bigVenue.id}' and variant_id is not null group by 1 order by 2 desc limit 1`
  )
  t.popularVariant = { id: variantId, labels: Number(variantN) }
  t.category = "curries"
  t.categoryRows = Number(
    one(dbUrl, `select count(distinct li.asset_id) from public.media_label_items li where li.section_slug = 'curries'`)[0]
  )

  // Menu versions of the big venue.
  const versions = query(
    dbUrl,
    `select id, status, revision, (select count(*) from public.menu_entries e where e.version_id = v.id)
     from public.menu_versions v where venue_id = '${t.bigVenue.id}' order by created_at`
  ).map(([id, status, revision, entries]) => ({ id, status, revision: Number(revision), entries: Number(entries) }))
  t.bigVenueVersions = versions
  t.activeVersion = versions.find((v) => v.status === "active")
  t.retiredVersion = versions.find((v) => v.status === "retired")
  const [smallActive] = one(
    dbUrl,
    `select id from public.menu_versions where venue_id = '${t.smallVenue.id}' and status = 'active'`
  )
  t.smallActiveVersion = smallActive

  // Ten ready image assets of the heavy staff member, for the editor context.
  t.heavyAssets = query(
    dbUrl,
    `select id from public.media_assets where uploader_id = '${t.staffHeavy.id}' and ${READY_FEED} and media_type = 'image' order by created_at desc limit 10`
  ).map(([id]) => id)
  t.label = {
    labelledAssets: Number(one(dbUrl, `select count(*) from public.media_labels where venue_id in ${PERF}`)[0]),
    labelItems: Number(one(dbUrl, `select count(*) from public.media_label_items where venue_id in ${PERF}`)[0]),
  }
  t.dayRanges = one(
    dbUrl,
    `select to_char(current_date - 7, 'YYYY-MM-DD'), to_char(current_date - 90, 'YYYY-MM-DD'), to_char(current_date, 'YYYY-MM-DD')`
  )
  return t
}
