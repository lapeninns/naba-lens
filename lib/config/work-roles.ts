// Self-described work details (docs/plans/staff-portfolio-and-menu-completion.md,
// "Work profile and personalised prompts"). Pure and client-safe.
//
// A work role only changes Home's prompt and the order in which the label picker
// offers menu sections and content types. It never grants access, never sets a
// team, and never supplies a photo's dish label. Keys are stored in
// public.staff_work_profiles and must match its check constraints.

import type { ContentType, MenuSectionKind } from "@/lib/menus/types"

export const WORK_ROLE_KEYS = [
  "head_chef",
  "sous_chef",
  "line_chef",
  "kitchen_team",
  "curry_chef",
  "tandoor_chef",
  "plating",
  "bartender",
  "bar_team",
  "server",
  "host",
  "manager",
  "venue_team",
  "other",
] as const

export type WorkRoleKey = (typeof WORK_ROLE_KEYS)[number]

export const WORK_AREAS = [
  "kitchen",
  "curry",
  "tandoor",
  "plating",
  "bar",
  "service",
  "venue",
] as const

export type WorkArea = (typeof WORK_AREAS)[number]

/** Longest custom title for role "other" (matches the database check). */
export const WORK_ROLE_TITLE_MAX = 40
/** Most additional work areas a person can pick (matches the database check). */
export const WORK_AREAS_MAX = WORK_AREAS.length

type Prompt = "cook" | "plate" | "bar" | "service" | "venue" | "general"

type RoleOption = {
  id: WorkRoleKey
  name: string
  prompt: Prompt
  /** Areas the role implies when ordering the picker. */
  areas: readonly WorkArea[]
}

/**
 * Display order for the role list. "Middle man / plating" is the working label;
 * confirm the kitchen's preferred wording with pilot staff.
 */
export const WORK_ROLE_OPTIONS: readonly RoleOption[] = [
  { id: "head_chef", name: "Head chef", prompt: "cook", areas: ["kitchen"] },
  { id: "sous_chef", name: "Sous chef", prompt: "cook", areas: ["kitchen"] },
  { id: "line_chef", name: "Line chef", prompt: "cook", areas: ["kitchen"] },
  { id: "curry_chef", name: "Curry chef", prompt: "cook", areas: ["curry"] },
  {
    id: "tandoor_chef",
    name: "Tandoor chef",
    prompt: "cook",
    areas: ["tandoor"],
  },
  {
    id: "plating",
    name: "Middle man / plating",
    prompt: "plate",
    areas: ["plating"],
  },
  {
    id: "kitchen_team",
    name: "Kitchen team",
    prompt: "cook",
    areas: ["kitchen"],
  },
  { id: "bartender", name: "Bartender", prompt: "bar", areas: ["bar"] },
  { id: "bar_team", name: "Bar team", prompt: "bar", areas: ["bar"] },
  {
    id: "server",
    name: "Waiter / server",
    prompt: "service",
    areas: ["service"],
  },
  { id: "host", name: "Host", prompt: "service", areas: ["service"] },
  { id: "manager", name: "Manager", prompt: "venue", areas: ["venue"] },
  { id: "venue_team", name: "Venue team", prompt: "venue", areas: ["venue"] },
  { id: "other", name: "Other", prompt: "general", areas: [] },
]

export const WORK_AREA_OPTIONS: readonly { id: WorkArea; name: string }[] = [
  { id: "kitchen", name: "Kitchen" },
  { id: "curry", name: "Curries" },
  { id: "tandoor", name: "Tandoor and breads" },
  { id: "plating", name: "Plating" },
  { id: "bar", name: "Bar and drinks" },
  { id: "service", name: "Service and dining areas" },
  { id: "venue", name: "Venue, amenities and events" },
]

export function isWorkRoleKey(value: unknown): value is WorkRoleKey {
  return (
    typeof value === "string" &&
    (WORK_ROLE_KEYS as readonly string[]).includes(value)
  )
}

export function isWorkArea(value: unknown): value is WorkArea {
  return (
    typeof value === "string" &&
    (WORK_AREAS as readonly string[]).includes(value)
  )
}

export function workRoleOption(
  key: WorkRoleKey | null | undefined
): RoleOption | null {
  return WORK_ROLE_OPTIONS.find((option) => option.id === key) ?? null
}

/** Self-described role for display: the custom title for "other". */
export function workRoleLabel(
  key: WorkRoleKey | null | undefined,
  title?: string | null
): string | null {
  if (key === "other") return title?.trim() || "Other"
  return workRoleOption(key)?.name ?? null
}

const PROMPTS: Record<Prompt, string> = {
  cook: "What did you cook today?",
  plate: "What did you plate today?",
  bar: "What did you make at the bar today?",
  service: "What did service look like today?",
  venue: "What did you capture around the venue today?",
  general: "What did you make or capture today?",
}

/** Home's contribution prompt. Unknown, skipped or "other" gets the general one. */
export function homePrompt(key: WorkRoleKey | null | undefined): string {
  return PROMPTS[workRoleOption(key)?.prompt ?? "general"]
}

/** What the label picker should offer first. Ordering only, never a filter. */
export type WorkFocus = {
  /** Section kinds to put first, in order. */
  sectionKinds: readonly MenuSectionKind[]
  /** Lower-case words matched against section names and slugs, ranked first. */
  sectionKeywords: readonly string[]
  /** Content types to show first, in order. The rest keep their usual order. */
  contentTypes: readonly ContentType[]
}

const AREA_FOCUS: Record<WorkArea, WorkFocus> = {
  kitchen: {
    sectionKinds: ["food"],
    sectionKeywords: [],
    contentTypes: ["dish", "preparation", "kitchen"],
  },
  curry: {
    sectionKinds: ["food"],
    sectionKeywords: [
      "curry",
      "curries",
      "korma",
      "masala",
      "balti",
      "biryani",
      "side",
      "rice",
    ],
    contentTypes: ["dish", "preparation"],
  },
  tandoor: {
    sectionKinds: ["food"],
    sectionKeywords: [
      "tandoor",
      "tandoori",
      "grill",
      "naan",
      "bread",
      "roti",
      "tikka",
    ],
    contentTypes: ["dish", "preparation"],
  },
  plating: {
    sectionKinds: ["food"],
    sectionKeywords: ["main", "starter", "dessert"],
    contentTypes: ["plating", "dish"],
  },
  bar: {
    sectionKinds: ["drinks"],
    sectionKeywords: [],
    contentTypes: ["drinks", "venue", "event"],
  },
  service: {
    sectionKinds: ["food"],
    sectionKeywords: [],
    contentTypes: ["venue", "dish", "team", "event"],
  },
  venue: {
    sectionKinds: [],
    sectionKeywords: [],
    contentTypes: ["venue", "event", "team"],
  },
}

function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)]
}

/**
 * Picker focus from the main role plus any extra areas. With no role and no
 * areas it returns null: callers then keep the normal menu order.
 */
export function workFocus(
  key: WorkRoleKey | null | undefined,
  areas: readonly WorkArea[] = []
): WorkFocus | null {
  const all = unique([...(workRoleOption(key)?.areas ?? []), ...areas])
  if (all.length === 0) return null
  const parts = all.map((area) => AREA_FOCUS[area])
  return {
    sectionKinds: unique(parts.flatMap((p) => p.sectionKinds)),
    sectionKeywords: unique(parts.flatMap((p) => p.sectionKeywords)),
    contentTypes: unique(parts.flatMap((p) => p.contentTypes)),
  }
}

const TITLE_ALIASES: Record<string, WorkRoleKey> = {
  "head chef": "head_chef",
  "executive chef": "head_chef",
  "sous chef": "sous_chef",
  "line chef": "line_chef",
  "line cook": "line_chef",
  "commis chef": "kitchen_team",
  "chef de partie": "line_chef",
  "kitchen porter": "kitchen_team",
  "kitchen team": "kitchen_team",
  "curry chef": "curry_chef",
  "tandoor chef": "tandoor_chef",
  "tandoori chef": "tandoor_chef",
  "middle man": "plating",
  bartender: "bartender",
  barman: "bartender",
  barmaid: "bartender",
  "bar staff": "bar_team",
  "bar team": "bar_team",
  waiter: "server",
  waitress: "server",
  server: "server",
  host: "host",
  hostess: "host",
  manager: "manager",
  "general manager": "manager",
  "venue manager": "manager",
  "assistant manager": "manager",
}

/**
 * A role suggestion from an admin-set job title, for staff to confirm. Matching
 * is exact on a normalised title, so unclear titles return null and are kept
 * as an "Other" title instead.
 */
export function suggestRoleFromJobTitle(
  jobTitle: string | null | undefined
): WorkRoleKey | null {
  if (!jobTitle) return null
  const normalised = jobTitle
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return TITLE_ALIASES[normalised] ?? null
}
