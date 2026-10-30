import sharp from "sharp"
import { beforeAll, describe, expect, it } from "vitest"

import { loadProfile, toAuthState } from "@/lib/auth/profile"
import { createAvatarDerivative } from "@/lib/media"
import {
  getStaffAccount,
  inviteStaff,
  listAssignableVenues,
  listStaffDirectory,
  replaceProfileAvatar,
  resendInvitation,
  resolveCaller,
  setStaffActive,
  updateStaffAccount,
  type AccountsContext,
  type InviteMailer,
} from "@/lib/server/accounts"
import { listLibrary } from "@/lib/server/media/library"

import { actorFor } from "../slice/media-actor"

import {
  anonClient,
  createIdentity,
  createVenue,
  markReady,
  serviceClient,
  signIn,
  testEmail,
  TINY_BYTES,
  type Db,
  type TestIdentity,
} from "../support/identities"
import { getLocalSupabaseEnv } from "../support/local-supabase"

/** /admin/staff/[id]: the admin library filtered to one contributor. */
async function portfolioOf(adminIdentity: TestIdentity, staffId: string) {
  return listLibrary(await actorFor(adminIdentity), {
    venueId: null,
    staffId,
    type: null,
  })
}

const service = serviceClient()
const ctxFor = (caller: Db, mailer?: InviteMailer): AccountsContext => ({
  caller,
  service,
  mailer,
})
const failingMailer: InviteMailer = async () => ({
  error: { code: "unexpected_failure", message: "SMTP down (simulated)" },
})

async function authUsersWithEmail(email: string) {
  const { data, error } = await service.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  })
  if (error) throw error
  return data.users.filter((u) => u.email === email)
}

async function profileOf(id: string) {
  const { data } = await service
    .from("profiles")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  return data
}

/** Invitation emails for one address in the stack's Mailpit inbox. */
async function inviteEmailCount(email: string, atLeast = 0): Promise<number> {
  const mailpit = getLocalSupabaseEnv().mailpitUrl
  if (!mailpit) throw new Error("Mailpit URL unavailable")
  let count = 0
  for (let attempt = 0; attempt < 20; attempt++) {
    const search = await fetch(
      `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${email}" subject:"invited"`)}`
    ).then((r) => r.json())
    count = search.messages_count ?? 0
    if (count >= atLeast) return count
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return count
}

async function reserve(client: Db) {
  const { data, error } = await client.rpc("reserve_media_asset", {
    p_media_type: "image",
    p_extension: "jpg",
    p_original_filename: "dish.jpg",
  })
  return { row: data?.[0] ?? null, error }
}

let venueA: { id: string; name: string }
let venueB: { id: string; name: string }
let inactiveVenue: { id: string }
let adminUser: TestIdentity

beforeAll(async () => {
  venueA = await createVenue(service, "acc-a")
  venueB = await createVenue(service, "acc-b")
  inactiveVenue = await createVenue(service, "acc-off", false)
  adminUser = await createIdentity(service, {
    label: "acc-admin",
    role: "admin",
  })
})

describe("invite staff", () => {
  it("creates one staff account and sends the invitation email", async () => {
    const email = testEmail("invite-new")
    const result = await inviteStaff(ctxFor(adminUser.client), {
      displayName: "  TEST Invited Chef ",
      email: email.toUpperCase(),
      jobTitle: "TEST Tandoori chef",
      venueId: venueA.id,
      // Ignored: invitations can never create admins.
      role: "admin",
    })
    expect(result.status).toBe("sent")
    if (result.status !== "sent") return

    const users = await authUsersWithEmail(email)
    expect(users).toHaveLength(1)
    expect(users[0].id).toBe(result.userId)
    expect(users[0].email_confirmed_at ?? null).toBeNull()

    const profile = await profileOf(result.userId)
    expect(profile).toMatchObject({
      display_name: "TEST Invited Chef",
      job_title: "TEST Tandoori chef",
      role: "staff",
      venue_id: venueA.id,
      active: true,
    })
    expect(await inviteEmailCount(email, 1)).toBe(1)

    const account = await getStaffAccount(
      ctxFor(adminUser.client),
      result.userId
    )
    expect(account.ok && account.staff.status).toBe("invited")
    expect(account.ok && account.staff.email).toBe(email)
  })

  it("the invited person can accept and lands as active staff", async () => {
    const email = testEmail("invite-accept")
    const result = await inviteStaff(ctxFor(adminUser.client), {
      displayName: "TEST Accepting",
      email,
      jobTitle: "",
      venueId: venueA.id,
    })
    expect(result.status).toBe("sent")
    if (result.status !== "sent") return

    const client = await signIn(service, email)
    const profile = await loadProfile(client, result.userId, email)
    expect(toAuthState({ id: result.userId, email }, profile).status).toBe(
      "active"
    )
    expect(profile?.role).toBe("staff")
    expect(profile?.jobTitle).toBeNull()
    const account = await getStaffAccount(
      ctxFor(adminUser.client),
      result.userId
    )
    expect(account.ok && account.staff.status).toBe("active")
  })

  it("refuses a duplicate email without creating anything", async () => {
    const email = testEmail("invite-dup")
    const first = await inviteStaff(ctxFor(adminUser.client), {
      displayName: "TEST Dup",
      email,
      jobTitle: "",
      venueId: venueA.id,
    })
    expect(first.status).toBe("sent")

    const second = await inviteStaff(ctxFor(adminUser.client), {
      displayName: "TEST Dup again",
      email,
      jobTitle: "",
      venueId: venueB.id,
    })
    expect(second).toMatchObject({
      status: "error",
      code: "email_exists",
      fieldErrors: { email: expect.any(String) },
    })
    expect(await authUsersWithEmail(email)).toHaveLength(1)
    if (first.status === "sent") {
      expect((await profileOf(first.userId))?.venue_id).toBe(venueA.id)
    }
  })

  it("refuses an existing signed-in account's email", async () => {
    const staff = await createIdentity(service, {
      label: "invite-existing",
      role: "staff",
      venueId: venueA.id,
    })
    const result = await inviteStaff(ctxFor(adminUser.client), {
      displayName: "TEST Existing",
      email: staff.email,
      jobTitle: "",
      venueId: venueB.id,
    })
    expect(result).toMatchObject({ status: "error", code: "email_exists" })
    expect((await profileOf(staff.id))?.venue_id).toBe(venueA.id)
    expect(await authUsersWithEmail(staff.email)).toHaveLength(1)
  })

  it("concurrent invitations for one email create exactly one account", async () => {
    const email = testEmail("invite-race")
    const input = {
      displayName: "TEST Race",
      email,
      jobTitle: "",
      venueId: venueA.id,
    }
    const results = await Promise.all([
      inviteStaff(ctxFor(adminUser.client), input),
      inviteStaff(ctxFor(adminUser.client), input),
    ])
    expect(results.filter((r) => r.status === "sent")).toHaveLength(1)
    expect(results.filter((r) => r.status === "error")).toHaveLength(1)
    expect(await authUsersWithEmail(email)).toHaveLength(1)
  })

  it("rejects an inactive venue before creating an auth user", async () => {
    const email = testEmail("invite-inactive-venue")
    const result = await inviteStaff(ctxFor(adminUser.client), {
      displayName: "TEST Nowhere",
      email,
      jobTitle: "",
      venueId: inactiveVenue.id,
    })
    expect(result).toMatchObject({
      status: "error",
      code: "venue_inactive",
      fieldErrors: { venueId: expect.any(String) },
    })
    expect(await authUsersWithEmail(email)).toHaveLength(0)
  })

  it("validates input server-side", async () => {
    const result = await inviteStaff(ctxFor(adminUser.client), {
      displayName: "",
      email: "not-an-email",
      venueId: "venue-a",
    })
    expect(result).toMatchObject({
      status: "error",
      code: "invalid_input",
      fieldErrors: {
        displayName: expect.any(String),
        email: expect.any(String),
        venueId: expect.any(String),
      },
    })
  })

  it("an email failure is reported as partial and recovered by resend", async () => {
    const email = testEmail("invite-mailfail")
    const result = await inviteStaff(ctxFor(adminUser.client, failingMailer), {
      displayName: "TEST Mail fail",
      email,
      jobTitle: "",
      venueId: venueA.id,
    })
    expect(result.status).toBe("partial")
    if (result.status !== "partial") return
    expect(await inviteEmailCount(email)).toBe(0)

    // The account exists once and shows as Invited.
    expect(await authUsersWithEmail(email)).toHaveLength(1)
    expect((await profileOf(result.userId))?.role).toBe("staff")
    const account = await getStaffAccount(
      ctxFor(adminUser.client),
      result.userId
    )
    expect(account.ok && account.staff.status).toBe("invited")

    // Inviting again is refused (no duplicate); resend delivers the email.
    const again = await inviteStaff(ctxFor(adminUser.client), {
      displayName: "TEST Mail fail",
      email,
      jobTitle: "",
      venueId: venueA.id,
    })
    expect(again).toMatchObject({ status: "error", code: "email_exists" })
    const failedResend = await resendInvitation(
      ctxFor(adminUser.client, failingMailer),
      result.userId
    )
    expect(failedResend).toMatchObject({ ok: false, code: "auth_failed" })

    expect(
      await resendInvitation(ctxFor(adminUser.client), result.userId)
    ).toEqual({ ok: true })
    expect(await inviteEmailCount(email, 1)).toBe(1)
    expect(await authUsersWithEmail(email)).toHaveLength(1)
  })

  it("a retry adopts an auth user left without a profile by an interrupted invite", async () => {
    const email = testEmail("invite-orphan")
    const { data } = await service.auth.admin.createUser({
      email,
      email_confirm: false,
      user_metadata: { nabalens_invite: true },
    })
    const orphanId = data.user!.id

    const result = await inviteStaff(ctxFor(adminUser.client), {
      displayName: "TEST Orphan",
      email,
      jobTitle: "",
      venueId: venueA.id,
    })
    expect(result).toEqual({ status: "sent", userId: orphanId })
    expect(await authUsersWithEmail(email)).toHaveLength(1)
    expect((await profileOf(orphanId))?.role).toBe("staff")
  })

  it("does not adopt an unrelated auth user without a profile", async () => {
    const email = testEmail("invite-foreign")
    const { data } = await service.auth.admin.createUser({
      email,
      email_confirm: true,
    })
    const result = await inviteStaff(ctxFor(adminUser.client), {
      displayName: "TEST Foreign",
      email,
      jobTitle: "",
      venueId: venueA.id,
    })
    expect(result).toMatchObject({ status: "error", code: "email_exists" })
    expect(await profileOf(data.user!.id)).toBeNull()
  })
})

describe("resend invitation", () => {
  it("refuses accounts that already signed in, or are inactive", async () => {
    const staff = await createIdentity(service, {
      label: "resend-signed-in",
      role: "staff",
      venueId: venueA.id,
    })
    expect(
      await resendInvitation(ctxFor(adminUser.client), staff.id)
    ).toMatchObject({ ok: false, code: "already_signed_in" })

    const email = testEmail("resend-inactive")
    const invited = await inviteStaff(ctxFor(adminUser.client), {
      displayName: "TEST Resend inactive",
      email,
      jobTitle: "",
      venueId: venueA.id,
    })
    if (invited.status !== "sent") throw new Error("invite failed")
    await setStaffActive(ctxFor(adminUser.client), invited.userId, false)
    expect(
      await resendInvitation(ctxFor(adminUser.client), invited.userId)
    ).toMatchObject({ ok: false, code: "account_inactive" })
  })

  it("does not resend to admins", async () => {
    const other = await createIdentity(service, {
      label: "resend-admin",
      role: "admin",
      session: false,
    })
    expect(
      await resendInvitation(ctxFor(adminUser.client), other.id)
    ).toMatchObject({ ok: false, code: "not_found" })
  })
})

describe("staff cannot use admin account operations", () => {
  let staff: TestIdentity
  let victim: TestIdentity

  beforeAll(async () => {
    staff = await createIdentity(service, {
      label: "acc-attacker",
      role: "staff",
      venueId: venueA.id,
    })
    victim = await createIdentity(service, {
      label: "acc-victim",
      role: "staff",
      venueId: venueA.id,
    })
  })

  it("every admin operation refuses an active staff caller with no side effects", async () => {
    const ctx = ctxFor(staff.client)
    const email = testEmail("staff-invite")

    expect(
      await inviteStaff(ctx, {
        displayName: "TEST Sneaky",
        email,
        jobTitle: "",
        venueId: venueA.id,
      })
    ).toMatchObject({ status: "error", code: "forbidden" })
    expect(await authUsersWithEmail(email)).toHaveLength(0)

    expect(await resendInvitation(ctx, victim.id)).toMatchObject({
      ok: false,
      code: "forbidden",
    })
    expect(
      await updateStaffAccount(ctx, staff.id, { venueId: venueB.id })
    ).toMatchObject({ ok: false, code: "forbidden" })
    expect(
      await updateStaffAccount(ctx, victim.id, { displayName: "TEST hacked" })
    ).toMatchObject({ ok: false, code: "forbidden" })
    expect(await setStaffActive(ctx, victim.id, false)).toMatchObject({
      ok: false,
      code: "forbidden",
    })
    expect(await listStaffDirectory(ctx)).toMatchObject({
      ok: false,
      code: "forbidden",
    })
    expect(await getStaffAccount(ctx, victim.id)).toMatchObject({
      ok: false,
      code: "forbidden",
    })
    expect(await listAssignableVenues(ctx)).toMatchObject({
      ok: false,
      code: "forbidden",
    })
    expect(
      await listLibrary(await actorFor(staff), {
        venueId: null,
        staffId: victim.id,
        type: null,
      })
    ).toMatchObject({ ok: false, status: 403 })
    expect(
      await replaceProfileAvatar(ctx, victim.id, TINY_BYTES, async () => {
        throw new Error("must not be reached")
      })
      // RLS hides other staff profiles, so this looks like an unknown account.
    ).toMatchObject({ ok: false, code: "not_found" })

    const victimProfile = await profileOf(victim.id)
    expect(victimProfile).toMatchObject({
      display_name: "TEST acc-victim",
      active: true,
      venue_id: venueA.id,
    })
    expect((await profileOf(staff.id))?.venue_id).toBe(venueA.id)
  })

  it("signed-out and inactive-admin callers are refused too", async () => {
    expect(await listStaffDirectory(ctxFor(anonClient()))).toMatchObject({
      ok: false,
      code: "unauthenticated",
    })
    const inactiveAdmin = await createIdentity(service, {
      label: "acc-admin-off",
      role: "admin",
      active: false,
    })
    expect(
      await setStaffActive(ctxFor(inactiveAdmin.client), victim.id, false)
    ).toMatchObject({ ok: false, code: "forbidden" })
    expect((await profileOf(victim.id))?.active).toBe(true)
  })

  it("an admin cannot manage another admin through these operations", async () => {
    const otherAdmin = await createIdentity(service, {
      label: "acc-admin-2",
      role: "admin",
      session: false,
    })
    expect(
      await setStaffActive(ctxFor(adminUser.client), otherAdmin.id, false)
    ).toMatchObject({ ok: false, code: "not_found" })
    expect(
      await updateStaffAccount(ctxFor(adminUser.client), otherAdmin.id, {
        displayName: "TEST renamed admin",
      })
    ).toMatchObject({ ok: false, code: "not_found" })
    expect((await profileOf(otherAdmin.id))?.active).toBe(true)
  })
})

describe("staff cannot escalate through direct database updates", () => {
  let staff: TestIdentity
  let other: TestIdentity

  beforeAll(async () => {
    staff = await createIdentity(service, {
      label: "esc",
      role: "staff",
      venueId: venueA.id,
    })
    other = await createIdentity(service, {
      label: "esc-other",
      role: "staff",
      venueId: venueA.id,
    })
  })

  it("cannot change role, activation, venue or job title on their own row", async () => {
    const role = await staff.client
      .from("profiles")
      .update({ role: "admin" } as never)
      .eq("id", staff.id)
    expect(role.error?.code).toBe("42501")

    for (const patch of [
      { venue_id: venueB.id },
      { active: false },
      { job_title: "TEST Owner" },
    ]) {
      const { error } = await staff.client
        .from("profiles")
        .update(patch)
        .eq("id", staff.id)
      expect(error?.message).toBe("admin_only_fields")
    }
    expect(await profileOf(staff.id)).toMatchObject({
      role: "staff",
      active: true,
      venue_id: venueA.id,
      job_title: null,
    })
  })

  it("cannot edit another staff member, create profiles or invite through auth", async () => {
    const { data } = await staff.client
      .from("profiles")
      .update({ display_name: "TEST hijacked" })
      .eq("id", other.id)
      .select()
    expect(data ?? []).toEqual([])
    expect((await profileOf(other.id))?.display_name).toBe("TEST esc-other")

    const insert = await staff.client.from("profiles").insert({
      id: staff.id,
      display_name: "TEST dup",
      role: "admin",
    } as never)
    expect(insert.error).not.toBeNull()

    // The admin auth API refuses a user JWT.
    const invite = await staff.client.auth.admin.inviteUserByEmail(
      testEmail("esc-invite")
    )
    expect(invite.error).not.toBeNull()
  })

  it("an admin cannot change roles directly either", async () => {
    const { error } = await adminUser.client
      .from("profiles")
      .update({ role: "admin" } as never)
      .eq("id", staff.id)
    expect(error?.code).toBe("42501")
    expect((await profileOf(staff.id))?.role).toBe("staff")
  })
})

describe("venue transfer", () => {
  it("applies to future uploads only", async () => {
    const staff = await createIdentity(service, {
      label: "transfer",
      role: "staff",
      venueId: venueA.id,
    })
    const before = await reserve(staff.client)
    expect(before.error).toBeNull()
    expect(before.row?.venue_id).toBe(venueA.id)
    await markReady(service, before.row!.id)

    expect(
      await updateStaffAccount(ctxFor(adminUser.client), staff.id, {
        venueId: venueB.id,
        jobTitle: "TEST Bartender",
      })
    ).toEqual({ ok: true })

    const after = await reserve(staff.client)
    expect(after.error).toBeNull()
    expect(after.row?.venue_id).toBe(venueB.id)

    const { data: old } = await service
      .from("media_assets")
      .select("venue_id")
      .eq("id", before.row!.id)
      .single()
    expect(old?.venue_id).toBe(venueA.id)

    const portfolio = await portfolioOf(adminUser, staff.id)
    expect(portfolio.ok && portfolio.items.map((i) => i.venueName)).toEqual([
      venueA.name,
    ])
    expect((await profileOf(staff.id))?.job_title).toBe("TEST Bartender")
  })

  it("rejects an inactive venue", async () => {
    const staff = await createIdentity(service, {
      label: "transfer-off",
      role: "staff",
      venueId: venueA.id,
      session: false,
    })
    expect(
      await updateStaffAccount(ctxFor(adminUser.client), staff.id, {
        venueId: inactiveVenue.id,
      })
    ).toMatchObject({
      ok: false,
      code: "venue_inactive",
      fieldErrors: { venueId: expect.any(String) },
    })
    // The database refuses it even when the app check is bypassed.
    const direct = await adminUser.client
      .from("profiles")
      .update({ venue_id: inactiveVenue.id })
      .eq("id", staff.id)
    expect(direct.error?.message).toBe("venue_inactive")
    expect((await profileOf(staff.id))?.venue_id).toBe(venueA.id)

    const venues = await listAssignableVenues(ctxFor(adminUser.client))
    expect(venues.ok && venues.venues.map((v) => v.id)).not.toContain(
      inactiveVenue.id
    )
  })
})

describe("deactivation and reactivation", () => {
  let staff: TestIdentity
  let assetId: string

  beforeAll(async () => {
    staff = await createIdentity(service, {
      label: "lifecycle",
      role: "staff",
      venueId: venueA.id,
    })
    const { row, error } = await reserve(staff.client)
    if (error) throw error
    const upload = await staff.client.storage
      .from("media")
      .upload(row!.original_path, TINY_BYTES)
    if (upload.error) throw upload.error
    await markReady(service, row!.id)
    assetId = row!.id
  })

  it("denies the existing session on its next request", async () => {
    // A live session before deactivation.
    const { data: session } = await staff.client.auth.getSession()
    expect(session.session).not.toBeNull()

    expect(
      await setStaffActive(ctxFor(adminUser.client), staff.id, false)
    ).toEqual({ ok: true })

    // The same session is now refused by the app's guard and by RLS.
    const profile = await loadProfile(staff.client, staff.id, staff.email)
    expect(
      toAuthState({ id: staff.id, email: staff.email }, profile).status
    ).toBe("inactive")
    expect(await resolveCaller(staff.client)).toEqual({
      ok: false,
      code: "forbidden",
    })
    expect((await reserve(staff.client)).error?.message).toBe(
      "not_active_staff"
    )
    expect((await staff.client.from("media_assets").select("id")).data).toEqual(
      []
    )

    // Its refresh token is revoked as well (auth user banned).
    const refreshed = await staff.client.auth.refreshSession()
    expect(refreshed.error).not.toBeNull()

    const account = await getStaffAccount(ctxFor(adminUser.client), staff.id)
    expect(account.ok && account.staff.status).toBe("inactive")
  })

  it("keeps retained media visible to admin", async () => {
    const portfolio = await portfolioOf(adminUser, staff.id)
    expect(portfolio.ok && portfolio.items.map((i) => i.id)).toEqual([assetId])
  })

  it("an admin cannot deactivate themself", async () => {
    const { error } = await adminUser.client
      .from("profiles")
      .update({ active: false })
      .eq("id", adminUser.id)
    expect(error?.message).toBe("self_deactivation_forbidden")
  })

  it("reactivation restores access with a new sign-in", async () => {
    expect(
      await setStaffActive(ctxFor(adminUser.client), staff.id, true)
    ).toEqual({ ok: true })
    const client = await signIn(service, staff.email)
    expect(await resolveCaller(client)).toMatchObject({ ok: true })
    const again = await reserve(client)
    expect(again.error).toBeNull()
    expect(again.row?.venue_id).toBe(venueA.id)
    expect(
      (await client.from("media_assets").select("id").eq("id", assetId)).data
    ).toHaveLength(1)

    const account = await getStaffAccount(ctxFor(adminUser.client), staff.id)
    expect(account.ok && account.staff.status).toBe("active")
  })

  it("the edit form's active switch goes through the same path", async () => {
    expect(
      await updateStaffAccount(ctxFor(adminUser.client), staff.id, {
        displayName: "TEST Lifecycle renamed",
        active: false,
      })
    ).toEqual({ ok: true })
    expect(await profileOf(staff.id)).toMatchObject({
      display_name: "TEST Lifecycle renamed",
      active: false,
    })
    const { data } = await service.auth.admin.getUserById(staff.id)
    expect(data.user?.banned_until).toBeTruthy()
    await setStaffActive(ctxFor(adminUser.client), staff.id, true)
  })
})

describe("directory and portfolio data", () => {
  it("lists staff (not admins) with status, venue and email", async () => {
    const staff = await createIdentity(service, {
      label: "dir",
      role: "staff",
      venueId: venueB.id,
    })
    const result = await listStaffDirectory(ctxFor(adminUser.client))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const entry = result.staff.find((s) => s.id === staff.id)
    expect(entry).toMatchObject({
      displayName: "TEST dir",
      venueName: venueB.name,
      email: staff.email,
      status: "active",
    })
    expect(result.staff.some((s) => s.id === adminUser.id)).toBe(false)
  })

  it("pages one person's ready media newest first", async () => {
    const staff = await createIdentity(service, {
      label: "pages",
      role: "staff",
      venueId: venueA.id,
    })
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const { row } = await reserve(staff.client)
      await markReady(service, row!.id)
      ids.push(row!.id)
    }
    // Not ready: never listed.
    await reserve(staff.client)

    // Multi-page cursor behaviour is covered in tests/integration/library.test.ts.
    const result = await portfolioOf(adminUser, staff.id)
    if (!result.ok) throw new Error(result.message)
    expect(result.items.map((i) => i.id)).toEqual([...ids].reverse())
    expect(result.nextCursor).toBeNull()
    expect(
      await listLibrary(
        await actorFor(adminUser),
        { venueId: null, staffId: staff.id, type: null },
        "garbage"
      )
    ).toMatchObject({ ok: false, status: 400 })
  })
})

describe("profile photo", () => {
  it("admin replaces a staff photo; the old object is removed", async () => {
    const staff = await createIdentity(service, {
      label: "avatar",
      role: "staff",
      venueId: venueA.id,
    })
    const derive = async (bytes: Uint8Array) =>
      new Uint8Array(await createAvatarDerivative(bytes))

    const small = new Uint8Array(
      await sharp({
        create: { width: 64, height: 64, channels: 3, background: "#c33" },
      })
        .png()
        .toBuffer()
    )
    const first = await replaceProfileAvatar(
      ctxFor(adminUser.client),
      staff.id,
      small,
      derive
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.avatarPath).toMatch(
      new RegExp(`^${staff.id}/[0-9a-f-]{36}\\.webp$`)
    )

    const second = await replaceProfileAvatar(
      ctxFor(staff.client),
      staff.id,
      small,
      derive
    )
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect((await profileOf(staff.id))?.avatar_path).toBe(second.avatarPath)

    const { data: objects } = await service.storage
      .from("avatars")
      .list(staff.id)
    expect(objects?.map((o) => `${staff.id}/${o.name}`)).toEqual([
      second.avatarPath,
    ])

    const account = await getStaffAccount(ctxFor(adminUser.client), staff.id)
    expect(account.ok && account.staff.avatarUrl).toMatch(/^http/)
  })

  it("rejects oversized and undecodable photos", async () => {
    const staff = await createIdentity(service, {
      label: "avatar-bad",
      role: "staff",
      venueId: venueA.id,
      session: false,
    })
    const derive = async (bytes: Uint8Array) =>
      new Uint8Array(await createAvatarDerivative(bytes))
    expect(
      await replaceProfileAvatar(
        ctxFor(adminUser.client),
        staff.id,
        new Uint8Array(5 * 1024 * 1024 + 1),
        derive
      )
    ).toMatchObject({ ok: false, code: "invalid_input" })
    expect(
      await replaceProfileAvatar(
        ctxFor(adminUser.client),
        staff.id,
        new TextEncoder().encode("<svg onload=alert(1)>"),
        derive
      )
    ).toMatchObject({ ok: false, code: "invalid_input" })
    expect((await profileOf(staff.id))?.avatar_path).toBeNull()
  })
})
