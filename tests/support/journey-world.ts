/**
 * The deterministic DEV FIXTURE world that `stack.mjs reset` loads on every
 * workstream stack (scripts/ci/fixtures.ts). Ids, emails and names are constants
 * so journeys can refer to them without a lookup. Everything uses the reserved
 * `.test` domain; there are no passwords (sign in with a magic link or the
 * `signedInPage` helper), and no real people, venues or menus.
 *
 * Separate from supabase/seed.sql, which the app's own tests use.
 */

const uuid = (kind: string, n: number) =>
  `00000000-0000-4000-8000-${kind}${String(n).padStart(8, "0")}`

export type JourneyPerson = {
  id: string
  email: string
  name: string
  role: "admin" | "staff"
  jobTitle: string | null
  venue: "one" | "two" | null
  active: boolean
}

export const JOURNEY_VENUES = {
  one: {
    id: uuid("0aa0", 1),
    name: "JOURNEY Venue One",
    slug: "journey-venue-one",
  },
  two: {
    id: uuid("0aa0", 2),
    name: "JOURNEY Venue Two",
    slug: "journey-venue-two",
  },
} as const

export const JOURNEY_PEOPLE = {
  admin: {
    id: uuid("0bb0", 1),
    email: "journey-admin@nabalens.test",
    name: "JOURNEY Admin",
    role: "admin",
    jobTitle: null,
    venue: null,
    active: true,
  },
  staffA: {
    id: uuid("0bb0", 11),
    email: "journey-staff-a@nabalens.test",
    name: "JOURNEY Staff A",
    role: "staff",
    jobTitle: "Chef",
    venue: "one",
    active: true,
  },
  staffB: {
    id: uuid("0bb0", 12),
    email: "journey-staff-b@nabalens.test",
    name: "JOURNEY Staff B",
    role: "staff",
    jobTitle: "Bartender",
    venue: "one",
    active: true,
  },
  staffC: {
    id: uuid("0bb0", 13),
    email: "journey-staff-c@nabalens.test",
    name: "JOURNEY Staff C",
    role: "staff",
    jobTitle: "Server",
    venue: "two",
    active: true,
  },
  staffInactive: {
    id: uuid("0bb0", 14),
    email: "journey-staff-inactive@nabalens.test",
    name: "JOURNEY Inactive Staff",
    role: "staff",
    jobTitle: null,
    venue: "two",
    active: false,
  },
} as const satisfies Record<string, JourneyPerson>

/** Menus loaded and activated per venue (files in tests/fixtures/menus). */
export const JOURNEY_MENUS = {
  one: { file: "the-railway.food.json", venue: "one" },
  two: { file: "the-prince-of-wales.food.json", venue: "two" },
} as const

/**
 * Ready media seeded as real stored objects (originals, and previews for
 * photos). `video` is tests/fixtures/media/synthetic.mp4.
 */
export const JOURNEY_MEDIA = [
  { key: "staffA-photo", owner: "staffA", kind: "image" },
  { key: "staffA-video", owner: "staffA", kind: "video" },
  { key: "staffB-photo", owner: "staffB", kind: "image" },
  { key: "staffC-photo", owner: "staffC", kind: "image" },
] as const

export const journeyEmailPattern = /^journey-[a-z-]+@nabalens\.test$/
