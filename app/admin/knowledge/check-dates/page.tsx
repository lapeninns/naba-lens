import type { Metadata } from "next"
import Link from "next/link"

import { unexpected } from "@/app/staff/manage/_shared/context"
import { AppShell } from "@/components/nabalens/app-shell"
import { CoverageSection } from "@/components/nabalens/coverage"
import {
  FRESHNESS_PREVIEW_COPY as COPY,
  freshnessPolicyLabel,
  previewRechecks,
} from "@/components/nabalens/knowledge/copy"
import { Notice } from "@/components/nabalens/notice"
import { VenueFactsHeader } from "@/app/admin/_components/admin-tabs"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { fieldControlVariants } from "@/components/ui/field-control"
import { requireActiveAdmin } from "@/lib/auth"
import type { RegistryItem } from "@/lib/knowledge-client/contract"
import { knowledgeServices } from "@/lib/knowledge-client/services"
import { getCoverageActor } from "@/lib/server/coverage"
import type { MediaActor } from "@/lib/server/media/types"

export const metadata: Metadata = {
  title: "Check dates · Venue facts",
}

/** The result table (second handoff: "What it would do", four numbers). */
const RESULT = {
  title: "What it would do",
  venue: "Venue",
  use: "Use",
  answers: "Answers in use",
  expired: "Past their check date",
  basisMissing: "No check date",
  rechecks: "Rechecks would open",
}

const PATH = "/admin/knowledge/check-dates"
const KEY = /^[a-z0-9_]{1,40}$/
const RULE = /^[a-z][a-z0-9_]{0,39}$/
// Native selects take the shared field recipe (common-room.md §4 Field).
const INPUT = fieldControlVariants()
const LABEL = "text-label text-ink"
const MUTED = "text-meta text-ink-muted"

type Search = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) =>
  typeof v === "string" ? v.trim() : ""

async function venueNames(actor: MediaActor, ids: string[]) {
  if (!ids.length) return new Map<string, string>()
  try {
    const { data } = await actor.db
      .from("venues")
      .select("id, name")
      .in("id", ids)
    return new Map(
      ((data ?? []) as { id: string; name: string }[]).map((v) => [
        v.id,
        v.name,
      ])
    )
  } catch {
    return new Map<string, string>()
  }
}

type Rules = RegistryItem["freshness"]
const NO_RULES: Rules = { internal: null, public: null }

/**
 * The question's check-date rules in force now. The registry lists each
 * question's latest version, which may only take effect later, with the rules
 * of the version in force (null when none is yet). An older database doesn't
 * send those: then the latest version's rules are used only when it is in
 * force (no or a past effective date; a version is never backdated). Null
 * when they can't be worked out here.
 */
function rulesInForce(latest: RegistryItem | undefined): Rules | null {
  if (!latest) return NO_RULES
  if ("effectiveFreshness" in latest) {
    const rules = latest.effectiveFreshness
    if (rules === null) return NO_RULES
    return typeof rules === "object" ? rules : null
  }
  if (!latest.effectiveFrom) return latest.freshness
  const from = Date.parse(latest.effectiveFrom)
  return Number.isFinite(from) && from <= Date.now() ? latest.freshness : null
}

/**
 * Admin, read only (B03 UI design §6.4): for a question and proposed check
 * date rules, what each venue's answers would read as. Nothing is saved.
 */
export default async function CheckDatesPreviewPage({
  searchParams,
}: {
  searchParams: Promise<Search>
}) {
  const profile = await requireActiveAdmin()
  const auth = await getCoverageActor()
  if (!auth.ok) unexpected(auth)
  const actor = auth.actor
  const search = await searchParams
  const key = one(search.key)
  const [registry, policies] = await Promise.all([
    knowledgeServices.listQuestionRegistry(actor, {}).catch(() => null),
    // A42: only the rules the server lists are offered, per use.
    knowledgeServices.listFreshnessPolicies(actor).catch(() => null),
  ])
  const questions = registry?.ok ? registry.questions : []
  // The form says which question its rule controls were shown for. Another
  // one (the question was just chosen or changed) starts from the new
  // question's rules in force, never the last question's; a link without it
  // names its rules directly. Until the form names rules, start from those
  // in force.
  const shownFor = search.for === undefined ? key : one(search.for)
  const named =
    shownFor === key &&
    (search.internal !== undefined || search.public !== undefined)
  const current =
    named || !KEY.test(key)
      ? NO_RULES
      : rulesInForce(questions.find((q) => q.key === key))
  const internal = named ? one(search.internal) : (current?.internal ?? "")
  const publicRule = named ? one(search.public) : (current?.public ?? "")
  const asked =
    KEY.test(key) &&
    (!internal || RULE.test(internal)) &&
    (!publicRule || RULE.test(publicRule)) &&
    Boolean(internal || publicRule)

  const preview = asked
    ? await knowledgeServices
        .previewFreshness(actor, {
          key,
          policy: { internal: internal || null, public: publicRule || null },
        })
        .catch(() => null)
    : null
  const names = preview?.ok
    ? await venueNames(actor, [
        ...new Set(preview.preview.items.map((item) => item.venueId)),
      ])
    : new Map<string, string>()
  const listed = policies?.ok ? policies.policies : []

  return (
    <AppShell variant="admin" active="settings" userName={profile.displayName}>
      <div className="grid w-full min-w-0 gap-gutter">
        <VenueFactsHeader active="check-dates" />
        <Notice tone="plain" role="note">
          {COPY.intro}
        </Notice>
        {registry && !registry.ok ? (
          <Notice tone="negative">{COPY.noRegistry}</Notice>
        ) : null}
        {!policies?.ok ? (
          <Notice tone="negative">{COPY.noPolicies}</Notice>
        ) : listed.length === 0 ? (
          <Notice tone="plain">{COPY.nonePolicies}</Notice>
        ) : null}
        {current === null ? (
          <Notice tone="negative">{COPY.noRulesInForce}</Notice>
        ) : null}
        {/* Second handoff: one form row from md (question, two rules, the
            button), with the result as a table below. */}
        <form method="get" action={PATH} className="grid min-w-0 gap-4">
          <input type="hidden" name="for" value={key} />
          <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
            <div className="grid min-w-0 gap-1.5">
              <label htmlFor="key" className={LABEL}>
                {COPY.question}
              </label>
              <select id="key" name="key" defaultValue={key} className={INPUT}>
                <option value="">Choose…</option>
                {questions.map((q) => (
                  <option key={q.key} value={q.key}>
                    {q.guidance.question}
                  </option>
                ))}
              </select>
            </div>
            {(
              [
                ["internal", COPY.internal, internal],
                ["public", COPY.public, publicRule],
              ] as const
            ).map(([name, label, value]) => {
              const options = listed.filter((policy) => policy.use === name)
              return (
                <div key={name} className="grid min-w-0 gap-1.5">
                  <label htmlFor={name} className={LABEL}>
                    {label}
                  </label>
                  <select
                    id={name}
                    name={name}
                    // Only a listed rule can be chosen; anything else reads None.
                    defaultValue={
                      options.some((policy) => policy.policyId === value)
                        ? value
                        : ""
                    }
                    className={INPUT}
                    aria-describedby="rule-help"
                  >
                    <option value="">{COPY.noRule}</option>
                    {options.map((policy) => (
                      <option key={policy.policyId} value={policy.policyId}>
                        {freshnessPolicyLabel(policy)}
                      </option>
                    ))}
                  </select>
                </div>
              )
            })}
            <div>
              <Button type="submit" variant="secondary">
                {COPY.show}
              </Button>
            </div>
          </div>
          <p id="rule-help" className={MUTED}>
            {COPY.ruleHelp}
          </p>
        </form>

        {asked && (!preview || !preview.ok) ? (
          <Notice
            tone="negative"
            action={
              !preview || preview.code === "unavailable" ? (
                <Link
                  href={`${PATH}?${new URLSearchParams({ key, for: key, internal, public: publicRule })}`}
                  className={buttonVariants({ variant: "secondary" })}
                >
                  {COPY.tryAgain}
                </Link>
              ) : undefined
            }
          >
            {preview?.code === "freshness_basis_unavailable"
              ? preview.message
              : COPY.failed}
          </Notice>
        ) : null}

        {preview?.ok ? (
          <CoverageSection id="check-dates-preview" title={RESULT.title}>
            {preview.preview.items.length === 0 ? (
              <p className="text-body text-ink">{COPY.none}</p>
            ) : (
              <Table stacked framed aria-label={RESULT.title}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{RESULT.venue}</TableHead>
                    <TableHead>{RESULT.use}</TableHead>
                    <TableHead numeric>{RESULT.answers}</TableHead>
                    <TableHead numeric>{RESULT.expired}</TableHead>
                    <TableHead numeric>{RESULT.basisMissing}</TableHead>
                    <TableHead numeric>{RESULT.rechecks}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.preview.items.map((item) => (
                    <TableRow key={`${item.venueId}-${item.use}`}>
                      <TableHead
                        scope="row"
                        className="text-label whitespace-normal text-ink"
                      >
                        {names.get(item.venueId) ?? COPY.aVenue}
                      </TableHead>
                      <TableCell
                        label={RESULT.use}
                        className="whitespace-normal text-ink-muted"
                      >
                        {COPY.use[item.use]}
                      </TableCell>
                      <TableCell label={RESULT.answers} numeric>
                        {item.answers}
                      </TableCell>
                      <TableCell label={RESULT.expired} numeric>
                        {item.expired}
                      </TableCell>
                      <TableCell label={RESULT.basisMissing} numeric>
                        {item.basisMissing}
                      </TableCell>
                      <TableCell label={RESULT.rechecks} numeric>
                        {previewRechecks(item)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CoverageSection>
        ) : null}
      </div>
    </AppShell>
  )
}
