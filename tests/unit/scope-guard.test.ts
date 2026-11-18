import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

/**
 * GAP-16 scope guard (v0.2 spec §1 "Explicitly out of scope", as amended by
 * v0.3 and v0.4 in docs/spec/).
 *
 * 1. Every URL the app serves comes from an allow-list: the product screens,
 *    auth infrastructure and the media/profile APIs the screens use. A new
 *    screen or API must be added here on purpose. Dev-only previews are let
 *    through by rule, not by name: a page inside the `(dev)` route group is
 *    allowed only if its own source answers 404 in production.
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
  // Other jobs (G-4, docs/plans/goals-not-tasks.md decisions 8 and 10): the
  // non-menu tasks and amenity checks, with due dates, until G-10. Menu
  // sections are left out; a menu-section task page goes to Our menu unless
  // it answers an open "needs another photo" request.
  "/staff/tasks/other",
  // Redirect only: All tasks (Common Room batch 0) became Other jobs.
  "/staff/tasks/all",
  // Dish photo guide (November 2026): static example angles and a checklist,
  // no media, no scoring (docs/usage-staff.md "Photo guide").
  "/staff/tasks/guide",
  // Our menu (November 2026): the venue's active menu with how many items have
  // an accepted photo, search and "Still needs a photo"; no scoring.
  "/staff/menu",
  // Album A2 (docs/design-system/DESIGN.md §6.2, decision D8): one place's
  // slots by section. Photos only; no scoring or ranking.
  "/staff/album/[placeId]",
  "/staff/album/match-later",
  // Self-described work details (November 2026): main job and extra areas for
  // Home's prompt and the label picker's order; never access or team.
  "/staff/profile",
  "/admin",
  "/admin/staff",
  "/admin/staff/[id]",
  // Full App v1 S1-OPS (spec §8 A7): Settings and activity. Admins only.
  "/admin/settings",
  "/admin/activity",
  "/auth/blocked",
  // FA-23: the second sign-in step.
  "/auth/mfa",
  // Unmatched URLs in each area: notFound() only, so the area's own not-found
  // page (with its navigation) answers instead of the root one.
  "/staff/[...missing]",
  "/manager/[...missing]",
  "/admin/[...missing]",
  // Email-link landing: shows Continue; the token is used only on POST (review #8).
  "/auth/confirm",
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
  // Full App v1 S1-MENUS (spec §7 M5): local specials, and the active and
  // future menus with the venue's catalogue change requests.
  "/manager/menu/specials",
  "/manager/menu/versions",
  "/manager/account",
  // A manager account's own uploads to label later (B02-c), while Add is on.
  "/manager/uploads",
  // Monthly photo targets at the manager account's own venue: the venue
  // default and each person's number (G-6, docs/plans/goals-not-tasks.md).
  "/manager/team",
  // Amenities in the workspace: the /staff/manage amenity screens for the
  // manager account's own venue (docs/plans/amenity-catalogue.md).
  "/manager/amenities",
  // B03-b places: a venue's entrances, routes, rooms and areas, kept by its
  // manager or an admin for the capture form's choices.
  "/manager/amenities/places",
  // Album A2: where staff photograph each menu section and amenity category.
  "/manager/album",
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
  // Album A4 (DESIGN.md §6.6): every venue's album and its biggest gaps.
  "/admin/albums",
  // Shared amenity catalogue (November 2026): per-venue checks with photo or
  // video evidence; a valid submission is the answer, managers can reopen it.
  // Never part of monthly targets (docs/plans/amenity-catalogue.md).
  "/staff/tasks/amenities/[checkId]",
  "/staff/manage/amenities",
  "/staff/manage/amenities/places",
  "/staff/manage/amenities/[checkId]",
  "/staff/manage/amenities/[checkId]/capture",
  "/admin/coverage/[venueId]/amenities",
  "/admin/coverage/[venueId]/amenities/places",
  "/admin/coverage/[venueId]/amenities/[checkId]",
  "/admin/coverage/[venueId]/amenities/[checkId]/capture",
  // B03 knowledge admin (B03 UI design §6.4): what turning on a check-date
  // rule would do, read only.
  "/admin/knowledge/check-dates",
  // B03-f reconciliation (§7.3, §7.4): declared sources and old-fact
  // mappings, and dry runs whose imports managers decide one by one.
  "/admin/knowledge/sources",
  "/admin/knowledge/runs",
  "/admin/knowledge/runs/[runId]",
  // B03-g (§8.3): a question's schema upgrade, dry run first.
  "/admin/knowledge/upgrades",
  // B05-06 asset search (contracts/b05-design.md §6; b05-search-screen-scope):
  // find photos and videos by menu item, use, menu decision and upload day.
  // Read-only cards, no viewer, download or reuse. Admins every venue; manager
  // accounts and legacy grant holders their venue; staff refused (database).
  "/admin/search",
  "/manager/search",
  "/staff/manage/search",
  // Full App v1 S1-EXPORT (spec §14.1, §8 A5, §7 M3; decisions FA-7, FA-40):
  // export packages of public-approved photos as a ZIP with a manifest, and
  // manual publication records. Admins every venue, managers their venue.
  "/admin/publishing",
  "/admin/publishing/new",
  "/admin/publishing/packages/[id]",
  "/manager/exports",
  "/manager/exports/new",
  "/manager/exports/packages/[id]",
  // Full App v1 S2-METRICS (spec §18.1, AC39): coverage by category with
  // numerator and denominator, facts, review delay, label corrections,
  // contributions, content use and reliability. A venue's manager for their
  // venue, admins every venue. Never a ranking of people (spec §18.1).
  "/manager/metrics",
  "/admin/metrics",
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
  // Full App v1 S1-OPS (spec §17): hourly review digests and admin exceptions,
  // in-app only (FA-10). Bearer secret, no session.
  "/api/internal/notifications",
  // B05-m6 internal evidence documents (b05-design §2A): PDF allergen and
  // recipe evidence for the venue's manager, admins and the allergen
  // authority. Attachment-only download, never inline; staff have no access.
  "/api/documents/[id]/finalise",
  "/api/documents/[id]/download",
  "/api/internal/document-cleanup",
  // Owner-approved indefinite original retention and authenticated health checks.
  "/api/internal/media-archive",
  "/api/internal/media-archive/status",
  // Owner-approved independent monitor: a narrow authenticated heartbeat and
  // cron-only watchdog; these add no staff-facing notification feature.
  "/api/internal/archive-monitor/heartbeat",
  "/api/internal/archive-monitor/watchdog",
  // v0.3: JSON/CSV import preview upload (> Server Action body limit).
  "/api/admin/menus/import-preview",
  // Full App v1 S1-MENUS (spec §8 A3): the downloadable menu CSV template
  // (admin only), and the cron that activates scheduled menus (service role,
  // bearer-authorised like the other /api/internal routes).
  "/admin/menus/csv-template",
  "/api/internal/menus/activate-due",
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
  // Venue area photos (G-9), checked by area_photo_asset like menu review:
  // the venue's manager or an admin reviewing, and the uploader. Signed
  // derivatives for 60 s; no originals or downloads.
  "/api/area-photos/[assetId]/thumb",
  "/api/area-photos/[assetId]/preview",
  // Album slot photos (AL-7), checked by album_slot_asset: the current photo
  // of an accepted or waiting area slot or an accepted amenity slot, for
  // everyone at the venue. A thumbnail signed for 60 s; nothing else.
  "/api/album/[assetId]/thumb",
  // v0.4 §3 rule 9: hourly idempotent monthly preparation, cron-only bearer auth
  // like the other /api/internal routes; it sends nothing to staff.
  "/api/internal/coverage/monthly-preparation",
  // S1-FACTS (spec §9.3): the hourly knowledge recheck job (b03-design §7.4),
  // cron-only bearer auth like the other /api/internal routes.
  "/api/internal/knowledge-rechecks",
  // Upload labels (November 2026), own uploads only: GET the label menu or,
  // with ?attention=1, the caller's stored labels; POST labels (stored until
  // the photo is ready); DELETE ?assetId= discards stored labels.
  "/api/upload-labels",
  // Internal knowledge reader (B01): server-to-server, a per-consumer bearer
  // credential and service-role reads only; never a session
  // (docs/knowledge/internal-reader-api.md).
  "/api/knowledge/v1/venues/[venueId]/answers",
  "/api/knowledge/v1/meta",
  // B05-06 asset search (C/b05-design.md §6): abortable GET for the search
  // screen; managers incl. legacy grant holders at their venue, admins all
  // venues; staff refused by the database. Thumbnails via /api/media/[id]/thumb.
  "/api/media/search",
  // Full App v1 S1-EXPORT: a package's ZIP (rechecked at download) and the
  // export screens' thumbnails (caller-scoped gate, signed 60 s).
  "/api/exports/[id]/download",
  "/api/exports/thumb/[assetId]",
])

/*
 * Dev-only previews (docs/design-system/strategy.md DS-207). There is no
 * list of them: a page is dev-only if, and only if, it sits in the `(dev)`
 * route group, and every such page must refuse production itself. The check
 * reads the page's source (comments removed) for the gate, written the one
 * way the previews write it, so a preview cannot ship by being forgotten.
 */
const DEV_GROUP = "(dev)"
const PRODUCTION_GATE =
  /if\s*\(\s*process\.env\.NODE_ENV\s*===\s*["']production["']\s*\)\s*\{?\s*notFound\(\)/

const isDevRoute = (r: Route) => r.file.split(sep).includes(DEV_GROUP)

function stripSourceComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|\s)\/\/.*$/gm, "$1")
}

function hasProductionGate(file: string): boolean {
  return PRODUCTION_GATE.test(
    stripSourceComments(readFileSync(join(root, file), "utf8"))
  )
}

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
      .filter(
        (r) => r.kind === "page" && !isDevRoute(r) && !ALLOWED_PAGES.has(r.url)
      )
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

  it("finds the dev-only previews", () => {
    const dev = routes.filter((r) => r.kind === "page" && isDevRoute(r))
    expect(dev.map((r) => r.url)).toEqual(
      expect.arrayContaining(["/ui-preview"])
    )
  })

  it("lets a page in the (dev) route group through only if it 404s in production", () => {
    const ungated = routes
      .filter((r) => r.kind === "page" && isDevRoute(r))
      .filter((r) => !hasProductionGate(r.file))
      .map((r) => `${r.url} (${r.file})`)
    expect(ungated).toEqual([])
  })

  it("keeps the (dev) route group to pages: no handler is dev-only", () => {
    const handlers = routes
      .filter((r) => r.kind === "handler" && isDevRoute(r))
      .map((r) => `${r.url} (${r.file})`)
    expect(handlers).toEqual([])
  })

  it("has no dev-only page outside the (dev) route group", () => {
    const outside = routes.filter((r) => r.kind === "page" && !isDevRoute(r))
    // A production gate outside (dev) would be a preview hiding among the
    // product screens.
    const gated = outside
      .filter((r) => hasProductionGate(r.file))
      .map((r) => `${r.url} (${r.file})`)
    expect(gated).toEqual([])
    // And no product screen may answer at, or under, a preview's address.
    const devUrls = routes
      .filter((r) => r.kind === "page" && isDevRoute(r))
      .map((r) => r.url)
    const shadowing = outside
      .filter((r) =>
        devUrls.some((dev) => r.url === dev || r.url.startsWith(`${dev}/`))
      )
      .map((r) => `${r.url} (${r.file})`)
    expect(shadowing).toEqual([])
  })

  it("the production gate matcher refuses a page without the gate", () => {
    // A guard that has never been seen to fail proves nothing.
    const gate = (source: string) =>
      PRODUCTION_GATE.test(stripSourceComments(source))
    expect(
      gate(
        'if (process.env.NODE_ENV === "production") notFound()\nreturn <P />'
      )
    ).toBe(true)
    expect(
      gate('if (process.env.NODE_ENV === "production") {\n  notFound()\n}')
    ).toBe(true)
    expect(gate("return <P />")).toBe(false)
    expect(
      gate('// if (process.env.NODE_ENV === "production") notFound()\nreturn 1')
    ).toBe(false)
    expect(
      gate('/* if (process.env.NODE_ENV === "production") notFound() */')
    ).toBe(false)
    expect(gate('if (process.env.NODE_ENV !== "production") notFound()')).toBe(
      false
    )
    expect(gate('if (process.env.NODE_ENV === "development") notFound()')).toBe(
      false
    )
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
    // Full App v1 (spec §17, decision FA-10) adds in-app notices: an inbox
    // list and badges, never toasts. Device push and email digests stay out
    // until Release 2 (FA-43).
    feature: "push notifications",
    pattern: /web-push|PushManager|serviceWorker|push_subscription/i,
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
/**
 * Files where a feature the v0.2 scope excluded is now specified. Full App
 * Specification v1.0 §14.1 (export packages: a ZIP with a manifest of
 * public-approved versions) and §8 A5 (Publishing) bring back ZIP export and
 * the words "approved for public use" (decision FA-7: managers and admins
 * see the spec's words). Each entry names its feature and its files only;
 * everywhere else the ban stands.
 */
const FEATURE_PATHS: { feature: string; prefixes: string[]; reason: string }[] =
  [
    {
      feature: "bulk ZIP export",
      prefixes: [
        "app/admin/publishing/",
        "app/manager/exports/",
        "app/api/exports/",
        "lib/server/exports/",
      ],
      reason: "S1-EXPORT export packages (spec §14.1, AC31, AC32)",
    },
    {
      feature: "approval workflow",
      prefixes: [
        "app/admin/publishing/",
        "app/manager/exports/",
        "app/api/exports/",
        "lib/server/exports/",
        "supabase/migrations/20261118105",
        "lib/db/types.ts",
      ],
      reason:
        "S1-EXPORT records which approval a public export used (spec §14.1 manifest, §10 inv. 1)",
    },
  ]

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
        if (
          FEATURE_PATHS.some(
            (a) =>
              a.feature === feature && a.prefixes.some((p) => rel.startsWith(p))
          )
        ) {
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
