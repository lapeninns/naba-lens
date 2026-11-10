import { randomUUID } from "node:crypto"

import { expect, test, type Page, type Route } from "@playwright/test"

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
  checkIdFor,
  checkRevision,
  confirmContribution,
  key,
  londonDay,
  longDate,
  rpcOk,
  runRecheckJob,
  seedPolicies,
  seedQuestions,
  sendYes,
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
} as const

/** A listed rule as the page offers it (freshnessPolicyLabel). */
const ruleLabel = (id: string, maxAgeDays: number | null) =>
  `${id} (${maxAgeDays === null ? "until the event ends" : `due for a check after ${maxAgeDays} days`})`

/**
 * Holds the real Check dates document request for `key` until released, then
 * lets it through to the server unchanged. `held` resolves with the URL the
 * form sent once the browser has asked for it.
 */
async function holdPreview(page: Page, questionKey: string) {
  const match = (url: URL) =>
    url.pathname === CHECK_DATES && url.searchParams.get("key") === questionKey
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  let arrived!: (url: URL) => void
  const held = new Promise<URL>((resolve) => (arrived = resolve))
  const handler = async (route: Route) => {
    if (route.request().resourceType() !== "document") return route.continue()
    arrived(new URL(route.request().url()))
    await gate
    await route.continue()
  }
  await page.route(match, handler)
  return {
    held,
    release: async () => {
      release()
      await page.unroute(match, handler)
    },
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

    // The hourly job opens one expired task each; then the third check is
    // archived, so its open task is left out of every list.
    await runRecheckJob()
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
    // Neither service has a task: the stop opens none.
    const stopTasksBefore = tasksOf(id.stopped)
    const serviceTasksBefore = tasksOf(id.service)
    expect(stopTasksBefore).toEqual([])
    expect(serviceTasksBefore).toEqual([])

    // ---- Manager, 1280: Overview and Amenities rechecks ------------------------
    const manager = await signedInPage(browser, w.managerA, DESKTOP)
    await manager.goto("/manager")
    const triage = manager.locator('[data-triage="rechecks"]')
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

    // The job again: no task for either service, and the one stale task is
    // the same open task, unclosed.
    await runRecheckJob()
    expect(tasksOf(id.stopped)).toEqual(stopTasksBefore)
    expect(tasksOf(id.service)).toEqual(serviceTasksBefore)
    expect(tasksOf(id.stale)).toEqual([staleTask])

    // ---- Manager, 390: the stop already in effect --------------------------------
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
    const phone = await signedInPage(browser, w.managerA, PHONE)
    await phone.goto(MANAGER.check(id.stopped))
    await expect(
      phone.getByRole("main").getByText(/^Current answer: No\./)
    ).toBeVisible()
    await expect(
      phone.getByText(/Its last day offered was|Check whether it continues/)
    ).toHaveCount(0)
    await phone.goto(MANAGER.list)
    const phoneRechecks = phone.getByRole("region", { name: /^Rechecks/ })
    await expect(phoneRechecks.getByRole("listitem")).toHaveCount(2)
    await expect(phoneRechecks).not.toContainText(q.stopped)
    expect(tasksOf(id.stopped)).toEqual(stopTasksBefore)

    // ---- Staff A: Home To do, then Send leaves the task open ---------------------
    const staff = await signedInPage(browser, w.staffA, DESKTOP)
    await expect(staff).toHaveURL(STAFF_LANDING)
    const todo = staff.getByRole("region", { name: /^To do/ })
    const card = todo
      .getByRole("listitem")
      .filter({ has: staff.getByRole("heading", { name: q.stale }) })
    await expect(card).toContainText(
      `Recheck reason: Past its check date since ${longDate(staleTask!.dueAt)}.`
    )
    await expect(todo).not.toContainText(q.later)
    const recheckPhoto = await photo(w.staffA, "recheck")
    await card.getByRole("link", { name: `Recheck: ${q.stale}` }).click()
    await expect(staff).toHaveURL(
      new RegExp(`${escape(staffCaptureHref(id.stale))}$`)
    )
    const capture = captureForm(staff)
    await capture.answer("yes")
    await capture.attach(recheckPhoto)
    await capture.submit.click()
    const sentByStaff = () =>
      psql(`select coalesce(string_agg(x.id::text || ':' || x.initial_outcome, ','), '')
        from public.knowledge_contributions x
        where x.check_id = ${uuid(id.stale)} and x.id <> ${uuid(staleSeed.stale)}`)
    await expect
      .poll(sentByStaff)
      .toMatch(/^[0-9a-f-]{36}:awaiting_confirmation$/)
    const recheckContribution = sentByStaff().split(":")[0]!
    expect(tasksOf(id.stale)).toEqual([staleTask])

    // ---- Manager confirms: the same task closes, by that decision ---------------
    await manager.goto(MANAGER.check(id.stale))
    const toConfirm = manager.getByRole("region", { name: /^To confirm/ })
    await toConfirm
      .getByRole("button", { name: "Confirm", exact: true })
      .click()
    await expect.poll(() => tasksOf(id.stale)[0]?.state).toBe("done")
    const decision = psql(`select id from public.knowledge_decisions
      where contribution_id = ${uuid(recheckContribution)} and decision = 'confirmed'`)
    expect(tasksOf(id.stale)).toEqual([
      { ...staleTask, state: "done", closedDecisionId: decision },
    ])
    // Nothing else moved: the stop and the service still have no task, and
    // the later stale task is open.
    expect(tasksOf(id.stopped)).toEqual(stopTasksBefore)
    expect(tasksOf(id.service)).toEqual(serviceTasksBefore)
    expect(tasksOf(id.later)).toEqual([laterTask])
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
        rule: null,
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
        rule: null,
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

    const admin = await signedInPage(browser, w.admin, DESKTOP)
    await admin.goto(CHECK_DATES)
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
    const first = await holdPreview(admin, q1)
    await admin.getByRole("button", { name: CHECK_DATES_TEXT.show }).click()
    const firstSent = await first.held
    expect(firstSent.searchParams.get("for")).toBe("")
    // Loading: the server has not been asked yet. The page that sent the form
    // stays as it was, with no preview and no rule chosen for the question.
    await expect(admin).toHaveURL(new RegExp(`${escape(CHECK_DATES)}$`))
    await expect(preview).toHaveCount(0)
    await expect(question).toHaveValue(q1)
    await expect(internal).toHaveValue("")
    expect(registryRows()).toBe(registryBefore)
    await first.release()
    await expect(admin).toHaveURL(new RegExp(`[?&]key=${q1}(&|$)`))
    await expect(question).toHaveValue(q1)
    // Version 1's rule, not the future version 3's, and no guest rule.
    await expect(internal).toHaveValue(rule.v1.id)
    await expect(internal.locator("option:checked")).toHaveText(
      ruleLabel(rule.v1.id, rule.v1.days)
    )
    await expect(guests).toHaveValue("")
    await expect(preview).toContainText(CHECK_DATES_TEXT.none)
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
    const second = await holdPreview(admin, q2)
    await admin.getByRole("button", { name: CHECK_DATES_TEXT.show }).click()
    const secondSent = await second.held
    // The form still names the first question's rule for the second one.
    expect(secondSent.searchParams.get("for")).toBe(q1)
    expect(secondSent.searchParams.get("internal")).toBe(rule.v1.id)
    await expect(internal).toHaveValue(rule.v1.id)
    await expect(preview).toContainText(CHECK_DATES_TEXT.none)
    await second.release()
    await expect(admin).toHaveURL(new RegExp(`[?&]key=${q2}(&|$)`))
    await expect(question).toHaveValue(q2)
    await expect(internal).toHaveValue(rule.second.id)
    await expect(internal.locator("option:checked")).toHaveText(
      ruleLabel(rule.second.id, rule.second.days)
    )
    await expect(guests).toHaveValue(rule.event.id)
    await expect(guests.locator("option:checked")).toHaveText(
      ruleLabel(rule.event.id, null)
    )
    await expect(preview).toContainText(CHECK_DATES_TEXT.none)
    await expect
      .poll(() =>
        admin.evaluate(() => document.activeElement === document.body)
      )
      .toBe(true)

    // ---- And back: the second question's guest rule does not carry over ------
    await question.selectOption({ label: text1 })
    await admin.getByRole("button", { name: CHECK_DATES_TEXT.show }).click()
    await expect(admin).toHaveURL(new RegExp(`[?&]key=${q1}(&|$)`))
    await expect(internal).toHaveValue(rule.v1.id)
    await expect(guests).toHaveValue("")

    // The previews wrote no rule: the two questions' versions and the four
    // rules are as seeded.
    expect(registryRows()).toBe(registryBefore)
    expect(policyRows()).toBe(policiesBefore)

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
      expect(await direct.text()).not.toContain(text1)
      await page.goto(url)
      await expect(page).toHaveURL(new RegExp(`${escape(home)}$`))
      await expect(
        page.getByRole("heading", { name: CHECK_DATES_TEXT.title, level: 1 })
      ).toHaveCount(0)
      await expect(page.getByText(text1)).toHaveCount(0)
      await page.context().close()
    }
    expect(registryRows()).toBe(registryBefore)
    expect(policyRows()).toBe(policiesBefore)
  })
})
