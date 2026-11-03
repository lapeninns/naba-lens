"use client"

// Binds the coverage Server Actions to the presentational components. Every
// action re-authorises and re-checks the venue on the server; `venueId` here
// only names the venue the page shows (managers: their own, admins: chosen).

import { useRouter } from "next/navigation"

import {
  attachPhotosAction,
  confirmMenuCoverageAction,
  createRequirementAction,
  discardMenuCoverageAction,
  grantVenueManagerAction,
  loadPreparationRunsAction,
  loadReviewQueueAction,
  loadSelfReviewsAction,
  loadVenuePhotosAction,
  prepareMonthAction,
  reconcileMenuRequirementAction,
  reviewSubmissionAction,
  revokeVenueManagerAction,
  setAmenityFactAction,
  setMonthlyTargetAction,
  setRequirementAssigneesAction,
  setRequirementStatusAction,
  startMenuCoverageAction,
  updateRequirementAction,
} from "@/app/_coverage/actions"
import {
  AmenityFactForm,
  AssigneePicker,
  AttachPhotosDialog,
  ManagerGrants,
  MenuCoveragePanel,
  NewRequirementDialog,
  PrepareMonthButton,
  PreparationRunList,
  RequirementSetup,
  ReviewQueue,
  SelfReviewList,
  TeamRoster,
  manageHrefs,
  type AmenityFactView,
  type CoveragePerson,
  type CoverageVenue,
  type EvidenceAsset,
  type ManagerGrantView,
  type MenuCoverageView,
  type MonthlyProgress,
  type Page,
  type PeriodKey,
  type PeriodView,
  type PreparationRunView,
  type RequirementView,
  type SelfReviewView,
  type SubmissionState,
  type SubmissionView,
} from "@/components/nabalens/coverage"

function useRefresh() {
  const router = useRouter()
  return () => router.refresh()
}

export function ReviewQueueControl({
  initial,
  viewerId,
  venueId,
  filter,
  canReview = true,
  currentPeriod,
  emptyTitle,
  emptyDescription,
}: {
  initial: Page<SubmissionView>
  viewerId: string
  venueId: string
  currentPeriod?: PeriodKey
  filter?: {
    state?: SubmissionState | "all"
    requirementId?: string
    staffId?: string
    period?: PeriodKey
    newestFirst?: boolean
  }
  canReview?: boolean
  emptyTitle?: string
  emptyDescription?: string
}) {
  const refresh = useRefresh()
  return (
    <ReviewQueue
      initial={initial}
      viewerId={viewerId}
      currentPeriod={currentPeriod}
      onReview={
        canReview ? (input) => reviewSubmissionAction(input) : undefined
      }
      onLoadMore={(cursor) =>
        loadReviewQueueAction({ venueId, ...filter, cursor })
      }
      onStale={refresh}
      emptyTitle={emptyTitle}
      emptyDescription={emptyDescription}
    />
  )
}

export function RequirementSetupControl({
  requirement,
}: {
  requirement: RequirementView
}) {
  const refresh = useRefresh()
  return (
    <RequirementSetup
      requirement={requirement}
      onUpdate={(input) => updateRequirementAction(input)}
      onSetStatus={(input) => setRequirementStatusAction(input)}
      onStale={refresh}
    />
  )
}

export function AmenityFactControl({
  fact,
  candidates,
  venueId,
}: {
  fact: AmenityFactView
  candidates: EvidenceAsset[]
  venueId: string
}) {
  const refresh = useRefresh()
  return (
    <AmenityFactForm
      fact={fact}
      candidates={candidates}
      onSave={(input) => setAmenityFactAction({ ...input, venueId })}
      onStale={refresh}
    />
  )
}

export function AssigneeControl({
  requirement,
  roster,
}: {
  requirement: RequirementView
  roster: CoveragePerson[]
}) {
  const refresh = useRefresh()
  return (
    <AssigneePicker
      requirement={requirement}
      roster={roster}
      onSave={(assigneeIds) =>
        setRequirementAssigneesAction({
          requirementId: requirement.id,
          assigneeIds,
        })
      }
      onStale={refresh}
    />
  )
}

export function AttachPhotosControl({
  requirementId,
  requirementTitle,
  viewerId,
  venueId,
}: {
  requirementId: string
  requirementTitle: string
  viewerId: string
  venueId: string
}) {
  const refresh = useRefresh()
  return (
    <AttachPhotosDialog
      requirementTitle={requirementTitle}
      viewerId={viewerId}
      onLoad={(cursor) =>
        loadVenuePhotosAction({ venueId, requirementId, cursor })
      }
      onAttach={(input) =>
        attachPhotosAction({ ...input, venueId, requirementId })
      }
      onStale={refresh}
    />
  )
}

export function NewRequirementControl({
  venueId,
  basePath,
  label,
}: {
  venueId: string
  basePath: string
  label?: string
}) {
  const router = useRouter()
  return (
    <NewRequirementDialog
      triggerLabel={label}
      onCreate={(input) => createRequirementAction({ ...input, venueId })}
      onCreated={(id) => router.push(manageHrefs(basePath).requirement(id))}
    />
  )
}

export function TeamRosterControl({
  period,
  currentPeriod,
  rows,
  canEdit,
  isAdmin,
  basePath,
  venueId,
  venueName,
}: {
  period: PeriodView
  currentPeriod: PeriodKey
  rows: MonthlyProgress[]
  canEdit: boolean
  isAdmin: boolean
  basePath: string
  venueId: string
  venueName?: string
}) {
  const refresh = useRefresh()
  return (
    <TeamRoster
      period={period}
      currentPeriod={currentPeriod}
      rows={rows}
      canEdit={canEdit}
      isAdmin={isAdmin}
      basePath={basePath}
      venueName={venueName}
      onSetTarget={(input) => setMonthlyTargetAction({ ...input, venueId })}
      onStale={refresh}
    />
  )
}

export function PrepareMonthControl({
  venueId,
  label,
  period,
  venueName,
  teamHref,
  available,
}: {
  /** Omit (admins only) to prepare every active venue. */
  venueId?: string
  label?: string
  period?: PeriodKey
  venueName?: string
  teamHref?: string
  available?: boolean
}) {
  const refresh = useRefresh()
  return (
    <PrepareMonthButton
      label={label}
      period={period}
      venueName={venueName}
      teamHref={teamHref}
      available={available}
      onPrepare={() => prepareMonthAction(venueId ? { venueId } : {})}
      onStale={refresh}
    />
  )
}

export function MenuCoverageControl({
  menu,
  evidence,
  basePath,
  venueId,
}: {
  menu: MenuCoverageView
  evidence: Record<string, SubmissionView[]>
  basePath: string
  venueId: string
}) {
  const refresh = useRefresh()
  return (
    <MenuCoveragePanel
      menu={menu}
      evidence={evidence}
      basePath={basePath}
      handlers={{
        start: (menuVersionId) =>
          startMenuCoverageAction({ venueId, menuVersionId }),
        confirm: (input) => confirmMenuCoverageAction(input),
        discard: (input) => discardMenuCoverageAction(input),
        reconcile: (input) => reconcileMenuRequirementAction(input),
      }}
      onStale={refresh}
    />
  )
}

export function ManagerGrantsControl({
  grants,
  venues,
  selectedVenueId,
  candidates,
  includeRevoked,
  basePath,
}: {
  grants: ManagerGrantView[]
  venues: CoverageVenue[]
  selectedVenueId: string | null
  candidates: CoveragePerson[]
  includeRevoked: boolean
  basePath: string
}) {
  const router = useRouter()
  return (
    <ManagerGrants
      grants={grants}
      venues={venues}
      selectedVenueId={selectedVenueId}
      candidates={candidates}
      includeRevoked={includeRevoked}
      basePath={basePath}
      onSelectVenue={(venueId) => {
        const query = new URLSearchParams()
        if (venueId) query.set("venue", venueId)
        if (includeRevoked) query.set("revoked", "1")
        const search = query.toString()
        router.push(search ? `${basePath}?${search}` : basePath)
      }}
      handlers={{
        grant: (input) => grantVenueManagerAction(input),
        revoke: (input) => revokeVenueManagerAction(input),
      }}
      onStale={() => router.refresh()}
    />
  )
}

export function SelfReviewsControl({
  initial,
  period,
  venueId,
}: {
  initial: Page<SelfReviewView>
  period?: PeriodKey
  venueId?: string
}) {
  return (
    <SelfReviewList
      initial={initial}
      onLoadMore={(cursor) =>
        loadSelfReviewsAction({ venueId, period, cursor })
      }
    />
  )
}

export function PreparationRunsControl({
  initial,
  venueNames,
}: {
  initial: Page<PreparationRunView>
  venueNames: Record<string, string>
}) {
  return (
    <PreparationRunList
      initial={initial}
      venueNames={venueNames}
      onLoadMore={(cursor) => loadPreparationRunsAction({ cursor })}
    />
  )
}
