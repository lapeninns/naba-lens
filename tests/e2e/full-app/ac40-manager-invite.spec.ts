import { expect, test } from "@playwright/test"

import { getLocalSupabaseEnv } from "../../support/local-supabase"
import { signIn } from "../../support/identities"
import { keep, openAlbum, SIZES, sql } from "../helpers/full-app"
import { provisionManagerWorld } from "../helpers/manager-world"
import { provisioner, psql } from "../helpers/stack"
import { STAFF_LANDING } from "../helpers/ui"
import { signedInPage } from "../helpers/world"

/**
 * AC40 (spec §3.1, S1-PEOPLE): a venue manager invites a new person from
 * Team. The new account is staff, at that manager's venue only; the venue
 * can't be changed in the form, and the database refuses an invitation to
 * another venue before any login account is made.
 */

test.skip(({ browserName }) => browserName !== "chromium", "Chromium only")

async function invitationLink(email: string): Promise<string> {
  const mailpit = getLocalSupabaseEnv().mailpitUrl
  if (!mailpit) throw new Error("Mailpit URL unavailable")
  for (let attempt = 0; attempt < 60; attempt++) {
    const search = await fetch(
      `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${email}" subject:"invited"`)}&limit=1`
    ).then((r) => r.json())
    const id = search.messages?.[0]?.ID
    if (id) {
      const message = await fetch(`${mailpit}/api/v1/message/${id}`).then((r) =>
        r.json()
      )
      const match = String(message.HTML).match(
        /href="[^"]*(\/auth\/confirm\?[^"]+type=invite)"/
      )
      if (match) return match[1]!.replace(/&amp;/g, "&")
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error("No invitation email arrived in Mailpit.")
}

for (const size of ["narrow", "desktop"] as const) {
  test(`AC40 a manager's invitation makes a staff account at that manager's venue only (${size})`, async ({
    browser,
  }, info) => {
    test.setTimeout(180_000)
    const w = await provisionManagerWorld()
    const email = `e2e-ac40-${size}-${w.tag}@nabalens.test`
    const name = `DEV FIXTURE Invitee ${size} ${w.tag}`

    const manager = await signedInPage(browser, w.mgrA, SIZES[size])
    await manager.goto("/manager/team")
    await manager.getByRole("button", { name: "Invite staff" }).click()
    const dialog = manager.getByRole("dialog")
    await expect(
      dialog.getByRole("heading", { name: "Invite staff" })
    ).toBeVisible()
    // The venue is the manager's own and can't be changed here; no role field.
    await expect(dialog).toContainText(w.venueA.name)
    await expect(dialog).not.toContainText(w.venueB.name)
    await expect(dialog.getByRole("combobox", { name: /role/i })).toHaveCount(0)
    await dialog.getByLabel("Name").fill(name)
    await dialog.getByLabel("Email").fill(email)
    await keep(manager, info, `ac40-${size}-dialog`)
    await dialog.getByRole("button", { name: "Send invitation" }).click()
    await expect(
      dialog.getByRole("heading", { name: "Invitation sent" })
    ).toBeVisible()

    const profileId = psql(
      `select coalesce((select id::text from public.profiles where display_name = ${sql(name)}), '')`
    )
    expect(profileId).not.toBe("")
    expect(
      psql(
        `select role from public.profiles where id = ${sql(profileId)}::uuid`
      )
    ).toBe("staff")
    expect(
      psql(`select coalesce(string_agg(venue_id::text || ':' || role, ','), '')
        from public.venue_memberships
        where profile_id = ${sql(profileId)}::uuid and ended_at is null`)
    ).toBe(`${w.venueA.id}:staff`)

    // The invitee accepts and lands on Today as staff, and the album is
    // venue A's (DESIGN.md §5c, §5d).
    const invitee = await (await browser.newContext(SIZES[size])).newPage()
    await invitee.goto(await invitationLink(email))
    await invitee
      .getByRole("button", { name: "Accept your invitation" })
      .click()
    await expect(invitee).toHaveURL(STAFF_LANDING)
    await openAlbum(invitee)
    await expect(invitee.locator('[data-slot="album-landing"]')).toContainText(
      w.venueA.name
    )
    for (const path of ["/manager", "/admin"]) {
      await invitee.goto(path)
      await expect(invitee, path).toHaveURL(STAFF_LANDING)
    }
    await invitee.context().close()

    // The same manager can't invite to another venue, or as a manager.
    const db = await signIn(provisioner(), w.mgrA.email)
    const call = db.rpc.bind(db) as unknown as (
      n: string,
      a: Record<string, unknown>
    ) => PromiseLike<{ error: { message: string } | null }>
    const other = await call("manager_invite_staff", {
      p_user_id: profileId,
      p_venue_id: w.venueB.id,
      p_display_name: name,
    })
    expect(other.error, "invite to venue B").not.toBeNull()
    expect(
      psql(`select count(*) from public.venue_memberships
        where profile_id = ${sql(profileId)}::uuid and venue_id = ${sql(w.venueB.id)}::uuid`)
    ).toBe("0")
    await manager.context().close()
  })
}
