"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { TrashIcon } from "@phosphor-icons/react"

import {
  declineRemovalRequest,
  removeAcceptedMedia,
} from "@/app/_media/removal-actions"
import {
  ReasonDialog,
  ReasonField,
} from "@/components/nabalens/coverage/reason-dialog"
import { EmptyState } from "@/components/nabalens/empty-state"
import { Notice } from "@/components/nabalens/notice"
import { StatusChip } from "@/components/nabalens/status-chip"
import { Button, buttonVariants } from "@/components/ui/button"
import type { RemovalImpact, RemovalRequest } from "@/lib/media/removal"

import { formatWhen } from "./format"

/*
 * Permanent removal (spec §8 A4, §16; FA-21; S2-LIBRARY): an explicit admin
 * action with a reason and an impact preview, refused while the photo is
 * published. Built on S1-PRIVACY's media_removal_impact and
 * admin_delete_media_asset: the preview's token is sent back, so a removal
 * whose impact changed since it was shown is refused (impact_changed).
 */

const yes = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

/** What removing the photo touches, as a list of plain sentences. */
export function impactLines(impact: RemovalImpact): string[] {
  const lines: string[] = []
  for (const m of impact.menuItems)
    lines.push(
      `Dish ${m.name}: ${m.state.replace(/_/g, " ")}${m.isPrimary ? ", its main photo" : ""}`
    )
  for (const p of impact.areas)
    lines.push(`Place ${p.label}: ${p.state.replace(/_/g, " ")}`)
  if (impact.coverageSends > 0)
    lines.push(yes(impact.coverageSends, "request send", "request sends"))
  if (impact.amenityAnswers > 0)
    lines.push(
      yes(impact.amenityAnswers, "facility answer", "facility answers")
    )
  if (impact.publicUses > 0)
    lines.push(
      yes(impact.publicUses, "public use in force", "public uses in force")
    )
  if (impact.internalUses > 0)
    lines.push(
      yes(
        impact.internalUses,
        "internal use in force",
        "internal uses in force"
      )
    )
  if (impact.openRequests > 0)
    lines.push(
      yes(impact.openRequests, "open removal request", "open removal requests")
    )
  return lines
}

export function RemovalForm({
  assetId,
  impact,
}: {
  assetId: string
  impact: RemovalImpact
}) {
  const id = React.useId()
  const [reason, setReason] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [done, setDone] = React.useState<"removed" | "pending" | null>(null)
  const lines = impactLines(impact)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (reason.trim().length < 3) {
      setError("Give a reason of at least 3 characters.")
      return
    }
    setPending(true)
    setError(null)
    try {
      const r = await removeAcceptedMedia({
        assetId,
        reason,
        impactToken: impact.token,
      })
      if (!r.ok) setError(r.error)
      else setDone(r.storage)
    } finally {
      setPending(false)
    }
  }

  if (impact.removed || done) {
    return (
      <Notice tone="positive" role="status">
        Permanently removed. The record, its reason and history are kept
        {done === "pending"
          ? "; the stored files will be deleted by the next clean-up."
          : "."}{" "}
        <Link href="/admin" className="font-bold underline underline-offset-4">
          Back to the library
        </Link>
      </Notice>
    )
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <section
        aria-labelledby={`${id}-impact`}
        className="grid gap-2 rounded-card border border-line bg-surface p-4"
        data-testid="removal-impact"
      >
        <h2 id={`${id}-impact`} className="type-section-title text-ink">
          What this removes
        </h2>
        {lines.length === 0 ? (
          <p className="text-body text-ink-muted">
            Nothing else uses this photo.
          </p>
        ) : (
          <ul className="grid list-disc gap-1 ps-5 text-body">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        {impact.accepted ? (
          <p className="text-body text-ink-muted">
            This photo was accepted, so only an admin can remove it.
          </p>
        ) : null}
      </section>
      {impact.blocked ? (
        <Notice tone="negative" role="alert">
          This photo is published. Withdraw its public uses first, then come
          back to remove it.
        </Notice>
      ) : (
        <>
          <ReasonField
            id={`${id}-reason`}
            label="Why it must be removed"
            value={reason}
            onChange={setReason}
            disabled={pending}
            help="Kept with the record. Removal can't be undone."
          />
          {error ? (
            <p role="alert" className="text-body font-semibold text-warn-fg">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/admin/library/${assetId}`}
              className={buttonVariants({ variant: "secondary" })}
            >
              Cancel
            </Link>
            <Button type="submit" variant="danger" loading={pending}>
              <TrashIcon aria-hidden />
              Remove permanently
            </Button>
          </div>
        </>
      )}
    </form>
  )
}

/** Open removal requests (from uploaders and managers), oldest first. */
export function RemovalRequestList({
  requests,
}: {
  requests: RemovalRequest[]
}) {
  const router = useRouter()
  const [declining, setDeclining] = React.useState<RemovalRequest | null>(null)

  if (requests.length === 0) {
    return <EmptyState title="No open removal requests." />
  }
  return (
    <>
      <ul className="grid gap-3" data-testid="removal-requests">
        {requests.map((r) => (
          <li
            key={r.requestId}
            className="grid gap-2 rounded-card border border-line bg-surface p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-body font-bold">{r.venueName}</span>
              <StatusChip tone="pending">Open</StatusChip>
            </div>
            <p className="text-body [overflow-wrap:anywhere]">
              {r.requesterName} asked {formatWhen(r.createdAt)}: {r.reason}
            </p>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/admin/library/${r.assetId}`}
                className={buttonVariants({ variant: "secondary", size: "sm" })}
              >
                Open photo
              </Link>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setDeclining(r)}
              >
                Keep the photo
              </Button>
              <Link
                href={`/admin/library/${r.assetId}/remove`}
                className={buttonVariants({
                  variant: "danger-quiet",
                  size: "sm",
                })}
              >
                <TrashIcon aria-hidden />
                Review removal
              </Link>
            </div>
          </li>
        ))}
      </ul>
      <ReasonDialog
        open={declining !== null}
        onOpenChange={(o) => {
          if (!o) setDeclining(null)
        }}
        title="Keep this photo?"
        description="The request is closed and the person who asked sees your reason."
        label="Why it stays"
        confirmLabel="Keep the photo"
        pendingLabel="Saving…"
        onConfirm={async (reason) => {
          if (!declining) return { ok: true }
          const r = await declineRemovalRequest(declining.requestId, reason)
          if (!r.ok) return { ok: false, error: r.error }
          router.refresh()
          return { ok: true }
        }}
      />
    </>
  )
}
