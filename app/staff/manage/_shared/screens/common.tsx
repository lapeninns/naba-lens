import { notFound } from "next/navigation"

import { type RequirementView } from "@/components/nabalens/coverage"
import type { CoverageFailure } from "@/lib/server/coverage/types"

import { unexpected, type ManageContext } from "../context"
import { RefusedPage, isRefusal } from "../frame"

export type ManageSearch = Record<string, string | string[] | undefined>

export function param(search: ManageSearch, key: string): string | undefined {
  const value = search[key]
  return typeof value === "string" ? value : undefined
}

/** A refused read (grant revoked, moved venue) or a hard failure. */
export function failed(ctx: ManageContext, failure: CoverageFailure) {
  if (isRefusal(failure)) return <RefusedPage ctx={ctx} failure={failure} />
  if (failure.code === "not_found") notFound()
  unexpected(failure)
}

export function needsAttention(r: RequirementView): boolean {
  return (
    r.status === "needs_setup" ||
    r.needsReassignment ||
    (r.status === "active" && r.progress.overdue)
  )
}

/** Menu sections belong on the checklist once their plan is confirmed. */
export function onChecklist(r: RequirementView): boolean {
  return (
    r.kind !== "menu_section" || r.menuSection?.menuPlanStatus === "confirmed"
  )
}
