import { randomUUID } from "node:crypto"

import {
  expect,
  test,
  type Page,
  type Request,
  type Route,
} from "@playwright/test"

import {
  localDateWords,
  nextDay,
  SCHEDULE_COPY,
} from "../../components/nabalens/knowledge/schedule-detail"
import { amenityHrefs, staffCaptureHref } from "../../lib/amenities/contract"
import {
  captureForm,
  provisionAmenitiesWorld,
  seedPhoto,
} from "./helpers/amenities-world"
import {
  addDays,
  checkIdFor,
  checkRevision,
  confirmContribution,
  key,
  londonDay,
  longDate,
  openFreshnessRechecks,
  rpcOk,
  seedPolicies,
  seedQuestions,
  sendYes,
  serviceAt,
  sessionFor,
  slotRevision,
  syntheticPrefix,
  tasksOf,
  uuid,
  type SeedQuestion,
} from "./helpers/knowledge-b03-cd-world"
import { psql } from "./helpers/stack"
import { escape, STAFF_LANDING } from "./helpers/ui"
import { signedInPage } from "./helpers/world"

/**
 * B03-C and B03-D in the built app (b03 browser qualification charters C and
 * D). Synthetic questions only (helpers/knowledge-b03-cd-world): the shared
 * catalogue keys keep their registry versions. People act through the pages;
 * setup a case does not assert runs in the actor's own database session, and
 * the service role only seeds rows and reads them back by fixture id. The
 * normal clock throughout: dates are London days relative to today.
 */

const MANAGER = amenityHrefs("/manager")
const DESKTOP = { viewport: { width: 1280, height: 800 } }
const PHONE = {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
}

type ServiceEnd = {
  kind: "stopped" | "schedule_ended"
  lastDayOffered: string
  notOfferedFrom: string
  notOfferedFromAt: string
  inEffect: boolean
}
type CheckRead = {
  answerInUse: { value: string; stop?: ServiceEnd | null } | null
}

const CHECK_DATES = "/admin/knowledge/check-dates"
/** components/nabalens/knowledge/copy.ts FRESHNESS_PREVIEW_COPY. */
const CHECK_DATES_TEXT = {
  title: "Check dates",
  question: "Question",
  internal: "Rule for staff and internal tools (optional)",
  public: "Rule for guests (optional)",
  show: "Show what it would do",
  none: "No venue has an answer to this question.",
  use: { internal: "For staff and internal tools", public: "For guests" },
} as const

/** capture-form's line after a recheck send that a manager must confirm. */
const RECHECK_SENT_OPEN =
  "Recheck sent. It stays open until a manager or an admin confirms your finding."

/** A listed rule as the page offers it (freshnessPolicyLabel). */
const ruleLabel = (id: string, maxAgeDays: number | null) =>
  `${id} (${maxAgeDays === null ? "until the event ends" : `due for a check after ${maxAgeDays} days`})`

/** A preview row's four lines (FRESHNESS_PREVIEW_COPY answers to rechecks). */
const previewLines = (n: {
  answers: number
  expired: number
  basisMissing: number
  rechecks: number
}) => [
  `${n.answers} ${n.answers === 1 ? "answer" : "answers"} in use`,
  `${n.expired} ${n.expired === 1 ? "answer" : "answers"} would be past their check date`,
  `${n.basisMissing} would be not in use because they have no check date`,
  `${n.rechecks} ${n.rechecks === 1 ? "recheck" : "rechecks"} would open`,
]

/** The Check dates form's GET, in the order the form sends its fields. */
const checkDatesQuery = (f: {
  for: string
  key: string
  internal: string
  public: string
}) =>
  `${CHECK_DATES}?${new URLSearchParams([
    ["for", f.for],
    ["key", f.key],
    ["internal", f.internal],
    ["public", f.public],
  ])}`

/**
 * After a document load, until React moves a streamed boundary into the page:
 * meanwhile the boundary sits both in the page and in a hidden `<div id="S:n">`
 * (tests/e2e/visual.spec.ts), so strict locators would match twice.
 */
async function settled(page: Page) {
  await expect(page.locator('body > div[hidden][id^="S:"]')).toHaveCount(0)
}

/**
 * Records the Check dates page at the moment its form submits, for reading
 * while the document request is held. Nothing can be evaluated in the page
 * during the hold (the renderer answers no evaluation until the navigation
 * settles), and the page has no submit script, so the page as it submits is
 * the page as it stays while held. The snapshot leaves through a binding, sent
 * before the request exists. The reads mirror the locators used after the
 * release: each select by its exact label, the preview's list items naming
 * the venue, and the one item naming the venue and the use with its own lines.
 */
async function recordOnSubmit(
  page: Page,
  venueName: string,
  use: "internal" | "public"
) {
  const name = `__b03dHeld${Date.now()}`
  let recorded!: (snapshot: unknown) => void
  const snapshot = new Promise<unknown>((resolve) => (recorded = resolve))
  const binding = await page.exposeBinding(name, (_source, s: unknown) =>
    recorded(s)
  )
  await page.evaluate(
    ({ name, labels, venueName, useText }) => {
      const read = () => {
        const text = (el: Element) =>
          (el.textContent ?? "").replace(/\s+/g, " ").trim()
        const field = (label: string) => {
          const named = [...document.querySelectorAll("label")].filter(
            (l) => text(l) === label
          )
          const el =
            named.length === 1
              ? document.getElementById(named[0]!.htmlFor)
              : null
          return el instanceof HTMLSelectElement ? el.value : null
        }
        const previews = document.querySelectorAll("#check-dates-preview")
        const items = [...document.querySelectorAll("#check-dates-preview li")]
        const venueRows = items.filter((li) => text(li).includes(venueName))
        const rows = venueRows.filter((li) => text(li).includes(useText))
        return {
          path: location.pathname + location.search,
          previews: previews.length,
          question: field(labels.question),
          internal: field(labels.internal),
          guests: field(labels.public),
          venueRows: venueRows.length,
          row:
            rows.length === 1
              ? [...rows[0]!.querySelectorAll("li")].map(text)
              : { matches: rows.length },
        }
      }
      const send = (window as unknown as Record<string, (s: unknown) => void>)[
        name
      ]!
      addEventListener("submit", () => send(read()), {
        capture: true,
        once: true,
      })
    },
    {
      name,
      labels: {
        question: CHECK_DATES_TEXT.question,
        internal: CHECK_DATES_TEXT.internal,
        public: CHECK_DATES_TEXT.public,
      },
      venueName,
      useText: CHECK_DATES_TEXT.use[use],
    }
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  return {
    /** The page as it submitted; fails if the form never submitted. */
    read: () =>
      Promise.race([
        snapshot,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("the Check dates form never submitted")),
            5_000
          )
        }),
      ]).finally(() => clearTimeout(timer)),
    dispose: () => binding.dispose(),
  }
}

/**
 * Presses Show what it would do while the real native GET for `questionKey`
 * is held before it reaches the server. The click is started and not awaited
 * (its navigation can't commit while the request is held). `observe` runs
 * with the held document request and the page as it still was; the request
 * is then always released, passed to the server unchanged, and the click and
 * the new document settled. A click that fails before the GET arrives is
 * reported as itself, not as the GET never being sent.
 */
async function showHeld(
  page: Page,
  questionKey: string,
  observe: (request: Request) => Promise<void>
) {
  const match = (url: URL) =>
    url.pathname === CHECK_DATES && url.searchParams.get("key") === questionKey
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  let arrived!: (request: Request) => void
  const held = new Promise<Request>((resolve) => (arrived = resolve))
  const handler = async (route: Route) => {
    const request = route.request()
    if (request.resourceType() !== "document" || !request.isNavigationRequest())
      return route.continue()
    arrived(request)
    await gate
    await route.continue()
  }
  await page.route(match, handler)
  // Settled at once: a click that fails before the GET arrives is never an
  // unhandled rejection, and stays the cause reported.
  const clicked = page
    .getByRole("button", { name: CHECK_DATES_TEXT.show })
    .click()
    .then(
      () => null,
      (reason: unknown) => ({ reason })
    )
  // Only the click's failure competes with the held GET; a click that
  // succeeds first still waits for the request.
  const clickFailed = clicked.then((failure) =>
    failure ? Promise.reject(failure.reason) : new Promise<never>(() => {})
  )
  let request: Request | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let observed = false
  try {
    request = await Promise.race([
      held,
      clickFailed,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("the Check dates GET was never sent")),
          15_000
        )
      }),
    ])
    await observe(request)
    observed = true
  } finally {
    clearTimeout(timer)
    release()
    const [clickFailure, navigationFailure] = await Promise.all([
      clicked,
      request
        ? page.waitForURL(request.url(), { waitUntil: "load" }).then(
            () => null,
            (reason: unknown) => ({ reason })
          )
        : null,
    ])
    let removeTimer: ReturnType<typeof setTimeout> | undefined
    const removalFailure = page.isClosed()
      ? null
      : await Promise.race([
          page.unroute(match, handler),
          new Promise<never>((_, reject) => {
            removeTimer = setTimeout(
              () => reject(new Error("the Check dates route was not removed")),
              5_000
            )
          }),
        ])
          .then(
            () => null,
            (reason: unknown) => ({ reason })
          )
          .finally(() => clearTimeout(removeTimer))
    // An observation or early click error remains the first cause, even
    // when removing the route also failed because the page closed.
    const failure = clickFailure ?? navigationFailure ?? removalFailure
    if (observed && failure) throw failure.reason
  }
}

/** Local midnight in London of a date, as epoch ms (the server's clock). */
const londonMidnight = (date: string) =>
  Number(
    psql(
      `select (extract(epoch from ('${date}'::date::timestamp at time zone 'Europe/London')) * 1000)::bigint`
    )
  )

test.describe("B03 browser charters C and D", () => {
  test.setTimeout(300_000)

  test("B03-C: a future last day offered ends the service from the next London day, while an unrelated stale recheck stays open until it is confirmed", async ({
    browser,
  }) => {
    const w = await provisionAmenitiesWorld()
    const prefix = syntheticPrefix("c")
    const k = {
      service: `${prefix}_svc`,
      stopped: `${prefix}_stop`,
      stale: `${prefix}_s1`,
      later: `${prefix}_s2`,
      archived: `${prefix}_s3`,
    }
    const q = {
      service: `DEV-FIXTURE B03-C weekday lunch ${w.tag}`,
      stopped: `DEV-FIXTURE B03-C quiz night ${w.tag}`,
      stale: `DEV-FIXTURE B03-C stale hand dryer ${w.tag}`,
      later: `DEV-FIXTURE B03-C later coat hooks ${w.tag}`,
      archived: `DEV-FIXTURE B03-C archived umbrella stand ${w.tag}`,
    }
    const policy = `${prefix}_rule`

    // service.v1 (no rule) for the two services; presence with a 7-day
    // internal rule for the three stale answers, confirmed by a manager.
    seedPolicies([
      {
        id: policy,
        use: "internal",
        claimClass: "offering",
        maxAgeDays: 7,
        leadDays: 2,
      },
    ])
    const service = (key: string, question: string): SeedQuestion => ({
      key,
      question,
      rule: "none",
      versions: [
        {
          version: 1,
          schema: "service",
          confirmation: "none",
          freshness: { internal: null, public: null },
          effectiveFrom: null,
          createdAt: "now() - interval '1 day'",
        },
      ],
    })
    const stale = (key: string, question: string): SeedQuestion => ({
      key,
      question,
      rule: "venue_manager",
      versions: [
        {
          version: 1,
          schema: "presence",
          confirmation: "venue_manager",
          freshness: { internal: policy, public: null },
          effectiveFrom: null,
          createdAt: "now() - interval '1 day'",
        },
      ],
    })
    seedQuestions([
      service(k.service, q.service),
      service(k.stopped, q.stopped),
      stale(k.stale, q.stale),
      stale(k.later, q.later),
      stale(k.archived, q.archived),
    ])
    const keys = Object.values(k)

    // The admin enables the venue, adds the five checks and puts them on the
    // working list; the stale one is assigned to Staff A.
    const adminDb = await sessionFor(w.admin)
    await rpcOk(adminDb, "amenity_enable_venue", { p_venue_id: w.venueA.id })
    await rpcOk(adminDb, "amenity_add_checks", {
      p_venue_id: w.venueA.id,
      p_keys: keys,
    })
    await rpcOk(adminDb, "knowledge_set_working_list", {
      p_venue_id: w.venueA.id,
      p_keys: keys,
      p_enabled: true,
      p_reason: "DEV-FIXTURE B03-C",
    })
    const id = Object.fromEntries(
      Object.entries(k).map(([role, key]) => [role, checkIdFor(w.venueA, key)])
    ) as Record<keyof typeof k, string>
    await rpcOk(adminDb, "amenity_assign_check", {
      p_check_id: id.stale,
      p_assignee_id: w.staffA.id,
      p_revision: checkRevision(id.stale),
    })

    const staffDb = await sessionFor(w.staffA)
    const colleagueDb = await sessionFor(w.staffA2)
    const managerDb = await sessionFor(w.managerA)
    const photo = (who: typeof w.staffA, label: string) =>
      seedPhoto(who, w.venueA, `b03c-${label}-${w.tag}`, { purpose: "amenity" })

    // A recurring service in London time, every day 12:00 to 15:00 from a
    // week ago, with no end; the manager cancels the day after tomorrow.
    const today = londonDay(0)
    const sent = await sendYes(
      colleagueDb,
      w.venueA,
      k.service,
      await photo(w.staffA2, "svc"),
      {
        detail: {
          schedule: {
            effectiveFrom: londonDay(-7),
            recurrence: {
              kind: "weekly",
              days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
            },
            windows: [{ start: "12:00", end: "15:00" }],
          },
        },
        observedOn: today,
      }
    )
    expect(sent.outcome).toBe("current")
    const firstSchedule = psql(`select id from public.knowledge_schedules
      where contribution_id = ${uuid(sent.contributionId)}`)
    const cancelled = londonDay(2)
    await rpcOk(managerDb, "knowledge_schedule_exception", {
      p_check_id: id.service,
      p_slot_revision: slotRevision(w.venueA, k.service),
      p_idempotency_key: randomUUID(),
      p_schedule_id: firstSchedule,
      p_local_date: cancelled,
      p_kind: "cancelled",
      p_windows: null,
      p_note: null,
    })

    // An independent deliberate stop already in effect: its last day was the
    // day before yesterday. A send refuses a past last day, so the stop is
    // attached to this fixture's own contribution (as the A40 suite does).
    const stopSent = await sendYes(
      colleagueDb,
      w.venueA,
      k.stopped,
      await photo(w.staffA2, "stop")
    )
    expect(stopSent.outcome).toBe("current")
    psql(`insert into public.knowledge_contribution_details
        (contribution_id, venue_id, question_version, value_schema, value_schema_version, detail, request_hash)
      select x.id, x.venue_id, 1, 'service', 1,
        jsonb_build_object('lastDayOffered', '${londonDay(-2)}'),
        encode(sha256(x.id::text::bytea), 'hex')
      from public.knowledge_contributions x where x.id = ${uuid(stopSent.contributionId)}`)

    // Three genuinely stale answers, each confirmed by the manager: checked
    // 20 (assigned to Staff A), 10 and 25 days ago against a 7-day rule.
    const staleSeed: Record<"stale" | "later" | "archived", string> = {
      stale: "",
      later: "",
      archived: "",
    }
    for (const [role, sender, db, days] of [
      ["stale", w.staffA, staffDb, -20],
      ["later", w.staffA2, colleagueDb, -10],
      ["archived", w.staffA2, colleagueDb, -25],
    ] as const) {
      const yes = await sendYes(
        db,
        w.venueA,
        k[role],
        await photo(sender, role),
        {
          observedOn: londonDay(days),
        }
      )
      expect(yes.outcome).toBe("awaiting_confirmation")
      await confirmContribution(
        managerDb,
        w.venueA,
        k[role],
        yes.contributionId
      )
      staleSeed[role] = yes.contributionId
    }

    // The three stale answers' expired tasks, opened for these checks only
    // (never the global job); then the third check is archived, so its open
    // task is left out of every list.
    openFreshnessRechecks(w.venueA, [k.stale, k.later, k.archived])
    for (const role of ["stale", "later", "archived"] as const)
      expect(tasksOf(id[role]), role).toEqual([
        expect.objectContaining({
          cause: "expired",
          use: "internal",
          state: "open",
          closedDecisionId: null,
        }),
      ])
    await rpcOk(managerDb, "amenity_archive_check", {
      p_check_id: id.archived,
      p_revision: checkRevision(id.archived),
    })
    const [staleTask] = tasksOf(id.stale)
    const [laterTask] = tasksOf(id.later)
    const [archivedTask] = tasksOf(id.archived)
    expect(Date.parse(archivedTask!.dueAt)).toBeLessThan(
      Date.parse(staleTask!.dueAt)
    )
    expect(Date.parse(staleTask!.dueAt)).toBeLessThan(
      Date.parse(laterTask!.dueAt)
    )
    // Neither service has a task before the stop is set. (That the hourly job
    // opens none for a deliberate stop is the database qualification's proof;
    // this case reads these checks' tasks back before and after.)
    const stopTasksBefore = tasksOf(id.stopped)
    const serviceTasksBefore = tasksOf(id.service)
    expect(stopTasksBefore).toEqual([])
    expect(serviceTasksBefore).toEqual([])
    // Each due at London midnight seven days after the day it was checked.
    expect(Date.parse(staleTask!.dueAt)).toBe(
      londonMidnight(addDays(londonDay(-20), 7))
    )
    expect(Date.parse(laterTask!.dueAt)).toBe(
      londonMidnight(addDays(londonDay(-10), 7))
    )

    // ---- Manager, 1280: Overview and Amenities rechecks ------------------------
    const manager = await signedInPage(browser, w.managerA, DESKTOP)
    await manager.goto("/manager")
    await settled(manager)
    const triage = manager.getByRole("main").locator('[data-triage="rechecks"]')
    // The archived check's older task is neither counted nor the oldest.
    await expect(triage).toContainText(
      `Rechecks due: 2, oldest due ${longDate(staleTask!.dueAt)}`
    )
    await triage.getByRole("link").click()
    await expect(manager).toHaveURL(
      new RegExp(`${escape(MANAGER.list)}#amenities-rechecks$`)
    )
    const rechecks = manager.getByRole("region", { name: /^Rechecks/ })
    const rows = rechecks.getByRole("listitem")
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText(q.stale)
    await expect(rows.nth(0)).toContainText(
      `Past its check date since ${longDate(staleTask!.dueAt)}.`
    )
    await expect(rows.nth(0)).toContainText(
      `Due ${longDate(staleTask!.dueAt)} · Assigned to ${w.staffA.name}`
    )
    await expect(rows.nth(1)).toContainText(q.later)
    await expect(rows.nth(1)).toContainText("Not assigned")
    for (const other of [q.archived, q.service, q.stopped])
      await expect(rechecks).not.toContainText(other)

    // ---- Manager, 1280: the future last day offered ------------------------------
    const day = (n: number) => londonDay(n)
    const occurrence = (n: number) =>
      day(n) === cancelled
        ? `${localDateWords(day(n))}: cancelled`
        : `${localDateWords(day(n))}, 12:00 to 15:00`
    const upcomingLines = (last: number) =>
      Array.from({ length: last + 1 }, (_, n) => occurrence(n))

    await manager.goto(MANAGER.check(id.service))
    await settled(manager)
    const upcoming = manager.getByRole("region", {
      name: new RegExp(`^${SCHEDULE_COPY.upcoming}`),
    })
    await expect(upcoming).toContainText(
      SCHEDULE_COPY.timezone("Europe/London")
    )
    // Eight dates shown, the cancelled one marked.
    await expect(upcoming.getByRole("listitem")).toHaveText(upcomingLines(7))

    const last = day(4)
    await manager.getByRole("link", { name: "Correct the answer" }).click()
    await expect(manager).toHaveURL(
      new RegExp(`${escape(MANAGER.capture(id.service))}\\?correct=1$`)
    )
    const form = manager.getByRole("form", { name: "Correct the answer" })
    const lastDay = form.getByLabel(SCHEDULE_COPY.lastDay, { exact: true })
    await expect(lastDay).toHaveValue("")
    await expect(form.getByText(SCHEDULE_COPY.lastDayHelp)).toBeVisible()
    await lastDay.fill(last)
    await form
      .getByLabel(/^Why are you correcting it\?/)
      .fill(`DEV-FIXTURE lunch ends ${w.tag}`)
    await form.getByRole("button", { name: "Save correction" }).click()
    await expect(
      manager.getByRole("status").filter({ hasText: /^Corrected\./ })
    ).toBeVisible()

    // Not offered from the next London day, at its local midnight; still
    // offered until then.
    const read = async () =>
      (
        await rpcOk<CheckRead>(managerDb, "knowledge_check", {
          p_check_id: id.service,
        })
      ).answerInUse
    await expect
      .poll(async () => (await read())?.stop?.lastDayOffered ?? null)
      .toBe(last)
    const now = (await read())!
    expect(now.value).toBe("yes")
    expect(now.stop).toMatchObject({
      lastDayOffered: last,
      notOfferedFrom: nextDay(last),
      inEffect: false,
    })
    expect(["stopped", "schedule_ended"]).toContain(now.stop!.kind)
    expect(Date.parse(now.stop!.notOfferedFromAt)).toBe(
      londonMidnight(nextDay(last))
    )

    // Upcoming ends on the last day and keeps the cancellation.
    await manager.goto(MANAGER.check(id.service))
    await settled(manager)
    await expect(upcoming.getByRole("listitem")).toHaveText(upcomingLines(4))
    await expect(upcoming).not.toContainText(localDateWords(day(5)))

    // Readbacks scoped to this check: the stated schedule kept as it was, and
    // the corrected version ends on the last day in London time with the
    // same cancellation; one send and one correction.
    type ScheduleRow = {
      id: string
      timezone: string
      from: string
      to: string | null
      exceptions: { date: string; kind: string }[]
    }
    const schedules = JSON.parse(
      psql(`select json_agg(json_build_object('id', s.id, 'timezone', s.timezone,
          'from', s.effective_from, 'to', s.effective_to,
          'exceptions', (select coalesce(json_agg(json_build_object('date', e.local_date, 'kind', e.kind)
            order by e.local_date), '[]'::json)
            from public.knowledge_schedule_exceptions e where e.schedule_id = s.id))
          order by s.created_at, s.id)
        from public.knowledge_schedules s where s.check_id = ${uuid(id.service)}`)
    ) as ScheduleRow[]
    expect(schedules).toHaveLength(2)
    expect(schedules[0]).toEqual({
      id: firstSchedule,
      timezone: "Europe/London",
      from: day(-7),
      to: null,
      exceptions: [{ date: cancelled, kind: "cancelled" }],
    })
    expect(schedules[1]).toMatchObject({
      timezone: "Europe/London",
      from: day(-7),
      to: last,
      exceptions: [{ date: cancelled, kind: "cancelled" }],
    })
    expect(
      psql(`select count(*) from public.knowledge_contributions
        where check_id = ${uuid(id.service)}`)
    ).toBe("2")

    // Two time positions, read back for this check only: the last moment of
    // the last day still reads Yes with the end not in effect; its next
    // London midnight reads No, a deliberate stop in effect.
    const endsAt = now.stop!.notOfferedFromAt
    const lastMoment = new Date(Date.parse(endsAt) - 1_000).toISOString()
    expect(serviceAt(w.venueA, k.service, id.service, lastMoment)).toEqual({
      value: "yes",
      end: expect.objectContaining({ kind: now.stop!.kind, inEffect: false }),
    })
    expect(serviceAt(w.venueA, k.service, id.service, endsAt)).toEqual({
      value: "no",
      end: expect.objectContaining({ kind: now.stop!.kind, inEffect: true }),
    })

    // After the stop was set: still no task for either service, the existing
    // stale task is the same open task, and the later one is untouched.
    expect(tasksOf(id.stopped)).toEqual(stopTasksBefore)
    expect(tasksOf(id.service)).toEqual(serviceTasksBefore)
    expect(tasksOf(id.stale)).toEqual([staleTask])
    expect(tasksOf(id.later)).toEqual([laterTask])

    // ---- Manager, 1280: the stop already in effect -------------------------------
    expect(
      (
        await rpcOk<CheckRead>(managerDb, "knowledge_check", {
          p_check_id: id.stopped,
        })
      ).answerInUse
    ).toMatchObject({
      value: "no",
      stop: {
        kind: "stopped",
        lastDayOffered: day(-2),
        notOfferedFrom: day(-1),
        inEffect: true,
      },
    })
    // Manager only, so read at 1280: the stopped service reads No, with no
    // schedule-end recheck line, and is not among the rechecks.
    await manager.goto(MANAGER.check(id.stopped))
    await settled(manager)
    await expect(
      manager.getByRole("main").getByText(/^Current answer: No\./)
    ).toBeVisible()
    await expect(
      manager.getByText(/Its last day offered was|Check whether it continues/)
    ).toHaveCount(0)
    await manager.goto(MANAGER.list)
    await settled(manager)
    await expect(rows).toHaveCount(2)
    await expect(rechecks).not.toContainText(q.stopped)
    await expect(rechecks).not.toContainText(q.service)
    expect(tasksOf(id.stopped)).toEqual(stopTasksBefore)

    // ---- Staff A (assigned), 390: Home To do, then Send leaves the task open ---
    const staff = await signedInPage(browser, w.staffA, PHONE)
    await expect(staff).toHaveURL(STAFF_LANDING)
    const todo = staff.getByRole("region", { name: /^To do/ })
    const card = todo
      .getByRole("listitem")
      .filter({ has: staff.getByRole("heading", { name: q.stale }) })
    const recheckLink = todo.getByRole("link", { name: `Recheck: ${q.stale}` })
    await expect(card).toContainText(
      `Recheck reason: Past its check date since ${longDate(staleTask!.dueAt)}.`
    )
    // Only the assigned recheck: not the unassigned one, nor either service.
    for (const other of [q.later, q.archived, q.service, q.stopped])
      await expect(todo).not.toContainText(other)
    const recheckPhoto = await photo(w.staffA, "recheck")
    await card.getByRole("link", { name: `Recheck: ${q.stale}` }).click()
    await expect(staff).toHaveURL(
      new RegExp(`${escape(staffCaptureHref(id.stale))}$`)
    )
    const capture = captureForm(staff)
    await capture.answer("yes")
    await capture.attach(recheckPhoto)
    // A question with an answer is in change mode: its primary action is
    // "Send change report", not "Submit finding" (b01-ui-design §4.2), and a
    // change report says what changed (required).
    await staff
      .getByRole("main")
      .getByLabel(/^What changed\?/)
      .fill(`DEV FIXTURE B03-C rechecked, still offered ${w.tag}`)
    await staff
      .getByRole("main")
      .getByRole("button", { name: "Send change report", exact: true })
      .click()
    await expect(staff.getByText(RECHECK_SENT_OPEN)).toBeVisible()
    const sentByStaff = () =>
      psql(`select coalesce(string_agg(x.id::text || ':' || x.initial_outcome, ','), '')
        from public.knowledge_contributions x
        where x.check_id = ${uuid(id.stale)} and x.id <> ${uuid(staleSeed.stale)}`)
    await expect
      .poll(sentByStaff)
      .toMatch(/^[0-9a-f-]{36}:awaiting_confirmation$/)
    const recheckContribution = sentByStaff().split(":")[0]!
    expect(tasksOf(id.stale)).toEqual([staleTask])
    expect(tasksOf(id.later)).toEqual([laterTask])

    // ---- Manager confirms: the same task closes, by that decision ---------------
    await manager.goto(MANAGER.check(id.stale))
    await settled(manager)
    const toConfirm = manager.getByRole("region", { name: /^To confirm/ })
    await toConfirm
      .getByRole("button", { name: "Confirm", exact: true })
      .click()
    await expect.poll(() => tasksOf(id.stale)[0]?.state).toBe("done")
    // A confirmation is stored against the answer it confirms, not the
    // finding: reach it through the answer adopted from that finding.
    const decision = psql(`select d.id from public.knowledge_decisions d
      join public.amenity_submissions s on s.id = d.submission_id
      where s.source_contribution_id = ${uuid(recheckContribution)}
        and d.decision = 'confirmed'`)
    expect(decision).toMatch(/^[0-9a-f-]{36}$/)
    expect(tasksOf(id.stale)).toEqual([
      { ...staleTask, state: "done", closedDecisionId: decision },
    ])
    // Nothing else moved: the stop and the service still have no task, and
    // the later stale task is open.
    expect(tasksOf(id.stopped)).toEqual(stopTasksBefore)
    expect(tasksOf(id.service)).toEqual(serviceTasksBefore)
    expect(tasksOf(id.later)).toEqual([laterTask])

    // ---- Staff A, 390: To do no longer offers the closed recheck ----------------
    await staff.goto("/staff/tasks")
    await settled(staff)
    await expect(staff).toHaveURL(STAFF_LANDING)
    await expect(recheckLink).toHaveCount(0)
    await expect(todo).not.toContainText(
      `Past its check date since ${longDate(staleTask!.dueAt)}.`
    )
  })

  test("B03-D: Check dates starts each chosen question from its own rule in force, clears the last question's choice and writes no rule", async ({
    browser,
  }) => {
    const w = await provisionAmenitiesWorld()
    const prefix = syntheticPrefix("d")
    const q1 = `${prefix}_q1`
    const q2 = `${prefix}_q2`
    const text1 = `DEV-FIXTURE B03-D first question ${w.tag}`
    const text2 = `DEV-FIXTURE B03-D second question ${w.tag}`
    const rule = {
      v1: { id: `${prefix}_v1`, days: 30 },
      v3: { id: `${prefix}_v3`, days: 3 },
      second: { id: `${prefix}_b`, days: 90 },
      event: { id: `${prefix}_e`, days: null },
    } as const
    seedPolicies([
      {
        id: rule.v1.id,
        use: "internal",
        claimClass: "offering",
        maxAgeDays: 30,
        leadDays: 7,
      },
      {
        id: rule.v3.id,
        use: "internal",
        claimClass: "offering",
        maxAgeDays: 3,
        leadDays: 1,
      },
      {
        id: rule.second.id,
        use: "internal",
        claimClass: "schedule",
        maxAgeDays: 90,
        leadDays: 14,
      },
      {
        id: rule.event.id,
        use: "public",
        claimClass: "event",
        maxAgeDays: null,
        leadDays: null,
      },
    ])
    // The first question: version 1 in force, version 3 from ten years on
    // and no version 2. The second: its own internal and guest rules.
    seedQuestions([
      {
        key: q1,
        question: text1,
        rule: "none",
        versions: [
          {
            version: 1,
            schema: "presence",
            confirmation: "none",
            freshness: { internal: rule.v1.id, public: null },
            effectiveFrom: null,
            createdAt: "now() - interval '1 day'",
          },
          {
            version: 3,
            schema: "presence",
            confirmation: "none",
            freshness: { internal: rule.v3.id, public: rule.event.id },
            effectiveFrom: "now() + interval '10 years'",
            createdAt: "now()",
          },
        ],
      },
      {
        key: q2,
        question: text2,
        rule: "none",
        versions: [
          {
            version: 1,
            schema: "presence",
            confirmation: "none",
            freshness: { internal: rule.second.id, public: rule.event.id },
            effectiveFrom: null,
            createdAt: "now() - interval '1 day'",
          },
        ],
      },
    ])
    const ids = Object.values(rule).map((r) => key(r.id))
    const registryRows = () =>
      psql(`select json_agg(json_build_object('key', v.key, 'version', v.version,
          'freshness', v.freshness, 'effectiveFrom', v.effective_from, 'createdAt', v.created_at)
          order by v.key, v.version)
        from public.knowledge_question_versions v where v.key in (${key(q1)}, ${key(q2)})`)
    const policyRows = () =>
      psql(`select json_agg(json_build_object('id', p.id, 'version', p.version, 'use', p.use,
          'maxAge', p.max_age, 'basis', p.basis, 'createdAt', p.created_at)
          order by p.id, p.version)
        from public.knowledge_freshness_policies p where p.id in (${ids.join(", ")})`)
    const registryBefore = registryRows()
    const policiesBefore = policyRows()
    expect(
      (JSON.parse(registryBefore) as { key: string; version: number }[]).map(
        (v) => `${v.key}@${v.version}`
      )
    ).toEqual([`${q1}@1`, `${q1}@3`, `${q2}@1`])
    expect(JSON.parse(policiesBefore)).toHaveLength(4)

    const questionRuleRows = () =>
      psql(`select json_agg(json_build_object('key', r.question_key, 'ruleVersion', r.rule_version,
          'confirmation', r.confirmation) order by r.question_key, r.rule_version)
        from public.knowledge_question_rules r where r.question_key in (${key(q1)}, ${key(q2)})`)
    const questionRulesBefore = questionRuleRows()

    // One dated answer to each question at Venue A, checked ten days ago, in
    // the sender's own session. Under the first question's rule in force
    // (version 1, 30 days) it is up to date; under version 3's later rule
    // (3 days) it would be past its check date. The second question's guest
    // rule (until the event ends) has no event date for it.
    const adminDb = await sessionFor(w.admin)
    await rpcOk(adminDb, "amenity_enable_venue", { p_venue_id: w.venueA.id })
    await rpcOk(adminDb, "amenity_add_checks", {
      p_venue_id: w.venueA.id,
      p_keys: [q1, q2],
    })
    await rpcOk(adminDb, "knowledge_set_working_list", {
      p_venue_id: w.venueA.id,
      p_keys: [q1, q2],
      p_enabled: true,
      p_reason: "DEV-FIXTURE B03-D",
    })
    const checkedOn = londonDay(-10)
    const senderDb = await sessionFor(w.staffA2)
    const check = { q1: checkIdFor(w.venueA, q1), q2: checkIdFor(w.venueA, q2) }
    for (const k of [q1, q2]) {
      const asset = await seedPhoto(w.staffA2, w.venueA, `b03d-${k}-${w.tag}`, {
        purpose: "amenity",
      })
      const sent = await sendYes(senderDb, w.venueA, k, asset, {
        observedOn: checkedOn,
      })
      expect(sent.outcome, k).toBe("current")
    }
    // Read back for these two checks: the version in force and how each
    // answer reads now.
    const inForce = () =>
      JSON.parse(
        psql(`select json_agg(json_build_object('key', x.key,
            'version', (private.knowledge_version_as_of(x.key, now())).version,
            'freshness', (private.knowledge_version_as_of(x.key, now())).freshness,
            'states', (select json_agg(json_build_object('use', e ->> 'use', 'state', e ->> 'state')
                order by e ->> 'use')
              from private.knowledge_slot_state_b03(${uuid(w.venueA.id)}, array[x.key]::text[], now()) st
              cross join lateral jsonb_array_elements(st.freshness) e))
            order by x.key)
          from (values (${key(q1)}), (${key(q2)})) x(key)`)
      ) as unknown
    expect(inForce()).toEqual([
      {
        key: q1,
        version: 1,
        freshness: { internal: rule.v1.id, public: null },
        states: [
          { use: "internal", state: "current" },
          { use: "public", state: "unrated" },
        ],
      },
      {
        key: q2,
        version: 1,
        freshness: { internal: rule.second.id, public: rule.event.id },
        states: [
          { use: "internal", state: "current" },
          { use: "public", state: "basis_missing" },
        ],
      },
    ])
    const tasksBefore = { q1: tasksOf(check.q1), q2: tasksOf(check.q2) }

    const admin = await signedInPage(browser, w.admin, DESKTOP)
    await admin.goto(CHECK_DATES)
    await settled(admin)
    await expect(
      admin.getByRole("heading", { name: CHECK_DATES_TEXT.title, level: 1 })
    ).toBeVisible()
    const question = admin.getByLabel(CHECK_DATES_TEXT.question, {
      exact: true,
    })
    const internal = admin.getByLabel(CHECK_DATES_TEXT.internal, {
      exact: true,
    })
    const guests = admin.getByLabel(CHECK_DATES_TEXT.public, { exact: true })
    const preview = admin.locator("#check-dates-preview")
    const option = (select: typeof internal, id: string) =>
      select.locator("option", { hasText: id })
    /** Venue A's preview row for one use, by its four lines. */
    const row = (use: "internal" | "public") =>
      preview
        .getByRole("listitem")
        .filter({ hasText: w.venueA.name })
        .filter({ hasText: CHECK_DATES_TEXT.use[use] })
    const venueRows = preview
      .getByRole("listitem")
      .filter({ hasText: w.venueA.name })

    // Each use offers only its own listed rules, worded with their basis.
    for (const r of [rule.v1, rule.v3, rule.second]) {
      await expect(option(internal, r.id)).toHaveText(ruleLabel(r.id, r.days))
      await expect(option(guests, r.id)).toHaveCount(0)
    }
    await expect(option(guests, rule.event.id)).toHaveText(
      ruleLabel(rule.event.id, null)
    )
    await expect(option(internal, rule.event.id)).toHaveCount(0)
    await expect(question.locator("option", { hasText: text1 })).toHaveCount(1)
    await expect(question.locator("option", { hasText: text2 })).toHaveCount(1)
    await expect(question).toHaveValue("")
    await expect(preview).toHaveCount(0)

    // ---- The first question: held, then its version 1 rule in force -------------
    await question.selectOption({ label: text1 })
    const firstQuery = checkDatesQuery({
      for: "",
      key: q1,
      internal: "",
      public: "",
    })
    const heldFirst = await recordOnSubmit(admin, w.venueA.name, "internal")
    await showHeld(admin, q1, async (request) => {
      // The exact native GET the form sent, held before the server saw it.
      expect(request.method()).toBe("GET")
      expect(request.frame()).toBe(admin.mainFrame())
      const sent = new URL(request.url())
      expect(`${sent.pathname}${sent.search}`).toBe(firstQuery)
      // Pending: the page that sent the form stays as it was, with no preview
      // and no rule chosen for the question.
      expect(new URL(admin.url()).pathname + new URL(admin.url()).search).toBe(
        CHECK_DATES
      )
      expect(await heldFirst.read()).toEqual({
        path: CHECK_DATES,
        previews: 0,
        question: q1,
        internal: "",
        guests: "",
        venueRows: 0,
        row: { matches: 0 },
      })
      expect(registryRows()).toBe(registryBefore)
    })
    await heldFirst.dispose()
    await settled(admin)
    await expect(admin).toHaveURL(new RegExp(`${escape(firstQuery)}$`))
    await expect(question).toHaveValue(q1)
    // Version 1's rule, not the future version 3's, and no guest rule.
    await expect(internal).toHaveValue(rule.v1.id)
    await expect(internal.locator("option:checked")).toHaveText(
      ruleLabel(rule.v1.id, rule.v1.days)
    )
    await expect(guests).toHaveValue("")
    // What version 1's rule does to the dated answer: in use, nothing due.
    await expect(venueRows).toHaveCount(1)
    await expect(row("internal").getByRole("listitem")).toHaveText(
      previewLines({ answers: 1, expired: 0, basisMissing: 0, rechecks: 0 })
    )
    await expect(preview).not.toContainText(CHECK_DATES_TEXT.none)
    // A fresh document: focus starts at the top, on no stale control.
    await expect
      .poll(() =>
        admin.evaluate(() => document.activeElement === document.body)
      )
      .toBe(true)
    await expect(
      admin.getByRole("button", { name: CHECK_DATES_TEXT.show })
    ).toBeEnabled()

    // ---- Switch to the second question: the first one's rule is cleared -------
    await question.selectOption({ label: text2 })
    const secondQuery = checkDatesQuery({
      for: q1,
      key: q2,
      internal: rule.v1.id,
      public: "",
    })
    const heldSecond = await recordOnSubmit(admin, w.venueA.name, "internal")
    await showHeld(admin, q2, async (request) => {
      expect(request.method()).toBe("GET")
      expect(request.frame()).toBe(admin.mainFrame())
      const sent = new URL(request.url())
      // The form still names the first question's rule, for the first one.
      expect(`${sent.pathname}${sent.search}`).toBe(secondQuery)
      // Pending: still the first question's document and preview.
      expect(new URL(admin.url()).pathname + new URL(admin.url()).search).toBe(
        firstQuery
      )
      expect(await heldSecond.read()).toEqual({
        path: firstQuery,
        previews: 1,
        question: q2,
        internal: rule.v1.id,
        guests: "",
        venueRows: 1,
        row: previewLines({
          answers: 1,
          expired: 0,
          basisMissing: 0,
          rechecks: 0,
        }),
      })
    })
    await heldSecond.dispose()
    await settled(admin)
    await expect(admin).toHaveURL(new RegExp(`${escape(secondQuery)}$`))
    await expect(question).toHaveValue(q2)
    await expect(internal).toHaveValue(rule.second.id)
    await expect(internal.locator("option:checked")).toHaveText(
      ruleLabel(rule.second.id, rule.second.days)
    )
    await expect(guests).toHaveValue(rule.event.id)
    await expect(guests.locator("option:checked")).toHaveText(
      ruleLabel(rule.event.id, null)
    )
    // Its own rules' outcome: up to date for staff; for guests, no event
    // date, so not in use and one recheck.
    await expect(venueRows).toHaveCount(2)
    await expect(row("internal").getByRole("listitem")).toHaveText(
      previewLines({ answers: 1, expired: 0, basisMissing: 0, rechecks: 0 })
    )
    await expect(row("public").getByRole("listitem")).toHaveText(
      previewLines({ answers: 1, expired: 0, basisMissing: 1, rechecks: 1 })
    )
    await expect
      .poll(() =>
        admin.evaluate(() => document.activeElement === document.body)
      )
      .toBe(true)

    // ---- And back: the second question's guest rule does not carry over ------
    await question.selectOption({ label: text1 })
    await admin.getByRole("button", { name: CHECK_DATES_TEXT.show }).click()
    await expect(admin).toHaveURL(
      new RegExp(
        `${escape(
          checkDatesQuery({
            for: q2,
            key: q1,
            internal: rule.second.id,
            public: rule.event.id,
          })
        )}$`
      )
    )
    await expect(internal).toHaveValue(rule.v1.id)
    await expect(guests).toHaveValue("")
    await expect(venueRows).toHaveCount(1)
    await expect(row("internal").getByRole("listitem")).toHaveText(
      previewLines({ answers: 1, expired: 0, basisMissing: 0, rechecks: 0 })
    )

    // ---- The future version 3's rule, named: a different outcome ---------------
    // The same answer under version 3's 3-day rule would be past its check
    // date, so the in-force outcome above is version 1's, not version 3's.
    await admin.goto(
      checkDatesQuery({ for: q1, key: q1, internal: rule.v3.id, public: "" })
    )
    await settled(admin)
    await expect(internal).toHaveValue(rule.v3.id)
    await expect(guests).toHaveValue("")
    await expect(venueRows).toHaveCount(1)
    await expect(row("internal").getByRole("listitem")).toHaveText(
      previewLines({ answers: 1, expired: 1, basisMissing: 0, rechecks: 1 })
    )

    // The previews wrote nothing: the two questions' versions, their B01 rule
    // rows and the four rules are as seeded, version 1 is still the one in
    // force, and neither check has a recheck task.
    expect(registryRows()).toBe(registryBefore)
    expect(questionRuleRows()).toBe(questionRulesBefore)
    expect(policyRows()).toBe(policiesBefore)
    expect((inForce() as { version: number }[]).map((v) => v.version)).toEqual([
      1, 1,
    ])
    expect(tasksBefore).toEqual({ q1: [], q2: [] })
    expect({ q1: tasksOf(check.q1), q2: tasksOf(check.q2) }).toEqual(
      tasksBefore
    )

    // ---- Manager and staff sessions are refused the admin route -------------
    for (const [who, home] of [
      [w.managerA, "/manager"],
      [w.staffA, "/staff/tasks"],
    ] as const) {
      const page = await signedInPage(browser, who, DESKTOP)
      const url = `${CHECK_DATES}?key=${q1}`
      const direct = await page.request.get(url, { maxRedirects: 0 })
      expect(direct.status(), `${who.email} ${url}`).toBe(307)
      expect(new URL(direct.headers()["location"]!, "http://x").pathname).toBe(
        home
      )
      const body = await direct.text()
      expect(body).not.toContain(text1)
      expect(body).not.toContain(rule.v1.id)
      await page.goto(url)
      await settled(page)
      await expect(page).toHaveURL(new RegExp(`${escape(home)}$`))
      await expect(
        page.getByRole("heading", { name: CHECK_DATES_TEXT.title, level: 1 })
      ).toHaveCount(0)
      // No preview and no rule: Venue A's own pages may name its questions.
      await expect(page.locator("#check-dates-preview")).toHaveCount(0)
      await expect(page.getByText(rule.v1.id)).toHaveCount(0)
      await page.context().close()
    }
    expect(registryRows()).toBe(registryBefore)
    expect(questionRuleRows()).toBe(questionRulesBefore)
    expect(policyRows()).toBe(policiesBefore)
    expect({ q1: tasksOf(check.q1), q2: tasksOf(check.q2) }).toEqual(
      tasksBefore
    )
  })
})
