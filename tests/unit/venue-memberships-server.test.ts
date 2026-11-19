import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  CONTRIBUTION_NOTICE_VERSION,
  listMyVenues,
  switchMyVenue,
  venueRoleLabel,
} from "@/lib/auth/venues"
import type { AccountsContext, Db } from "@/lib/server/accounts/context"
import {
  inviteStaffToVenue,
  membershipError,
  removeVenueMember,
} from "@/lib/server/accounts/memberships"
import { parseVenueInviteInput } from "@/lib/server/accounts/validation"

// Server layer of per-venue memberships (S1-PEOPLE). The database decides
// every permission (tests/security/venue-memberships.test.ts); these tests
// pin the order of side effects and the words shown for each refusal.

vi.mock("@/lib/server/accounts/context", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/server/accounts/context")>()
  return {
    ...actual,
    resolveCaller: vi.fn(async () => ({
      ok: true,
      profile: { id: "manager", role: "manager", active: true },
    })),
  }
})

const VENUE = "22222222-2222-4222-8222-222222222222"
const USER = "33333333-3333-4333-8333-333333333333"

type RpcReply = {
  data: unknown
  error: { message: string; code: string } | null
}

function context(replies: Record<string, RpcReply>, existingUser = false) {
  const rpc = vi.fn(
    async (name: string) => replies[name] ?? { data: null, error: null }
  )
  const createUser = vi.fn(async () => ({
    data: { user: { id: USER } },
    error: null,
  }))
  const updateUserById = vi.fn(async () => ({ data: {}, error: null }))
  const listUsers = vi.fn(async () => ({
    data: {
      users: existingUser
        ? [
            {
              id: USER,
              email: "new@example.test",
              user_metadata: {},
              last_sign_in_at: "2026-01-01",
            },
          ]
        : [],
    },
    error: null,
  }))
  const maybeSingle = vi.fn(async () => ({ data: { id: USER }, error: null }))
  const caller = { rpc } as unknown as Db
  const service = {
    auth: { admin: { createUser, updateUserById, listUsers } },
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })),
    })),
  } as unknown as Db
  const mailer = vi.fn(async () => ({ error: null }))
  const ctx: AccountsContext = { caller, service, mailer }
  return { ctx, rpc, createUser, updateUserById, mailer }
}

const invite = {
  displayName: "Sam Server",
  email: "new@example.test",
  jobTitle: "",
  venueId: VENUE,
}

describe("inviteStaffToVenue", () => {
  beforeEach(() => vi.clearAllMocks())

  it("asks the database first and creates nothing for a venue the caller does not manage", async () => {
    const { ctx, createUser, mailer } = context({
      venue_team: {
        data: null,
        error: { message: "not_venue_manager", code: "42501" },
      },
    })
    expect(await inviteStaffToVenue(ctx, invite)).toMatchObject({
      status: "error",
      code: "forbidden",
    })
    expect(createUser).not.toHaveBeenCalled()
    expect(mailer).not.toHaveBeenCalled()
  })

  it("creates the invited user, the staff profile, then sends the email", async () => {
    const { ctx, rpc, createUser, mailer } = context({
      venue_team: { data: [], error: null },
      manager_invite_staff: {
        data: [{ profile_id: USER, membership_id: "m", outcome: "created" }],
        error: null,
      },
    })
    expect(await inviteStaffToVenue(ctx, invite)).toEqual({
      status: "sent",
      userId: USER,
    })
    expect(createUser).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledWith("manager_invite_staff", {
      p_user_id: USER,
      p_venue_id: VENUE,
      p_display_name: "Sam Server",
      p_job_title: null,
    })
    expect(mailer).toHaveBeenCalledExactlyOnceWith("new@example.test")
  })

  it("adds an existing person without creating a user or sending email", async () => {
    const { ctx, createUser, mailer } = context(
      {
        venue_team: { data: [], error: null },
        manager_invite_staff: {
          data: [{ profile_id: USER, membership_id: "m", outcome: "added" }],
          error: null,
        },
      },
      true
    )
    expect(await inviteStaffToVenue(ctx, invite)).toEqual({
      status: "added",
      userId: USER,
    })
    expect(createUser).not.toHaveBeenCalled()
    expect(mailer).not.toHaveBeenCalled()
  })

  it("never accepts a role from the client", () => {
    const parsed = parseVenueInviteInput({ ...invite, role: "admin" })
    expect(parsed).toEqual({
      ok: true,
      value: {
        displayName: "Sam Server",
        email: "new@example.test",
        jobTitle: null,
        venueId: VENUE,
      },
    })
  })
})

describe("removeVenueMember", () => {
  beforeEach(() => vi.clearAllMocks())

  it("signs a deactivated account out everywhere", async () => {
    const { ctx, updateUserById } = context({
      remove_venue_member: {
        data: [
          { outcome: "deactivated", active_venue_id: null, reassigned: {} },
        ],
        error: null,
      },
    })
    const result = await removeVenueMember(ctx, {
      profileId: USER,
      venueId: VENUE,
      reason: "Left",
    })
    expect(result).toMatchObject({ ok: true, outcome: "deactivated" })
    expect(updateUserById).toHaveBeenCalledWith(USER, {
      ban_duration: expect.any(String),
    })
  })

  it("leaves a person who still works elsewhere signed in", async () => {
    const { ctx, updateUserById } = context({
      remove_venue_member: {
        data: [
          {
            outcome: "removed",
            active_venue_id: VENUE,
            reassigned: {
              coverageAssignments: 2,
              amenityChecks: 1,
              mediaRequests: 3,
            },
          },
        ],
        error: null,
      },
    })
    expect(
      await removeVenueMember(ctx, {
        profileId: USER,
        venueId: VENUE,
        reason: "Moved",
      })
    ).toEqual({
      ok: true,
      outcome: "removed",
      activeVenueId: VENUE,
      reassigned: {
        coverageAssignments: 2,
        amenityChecks: 1,
        mediaRequests: 3,
      },
    })
    expect(updateUserById).not.toHaveBeenCalled()
  })

  it("requires a reason before asking the database", async () => {
    const { ctx, rpc } = context({})
    expect(
      await removeVenueMember(ctx, {
        profileId: USER,
        venueId: VENUE,
        reason: " ",
      })
    ).toMatchObject({
      ok: false,
      code: "invalid_input",
    })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe("membershipError", () => {
  it.each([
    ["not_ordinary_staff", "forbidden", "Only an admin can remove a manager."],
    [
      "last_active_admin",
      "last_admin",
      "Make another person an active admin first.",
    ],
    ["not_a_member", "not_found", "That person is not a member of this venue."],
    [
      "replacement_not_eligible",
      "invalid_input",
      "Choose someone who is working at this venue now.",
    ],
  ])("maps %s", (message, code, text) => {
    expect(membershipError({ message, code: "P0001" })).toEqual({
      ok: false,
      code,
      error: text,
    })
  })

  it("hides unknown failures behind a retry message", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(membershipError({ message: "boom", code: "XX000" })).toMatchObject({
      code: "database_failed",
    })
  })
})

describe("venue switcher reads", () => {
  it("keeps known roles only and maps the switch result", async () => {
    const rpc = vi.fn(async (name: string) =>
      name === "my_venue_memberships"
        ? {
            data: [
              {
                venue_id: VENUE,
                venue_name: "The Bell",
                role: "manager",
                is_active_venue: true,
              },
              {
                venue_id: USER,
                venue_name: "Odd",
                role: "owner",
                is_active_venue: false,
              },
            ],
            error: null,
          }
        : { data: null, error: { message: "not_a_member", code: "42501" } }
    )
    const db = { rpc } as unknown as Db
    expect(await listMyVenues(db)).toEqual([
      {
        venueId: VENUE,
        venueName: "The Bell",
        role: "manager",
        isActive: true,
      },
    ])
    expect(await switchMyVenue(db, USER)).toEqual({
      ok: false,
      code: "not_a_member",
    })
  })

  it("names roles in plain words and pins the notice version", () => {
    expect(venueRoleLabel("manager")).toBe("Manager")
    expect(venueRoleLabel(null)).toBe("No access")
    expect(CONTRIBUTION_NOTICE_VERSION).toMatch(/^[a-z0-9][a-z0-9.-]{0,31}$/)
  })
})
