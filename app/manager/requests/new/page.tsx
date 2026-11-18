import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr"

import { workspaceManagerContext } from "@/app/staff/manage/_shared/context"
import { ErrorState } from "@/components/nabalens/error-state"
import { Notice } from "@/components/nabalens/notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { requestHrefs } from "@/components/nabalens/requests/hrefs"
import {
  RequestForm,
  type FactOption,
  type SlotOption,
} from "@/components/nabalens/requests/request-form"
import { COVERAGE_CATEGORIES } from "@/lib/album/model"
import { FACT_VERIFICATION_LABEL } from "@/lib/knowledge/facts"
import type { RequestSlotKind } from "@/lib/requests/model"
import { getCoverageSlots } from "@/lib/server/album"
import { getFactStates } from "@/lib/server/knowledge"
import { listRequests } from "@/lib/server/requests"
import { cn } from "@/lib/utils"

import { createRequestAction } from "../actions"

export const metadata: Metadata = { title: "New request" }

const MODES = [
  { id: "slot", label: "From a slot" },
  { id: "new", label: "New brief" },
  { id: "fact", label: "Fact check" },
] as const

const CATEGORY = new Map(COVERAGE_CATEGORIES.map((c) => [c.key, c.label]))
const SLOT_KINDS: RequestSlotKind[] = ["dish", "area", "amenity"]

/**
 * New request (spec §7 M4): from an existing requirement (a slot), a New
 * brief for a subject with no slot, or a fact confirmation. `?kind=&slot=`
 * or `?fact=` arrive prefilled from other screens (requestHrefs.newFor).
 * Slots marked Not here or with no photo requirement are not offered (AC24).
 */
export default async function NewRequestPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await workspaceManagerContext()
  const search = await searchParams
  const one = (v: string | string[] | undefined) =>
    typeof v === "string" ? v : undefined
  const mode =
    one(search.mode) === "new"
      ? "new"
      : one(search.mode) === "fact"
        ? "fact"
        : "slot"
  const kind = one(search.kind) as RequestSlotKind | undefined
  const initialSlot =
    kind && SLOT_KINDS.includes(kind) && one(search.slot)
      ? { kind, slotId: one(search.slot)! }
      : null

  const [list, coverage, facts] = await Promise.all([
    listRequests(ctx.actor, { venueId: ctx.venueId }),
    mode === "slot" ? getCoverageSlots(ctx.actor, ctx.venueId) : null,
    mode === "fact"
      ? getFactStates(ctx.actor, { venueId: ctx.venueId }).catch(() => null)
      : null,
  ])

  const header = (
    <>
      <Link
        href={requestHrefs.list()}
        className="inline-flex min-h-12 items-center gap-1 justify-self-start font-bold text-ink focus-ring"
      >
        <ArrowLeftIcon aria-hidden className="size-5" />
        Requests
      </Link>
      <PageHeader
        scope={ctx.venue.name}
        venueScope
        title="New request"
        summary="Subject, a one-line brief and the use are needed. Everything else is optional."
        className="pb-0 md:pb-0"
      />
      <nav aria-label="Start from" className="flex flex-wrap gap-2">
        {MODES.map((m) => (
          <Link
            key={m.id}
            href={requestHrefs.new(m.id)}
            aria-current={m.id === mode ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 items-center rounded-round px-4 font-bold focus-ring",
              m.id === mode
                ? "bg-accent-soft text-accent-text inset-ring-2 inset-ring-accent"
                : "bg-surface text-ink shadow-card"
            )}
          >
            {m.label}
          </Link>
        ))}
      </nav>
    </>
  )

  if (!list.ok)
    return (
      <div className="grid gap-gutter">
        {header}
        <ErrorState title="We couldn't load the request form" role="alert">
          {list.message} {list.nextAction}
        </ErrorState>
      </div>
    )

  let slots: SlotOption[] = []
  if (mode === "slot") {
    if (!coverage?.ok)
      return (
        <div className="grid gap-gutter">
          {header}
          <ErrorState title="We couldn't load the album's slots" role="alert">
            {coverage?.message ?? "Try again in a moment."}
          </ErrorState>
        </div>
      )
    slots = coverage.coverage.slots
      .filter((s) => s.counted)
      .map((s) => ({
        kind: s.kind,
        slotId: s.slotId,
        name: s.name,
        categoryLabel: CATEGORY.get(s.category) ?? s.category,
        state: s.state,
        primaryAssetId: s.primaryAssetId,
      }))
  }

  let factOptions: FactOption[] = []
  if (mode === "fact") {
    if (!facts?.ok)
      return (
        <div className="grid gap-gutter">
          {header}
          <ErrorState title="We couldn't load the venue's facts" role="alert">
            Try again in a moment.
          </ErrorState>
        </div>
      )
    factOptions = facts.items
      .filter((f) => f.applicable)
      .map((f) => ({
        checkId: f.checkId,
        question: f.question,
        stateLabel: f.verification
          ? FACT_VERIFICATION_LABEL[f.verification]
          : null,
      }))
  }

  const nothing =
    (mode === "slot" && slots.length === 0) ||
    (mode === "fact" && factOptions.length === 0)

  return (
    <div className="grid gap-gutter">
      {header}
      {nothing ? (
        <Notice tone="info" role="note">
          {mode === "slot"
            ? "This venue has no slots to ask for yet. Use a New brief for something not in the album."
            : "This venue has no facts to confirm yet."}
        </Notice>
      ) : (
        <RequestForm
          key={mode}
          mode={mode}
          today={list.list.today}
          slots={slots}
          facts={factOptions}
          people={list.list.people}
          shotLists={list.list.shotLists.filter((l) => l.state === "open")}
          initialSlot={initialSlot}
          initialFact={one(search.fact) ?? null}
          create={createRequestAction}
        />
      )}
    </div>
  )
}
