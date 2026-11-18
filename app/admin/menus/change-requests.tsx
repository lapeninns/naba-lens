"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { Notice } from "@/components/nabalens/notice"
import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import type { MenuChangeRequest } from "@/lib/server/menus/local"

import { decideChangeRequestAction } from "./actions"

// Spec §7 M5 / §8 A3: a manager's request for a permanent catalogue change,
// decided here by an admin. Accepting records the decision; the admin then
// makes the change in a draft. Declining or asking for clarification needs a
// reason, which the manager sees.

export const CHANGE_KIND_LABEL: Record<MenuChangeRequest["kind"], string> = {
  add: "Add a dish",
  rename: "Rename",
  remove: "Remove",
  presentation: "Presentation changed",
  other: "Other",
}

type Decision = "accepted" | "declined" | "clarification_requested"

function RequestRow({ request }: { request: MenuChangeRequest }) {
  const router = useRouter()
  const sessionEnded = useSessionEndedCatch()
  const [reason, setReason] = React.useState("")
  const [pending, setPending] = React.useState<Decision | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function decide(decision: Decision) {
    if (pending) return
    if (decision !== "accepted" && !reason.trim()) {
      setError("Give a reason the manager will see.")
      return
    }
    setPending(decision)
    setError(null)
    try {
      const result = await decideChangeRequestAction({
        requestId: request.requestId,
        decision,
        reason: reason.trim() || null,
        revision: request.revision,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.refresh()
    } catch (cause) {
      setError(sessionEnded(cause) ?? "The decision was not saved. Try again.")
    } finally {
      setPending(null)
    }
  }

  return (
    <li className="grid gap-3 py-3">
      <div className="grid gap-1">
        <p className="text-body font-bold text-ink">
          {CHANGE_KIND_LABEL[request.kind]}
          {request.itemName ? ` · ${request.itemName}` : ""}
        </p>
        <p className="text-body break-words text-ink">{request.detail}</p>
        <p className="text-meta text-ink-muted">
          {request.requestedByName ?? "A manager"} ·{" "}
          {new Date(request.requestedAt).toLocaleDateString("en-GB", {
            timeZone: "Europe/London",
          })}
        </p>
      </div>
      <FormField
        label="Reason"
        description="Needed to decline or ask for clarification."
        error={error}
      >
        <Textarea
          value={reason}
          maxLength={500}
          rows={2}
          onChange={(event) => setReason(event.target.value)}
          disabled={pending !== null}
        />
      </FormField>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="sm"
          onClick={() => decide("accepted")}
          disabled={pending !== null}
          aria-busy={pending === "accepted" || undefined}
        >
          Accept
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => decide("clarification_requested")}
          disabled={pending !== null}
        >
          Ask for clarification
        </Button>
        <Button
          variant="quiet"
          size="sm"
          onClick={() => decide("declined")}
          disabled={pending !== null}
        >
          Decline
        </Button>
      </div>
    </li>
  )
}

export function ChangeRequestsPanel({
  requests,
}: {
  requests: MenuChangeRequest[]
}) {
  const open = requests.filter((r) => r.status === "open")
  if (open.length === 0)
    return (
      <Notice>
        No open requests. Managers ask for permanent changes here.
      </Notice>
    )
  return (
    <>
      <Notice>
        Accepting records your decision. Make the change in a draft, then
        activate it.
      </Notice>
      <ul className="divide-y divide-line">
        {open.map((r) => (
          <RequestRow key={r.requestId} request={r} />
        ))}
      </ul>
    </>
  )
}
