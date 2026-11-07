import "server-only"

import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr"

import { Notice } from "@/components/nabalens/notice"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { StatusChip } from "@/components/nabalens/status-chip"
import {
  ANSWER_LABEL,
  PROGRESS_LABEL,
  type AmenityResult,
} from "@/lib/amenities/contract"
import { ROUTES } from "@/lib/auth/routes"
import { getCheck, listSubmittableAssets } from "@/lib/server/amenities"
import type { MediaActor } from "@/lib/server/media/types"

import { CaptureClient } from "./capture-client"

/**
 * A page's amenity read, or the matching navigation: sign-in, the blocked
 * page, 404 for anything the caller may not see (unknown and forbidden look
 * the same), and the segment's error boundary for everything else.
 */
export function unwrapAmenity<T extends object>(result: AmenityResult<T>): T {
  if (result.ok) return result
  switch (result.code) {
    case "unauthenticated":
      redirect(ROUTES.login)
    case "account_inactive":
      redirect(ROUTES.blocked)
    case "not_found":
    case "not_permitted":
    case "wrong_venue":
    case "invalid_input":
      notFound()
    default:
      throw new Error(`Amenity read failed: ${result.code}`)
  }
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-11 items-center gap-1.5 self-start rounded-control text-meta-touch font-medium text-ink-muted outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid md:h-9 md:text-meta"
    >
      <ArrowLeftIcon className="size-4" aria-hidden />
      {label}
    </Link>
  )
}

/**
 * One amenity check to capture, for staff (from Home) and for a manager or
 * admin capturing it themselves. Every read re-checks the caller's role in
 * the database; the form's submit does again. Uploading is for staff accounts
 * only (reserve_media_asset), so admins and manager accounts in /manager pass
 * `canUpload={false}` and choose from existing media instead.
 */
export async function CaptureScreen({
  actor,
  checkId,
  mode,
  canUpload = mode !== "admin",
  venueId = null,
  venueName,
  backHref,
  backLabel,
  doneHref,
}: {
  actor: MediaActor
  checkId: string
  mode: "staff" | "manager" | "admin"
  /**
   * Offer the upload flow. Defaults to every mode but admin: staff, and a
   * staff account holding a manager grant in /staff/manage. A manager account
   * in /manager can't upload, so its page passes false.
   */
  canUpload?: boolean
  /** Manager and admin pages: the venue in the URL or grant; another venue's check is a 404. */
  venueId?: string | null
  venueName: string | null
  backHref: string
  backLabel: string
  doneHref: string
}) {
  const [checkResult, assets] = await Promise.all([
    getCheck(actor, { checkId }),
    listSubmittableAssets(actor, { checkId }),
  ])
  const { detail } = unwrapAmenity(checkResult)
  const { check, permissions } = detail
  if (venueId && check.venueId !== venueId) notFound()
  const open = check.status === "active" && permissions.canSubmit

  return (
    <div className="flex min-w-0 flex-col gap-6 pb-4">
      <BackLink href={backHref} label={backLabel} />
      <OfflineNotice />
      <PageHeader
        scope={[venueName, check.entry.category]}
        venueScope={Boolean(venueName)}
        title={check.entry.question}
        summary={
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusChip
              tone={
                check.progress === "complete"
                  ? "positive"
                  : check.progress === "needs_recheck"
                    ? "attention"
                    : "pending"
              }
            >
              {PROGRESS_LABEL[check.progress]}
            </StatusChip>
            {check.answer !== "to_check" ? (
              <span className="text-meta-touch text-ink-muted md:text-meta">
                Current answer: {ANSWER_LABEL[check.answer]}
              </span>
            ) : null}
          </span>
        }
      />
      {open ? (
        <CaptureClient
          check={check}
          viewerId={actor.profile.id}
          initialAssets={assets}
          canUpload={canUpload}
          canAttachLegacy={permissions.canAttachLegacy}
          doneHref={doneHref}
        />
      ) : (
        <Notice tone="plain">
          {check.status === "archived"
            ? "This check was archived, so it can't take a finding."
            : "You can't send a finding for this check. It may have been assigned to someone else."}
        </Notice>
      )}
    </div>
  )
}
