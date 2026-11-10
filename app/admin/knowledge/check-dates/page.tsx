import type { Metadata } from "next"
import Link from "next/link"

import { unexpected } from "@/app/staff/manage/_shared/context"
import { AppShell } from "@/components/nabalens/app-shell"
import { CoverageSection } from "@/components/nabalens/coverage"
import {
  FRESHNESS_PREVIEW_COPY as COPY,
  previewRechecks,
} from "@/components/nabalens/knowledge/copy"
import { Notice } from "@/components/nabalens/notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { Button, buttonVariants } from "@/components/ui/button"
import { requireActiveAdmin } from "@/lib/auth"
import { knowledgeServices } from "@/lib/knowledge-client/services"
import { getCoverageActor } from "@/lib/server/coverage"
import type { MediaActor } from "@/lib/server/media/types"

export const metadata: Metadata = {
  title: "Check dates · Knowledge · Naba-Lens",
}

const PATH = "/admin/knowledge/check-dates"
const KEY = /^[a-z0-9_]{1,40}$/
const RULE = /^[a-z][a-z0-9_]{0,39}$/
const INPUT =
  "block min-h-12 w-full min-w-0 rounded-control border border-line-control bg-panel px-3 py-2 text-body-touch text-ink outline-none focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-focus md:text-body"
const LABEL = "text-label-touch text-ink md:text-label"
const MUTED = "text-meta-touch text-ink-muted md:text-meta"

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
  const internal = one(search.internal)
  const publicRule = one(search.public)
  const asked =
    KEY.test(key) &&
    (!internal || RULE.test(internal)) &&
    (!publicRule || RULE.test(publicRule)) &&
    Boolean(internal || publicRule)

  const [registry, preview] = await Promise.all([
    knowledgeServices.listQuestionRegistry(actor, {}).catch(() => null),
    asked
      ? knowledgeServices
          .previewFreshness(actor, {
            key,
            policy: { internal: internal || null, public: publicRule || null },
          })
          .catch(() => null)
      : null,
  ])
  const names = preview?.ok
    ? await venueNames(actor, [
        ...new Set(preview.preview.items.map((item) => item.venueId)),
      ])
    : new Map<string, string>()
  const questions = registry?.ok ? registry.questions : []

  return (
    <AppShell variant="admin" active="coverage" userName={profile.displayName}>
      <div className="mx-auto grid w-full max-w-(--size-reading) min-w-0 gap-(--gutter)">
        <PageHeader title={COPY.title} />
        <Notice tone="plain" role="note">
          {COPY.intro}
        </Notice>
        {registry && !registry.ok ? (
          <Notice tone="negative">{COPY.noRegistry}</Notice>
        ) : null}
        <form method="get" action={PATH} className="grid min-w-0 gap-4">
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
          ).map(([name, label, value]) => (
            <div key={name} className="grid min-w-0 gap-1.5">
              <label htmlFor={name} className={LABEL}>
                {label}
              </label>
              <input
                id={name}
                name={name}
                defaultValue={value}
                maxLength={40}
                className={INPUT}
                aria-describedby="rule-help"
              />
            </div>
          ))}
          <p id="rule-help" className={MUTED}>
            {COPY.ruleHelp}
          </p>
          <div>
            <Button type="submit" variant="secondary" size="touch">
              {COPY.show}
            </Button>
          </div>
        </form>

        {asked && (!preview || !preview.ok) ? (
          <Notice
            tone="negative"
            action={
              !preview || preview.code === "unavailable" ? (
                <Link
                  href={`${PATH}?${new URLSearchParams({ key, internal, public: publicRule })}`}
                  className={buttonVariants({
                    variant: "secondary",
                    size: "touch",
                  })}
                >
                  {COPY.tryAgain}
                </Link>
              ) : undefined
            }
          >
            {COPY.failed}
          </Notice>
        ) : null}

        {preview?.ok ? (
          <CoverageSection id="check-dates-preview" title={COPY.title}>
            {preview.preview.items.length === 0 ? (
              <p className="text-body-touch text-ink md:text-body">
                {COPY.none}
              </p>
            ) : (
              <ul className="grid gap-3">
                {preview.preview.items.map((item) => (
                  <li
                    key={`${item.venueId}-${item.use}`}
                    className="grid gap-1 rounded-card bg-surface p-4 shadow-card"
                  >
                    <p className="text-item-title [overflow-wrap:anywhere] text-ink">
                      {names.get(item.venueId) ?? COPY.aVenue}
                    </p>
                    <p className={MUTED}>{COPY.use[item.use]}</p>
                    <ul className="grid gap-0.5 text-body-touch text-ink md:text-body">
                      <li>{COPY.answers(item.answers)}</li>
                      <li>{COPY.expired(item.expired)}</li>
                      <li>{COPY.basisMissing(item.basisMissing)}</li>
                      <li>{COPY.rechecks(previewRechecks(item))}</li>
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </CoverageSection>
        ) : null}
      </div>
    </AppShell>
  )
}
