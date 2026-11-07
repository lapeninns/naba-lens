import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

/**
 * GAP-16 scope guard (v0.2 spec §1 "Explicitly out of scope", as amended by
 * v0.3 and v0.4 in docs/spec/).
 *
 * 1. Every URL the app serves comes from an allow-list: the product screens,
 *    auth infrastructure, the media/profile APIs the screens use, and the dev-only
 *    UI preview. A new screen or API must be added here on purpose.
 * 2. Application source (comments stripped) has no code for the excluded
 *    features: publication approval, comments, likes/reactions, follows,
 *    announcements, messaging, tagging, ZIP export, analytics, notifications,
 *    leaderboards, automated scoring and campaigns. Tests and docs may mention
 *    them. v0.3 adds optional menu *labels* (controlled catalogue items/content
 *    types), deliberately not a free-form tagging workflow, so the "tag" terms
 *    stay banned. v0.4 adds task review that decides completion only and never
 *    gates visibility; it uses accept / needs-another-photo / review / reason
 *    vocabulary, so the approval terms stay banned.
 */

const root = fileURLToPath(new URL("../../", import.meta.url))
const appDir = join(root, "app")

/** Route-defining files in the App Router (pages, handlers, metadata routes). */
const ROUTE_FILE =
  /^(page|route|sitemap|robots|manifest|opengraph-image|twitter-image|icon|apple-icon)\.(tsx?|jsx?|mdx?)$/

const ALLOWED_PAGES = new Set([
  "/",
  "/login",
  "/staff",
  // Owner-requested organization portfolio discovery (November 2026).
  "/staff/community",
  "/staff/people",
  "/staff/people/[id]",
  // v0.4 Home (was My tasks), the staff landing: own target, assignments, submissions and
  // review results (docs/spec/NabaLens-Staff-Coverage-v0.4.md §3).
  "/staff/tasks",
  "/staff/tasks/[requirementId]",
  "/staff/tasks/month",
  "/staff/tasks/welcome",
  // Dish photo guide (November 2026): static example angles and a checklist,
  // no media, no scoring (docs/usage-staff.md "Photo guide").
  "/staff/tasks/guide",
  // Our menu (November 2026): the venue's active menu with how many items have
  // an accepted photo, search and "Still needs a photo"; no scoring.
  "/staff/menu",
  // Self-described work details (November 2026): main job and extra areas for
  // Home's prompt and the label picker's order; never access or team.
  "/staff/profile",
  "/admin",
  "/admin/staff",
  "/admin/staff/[id]",
  "/auth/blocked",
  // Email-link landing: shows Continue; the token is used only on POST (review #8).
  "/auth/confirm",
  "/ui-preview",
  // v0.3 menu catalogue (docs/spec/NabaLens-Menus-Labels-v0.3.md §4).
  "/admin/menus",
  "/admin/menus/[venueId]",
  "/admin/menus/versions/[versionId]",
  // v0.4 venue-manager tools for the manager's own current venue
  // (docs/spec/NabaLens-Staff-Coverage-v0.4.md §4). Review decides task
  // completion only; the roster drill-in is `/staff/manage/team?staff=<id>`.
  "/staff/manage",
  "/staff/manage/review",
  "/staff/manage/checklist",
  "/staff/manage/checklist/[requirementId]",
  "/staff/manage/menu",
  // Our menu review: accept a labelled photo for a dish, ask for a better one
  // or undo an acceptance, with a reason. Decides what counts, never visibility.
  "/staff/manage/menu/items",
  "/staff/manage/team",
  // Venue manager workspace (docs/plans/venue-manager-workspace.md): a manager
  // account's own venue only. Overview, Review (decides menu-photo use, never
  // visibility), a contributor's venue-scoped contributions, Menu and Account.
  // The legacy /staff/manage screens stay for staff-held grants until cut-over.
  "/manager",
  "/manager/review",
  "/manager/review/contributors/[staffId]",
  "/manager/menu",
  "/manager/menu/[itemId]",
  "/manager/account",
  // Amenities in the workspace: the /staff/manage amenity screens for the
  // manager account's own venue (docs/plans/amenity-catalogue.md).
  "/manager/amenities",
  "/manager/amenities/[checkId]",
  "/manager/amenities/[checkId]/capture",
  // v0.4 admin coverage oversight: the same tools for any venue, plus grants.
  "/admin/coverage",
  "/admin/coverage/[venueId]",
  "/admin/coverage/[venueId]/review",
  "/admin/coverage/[venueId]/checklist",
  "/admin/coverage/[venueId]/checklist/[requirementId]",
  "/admin/coverage/[venueId]/menu",
  "/admin/coverage/[venueId]/menu/items",
  // Admin Review of the manager workspace (docs/plans/venue-manager-workspace.md
  // Phase 2): the same Review screen and contributor view for any venue.
  "/admin/coverage/[venueId]/menu-photos",
  "/admin/coverage/[venueId]/menu-photos/contributors/[staffId]",
  "/admin/coverage/[venueId]/team",
  "/admin/coverage/managers",
  // Shared amenity catalogue (November 2026): per-venue checks with photo or
  // video evidence; a valid submission is the answer, managers can reopen it.
  // Never part of monthly targets (docs/plans/amenity-catalogue.md).
  "/staff/tasks/amenities/[checkId]",
  "/staff/manage/amenities",
  "/staff/manage/amenities/[checkId]",
  "/staff/manage/amenities/[checkId]/capture",
  "/admin/coverage/[venueId]/amenities",
  "/admin/coverage/[venueId]/amenities/[checkId]",
  "/admin/coverage/[venueId]/amenities/[checkId]/capture",
])

const ALLOWED_HANDLERS = new Set([
  "/auth/callback",
  "/auth/confirm/verify",
  "/auth/logout",
  "/admin/staff/[id]/avatar",
  "/api/avatars/[id]",
  "/api/profile",
  // Gallery refresh as an abortable GET (final review F5): same reads as the
  // loadMyMedia / loadLibraryPage Server Functions.
  "/api/portfolio",
  "/api/library",
  "/api/media/[id]/download",
  "/api/media/[id]/preview",
  "/api/media/[id]/stream",
  "/api/media/[id]/thumb",
  "/api/internal/cleanup",
  // Owner-approved indefinite original retention and authenticated health checks.
  "/api/internal/media-archive",
  "/api/internal/media-archive/status",
  // Owner-approved independent monitor: a narrow authenticated heartbeat and
  // cron-only watchdog; these add no staff-facing notification feature.
  "/api/internal/archive-monitor/heartbeat",
  "/api/internal/archive-monitor/watchdog",
  // v0.3: JSON/CSV import preview upload (> Server Action body limit).
  "/api/admin/menus/import-preview",
  // v0.4 §4: scoped task-evidence thumbnail/preview for authorised same-venue
  // reviewers; no originals, downloads or video, and community access is unchanged.
  "/api/coverage/evidence/[assetId]/thumb",
  "/api/coverage/evidence/[assetId]/preview",
  // Our menu (November 2026): scoped item-photo thumbnail/preview, signed for
  // 60 s per request; labelled photos for the venue's manager or an admin, an
  // item's primary photo for staff at the venue. No originals or downloads.
  "/api/menu-photos/[assetId]/thumb",
  // Amenity evidence for its submitter, the venue's manager or an admin:
  // signed derivatives and inline video playback, never original downloads.
  "/api/amenities/evidence/[assetId]/thumb",
  "/api/amenities/evidence/[assetId]/preview",
  "/api/amenities/evidence/[assetId]/stream",
  "/api/menu-photos/[assetId]/preview",
  // v0.4 §3 rule 9: hourly idempotent monthly preparation, cron-only bearer auth
  // like the other /api/internal routes; it sends nothing to staff.
  "/api/internal/coverage/monthly-preparation",
])

/** The dev-only preview must stay inside the `(dev)` route group. */
const DEV_ONLY = new Set(["/ui-preview"])

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

type Route = { url: string; kind: "page" | "handler"; file: string }

function enumerateRoutes(): Route[] {
  const routes: Route[] = []
  for (const file of walk(appDir)) {
    const name = file.split(sep).pop()!
    if (!ROUTE_FILE.test(name)) continue
    const segments = relative(appDir, file).split(sep).slice(0, -1)
    // Private folders (`_name`) are never routable.
    if (segments.some((s) => s.startsWith("_"))) continue
    const url =
      "/" +
      segments
        // Route groups `(name)` do not appear in the URL.
        .filter((s) => !(s.startsWith("(") && s.endsWith(")")))
        .join("/")
    routes.push({
      url: url === "/" ? "/" : url.replace(/\/$/, ""),
      kind: name.startsWith("page.") ? "page" : "handler",
      file: relative(root, file),
    })
  }
  return routes
}

describe("scope guard: routes", () => {
  const routes = enumerateRoutes()

  it("finds the app's routes", () => {
    expect(routes.map((r) => r.url)).toEqual(
      expect.arrayContaining(["/login", "/staff", "/admin"])
    )
  })

  it("serves no page outside the allow-list", () => {
    const extra = routes
      .filter((r) => r.kind === "page" && !ALLOWED_PAGES.has(r.url))
      .map((r) => `${r.url} (${r.file})`)
    expect(extra).toEqual([])
  })

  it("serves no route handler outside the allow-list", () => {
    const extra = routes
      .filter((r) => r.kind === "handler" && !ALLOWED_HANDLERS.has(r.url))
      .map((r) => `${r.url} (${r.file})`)
    expect(extra).toEqual([])
  })

  it("keeps every allowed product screen", () => {
    const pages = new Set(
      routes.filter((r) => r.kind === "page").map((r) => r.url)
    )
    for (const url of ["/login", "/staff", "/admin", "/admin/staff"]) {
      expect(pages.has(url), url).toBe(true)
    }
    expect(pages.has("/admin/staff/[id]")).toBe(true)
  })

  it("keeps dev-only screens inside the (dev) route group", () => {
    for (const r of routes.filter((r) => DEV_ONLY.has(r.url))) {
      expect(r.file.split(sep)).toContain("(dev)")
    }
  })

  it("has no parallel or intercepting routes", () => {
    const odd = routes.filter((r) => /\/(@|\(\.)/.test(r.file))
    expect(odd.map((r) => r.file)).toEqual([])
  })
})

// --- Forbidden feature terms --------------------------------------------------

const SOURCE_DIRS = ["app", "lib", "components"]
const SOURCE_FILES = ["proxy.ts"]
const SQL_DIR = "supabase/migrations"
const SOURCE_EXT = /\.(tsx?|jsx?|mjs|cjs|css)$/

/**
 * Each pattern targets code for an excluded feature, not ordinary English: the
 * word "like" in UI copy ("looks like") is fine, a `likes` field is not.
 */
const FORBIDDEN: { feature: string; pattern: RegExp }[] = [
  { feature: "approval workflow", pattern: /approv/i },
  { feature: "comments", pattern: /\bcomments?\b|comment_|Comment[A-Z(]/ },
  {
    feature: "likes",
    pattern:
      /\blikes\b|\blike_count\b|\blikeCount\b|\bon(Toggle)?Like\b|\btoggleLike\b|["'`/]like["'`/]/i,
  },
  {
    feature: "tagging workflow",
    pattern: /\btags?\b|\btag_id\b|\btagged\b|\b(add|remove|edit)Tags?\b/i,
  },
  {
    feature: "bulk ZIP export",
    pattern: /\bzip\b|jszip|archiver|application\/zip|\.zip\b/i,
  },
  { feature: "analytics", pattern: /analytics|posthog|gtag|plausible/i },
  {
    feature: "notifications",
    pattern: /notification|web-push|PushManager|serviceWorker/i,
  },
  { feature: "leaderboard", pattern: /leaderboard/i },
  { feature: "campaigns", pattern: /campaign/i },
  {
    feature: "reactions",
    pattern:
      /\breactions?\b|\breaction_|\b(add|remove|toggle)Reaction\b|emoji/i,
  },
  {
    // "follow-up" (overdue work) and robots `follow: false` are not follows.
    feature: "follows",
    pattern:
      /\bfollowers?\b|unfollow|\bfollows_|\bfollow_(id|user|staff|profile)\b|\b(toggle|on)Follow\b/i,
  },
  {
    // The menu editor's singular `announcement` is an aria-live status message.
    feature: "announcements",
    pattern:
      /\bannouncements\b|\bannouncements?_|(create|post|publish|send)Announcement/,
  },
  {
    // `captcha` contains "cha", not "chat".
    feature: "messaging",
    pattern:
      /direct[_ -]?messag|\bmessage_threads?\b|\bconversations?\b|\bchat(s|_|room)?\b|\bsendMessage\b/i,
  },
  {
    // Catalogue search ranks entries by `score`; scoring people or images is excluded.
    feature: "automated scoring",
    pattern:
      /(staff|employee|performance|photo|image|quality|contribution)[_ -]?scor(e|es|ing)\b/i,
  },
]

/**
 * Removes comments so explanatory notes ("never an approval status") pass. Keeps
 * `//` inside URLs (`https://`) because a comment needs whitespace or line start
 * before it.
 */
function stripTsComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/{\/\*[\s\S]*?\*\/}/g, "")
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n")
}

/** Also drops `comment on ... is '...';` (Postgres object documentation). */
function stripSqlComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\bcomment\s+on\b[\s\S]*?;/gi, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
}

/**
 * Shadcn's generic table primitive and HTML `<figcaption>`/`<caption>` are not
 * features; neither is the `caption-bottom` utility. Nothing here is a feature
 * term, so no allow-list entry is needed for them today. Keep exceptions here,
 * each with a reason, if a library primitive ever trips a pattern.
 */
const ALLOWED_HITS: { file: string; text: string; reason: string }[] = [
  {
    file: "supabase/migrations/20261107120000_amenity_catalogue.sql",
    text: "approved performance clip",
    reason: "catalogue capture brief text (live music), not a workflow",
  },
]

function scan() {
  const files = [
    ...SOURCE_DIRS.flatMap((d) => walk(join(root, d))).filter((f) =>
      SOURCE_EXT.test(f)
    ),
    ...SOURCE_FILES.map((f) => join(root, f)),
  ]
  const sql = walk(join(root, SQL_DIR)).filter((f) => f.endsWith(".sql"))
  const hits: string[] = []
  const check = (file: string, text: string) => {
    text.split("\n").forEach((line, i) => {
      for (const { feature, pattern } of FORBIDDEN) {
        const match = line.match(pattern)
        if (!match) continue
        const rel = relative(root, file)
        if (ALLOWED_HITS.some((a) => a.file === rel && line.includes(a.text))) {
          continue
        }
        hits.push(`${rel}:${i + 1} [${feature}] ${line.trim().slice(0, 120)}`)
      }
    })
  }
  for (const f of files) check(f, stripTsComments(readFileSync(f, "utf8")))
  for (const f of sql) check(f, stripSqlComments(readFileSync(f, "utf8")))
  return { hits, scanned: files.length + sql.length }
}

describe("scope guard: no excluded features in application source", () => {
  it("scans the application source", () => {
    expect(scan().scanned).toBeGreaterThan(50)
  })

  it("has no code for an excluded feature", () => {
    expect(scan().hits).toEqual([])
  })

  it("depends on no package for an excluded feature", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    const banned = deps.filter((d) =>
      /zip|archiver|analytics|posthog|gtag|segment|mixpanel|amplitude|push|notif|pusher|socket\.io|ably/i.test(
        d
      )
    )
    expect(banned).toEqual([])
  })

  it("detects a forbidden term (self-check)", () => {
    const line = "export async function approveAsset(id: string) {}"
    expect(FORBIDDEN.some((f) => f.pattern.test(line))).toBe(true)
    expect(FORBIDDEN.some((f) => f.pattern.test("It looks like a dish"))).toBe(
      false
    )
    expect(
      stripTsComments("// never an approval status\nconst a = 1").trim()
    ).toBe("const a = 1")
    expect(stripTsComments('const u = "https://x.test/a"')).toContain(
      "https://x.test/a"
    )
  })

  it("allows v0.4 review vocabulary and still detects the new exclusions", () => {
    const tripped = (line: string) =>
      FORBIDDEN.filter((f) => f.pattern.test(line)).map((f) => f.feature)
    for (const line of [
      "export async function acceptSubmission(id: string) {}",
      "state: 'submitted' | 'accepted' | 'needs_another_photo'",
      "requestReplacement({ reason, expectedRevision })",
      "<p>Overdue: follow-up needed</p>",
      "robots: { index: false, follow: false }",
      "announce(`Added section ${name}.`)",
      "const captchaToken = normaliseCaptchaToken(raw)",
      "scored.push({ entry, score: rank(entry, query, words) })",
    ]) {
      expect(tripped(line), line).toEqual([])
    }
    expect(tripped("export function toggleReaction() {}")).toEqual([
      "reactions",
    ])
    expect(tripped("select count(*) from followers")).toEqual(["follows"])
    expect(tripped("create table public.announcements ()")).toEqual([
      "announcements",
    ])
    expect(tripped("insert into direct_messages")).toEqual(["messaging"])
    expect(tripped("const staffScore = 3")).toEqual(["automated scoring"])
  })
})
