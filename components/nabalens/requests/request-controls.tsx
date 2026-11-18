"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { Notice } from "@/components/nabalens/notice"
import { OptionSelect } from "@/components/nabalens/option-select"
import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  PRIORITIES,
  REASON_MAX,
  REQUEST_BRIEF_MAX,
  REQUEST_WORDS,
  type Priority,
  type RequestPerson,
  type RequestView,
} from "@/lib/requests/model"

/*
 * What a manager can do with an open request (spec §7 M4, §3.3): change the
 * brief, person, date and priority; block it with a reason or unblock it;
 * cancel it with a reason (a task's archive); complete by hand a request
 * with no slot. A slot or fact request completes on its own. Each write
 * sends the revision it was read at, so a stale change is refused.
 */

type Result = { ok: true } | { ok: false; error: string; field?: string }
export type RequestControlActions = {
  edit: (input: {
    requestId: string
    revision: number
    patch: Record<string, unknown>
  }) => Promise<Result>
  setBlocked: (input: {
    requestId: string
    revision: number
    reason: string | null
  }) => Promise<Result>
  close: (input: {
    requestId: string
    revision: number
    state: "completed" | "cancelled"
    reason: string | null
  }) => Promise<Result>
}

function useRun() {
  const router = useRouter()
  const sessionEnded = useSessionEndedCatch()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<{
    message: string
    field?: string
  } | null>(null)
  const run = async (call: () => Promise<Result>) => {
    if (busy) return false
    setBusy(true)
    setError(null)
    try {
      const result = await call()
      if (!result.ok) {
        setError({ message: result.error, field: result.field })
        return false
      }
      router.refresh()
      return true
    } catch (cause) {
      setError({
        message:
          sessionEnded(cause) ??
          "That didn't go through. Check your connection and try again.",
      })
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

export function RequestControls({
  request,
  people,
  today,
  actions,
}: {
  request: RequestView
  people: RequestPerson[]
  today: string
  actions: RequestControlActions
}) {
  const ref = { requestId: request.id, revision: request.revision }
  const fact = request.type === "fact_confirmation"
  const manual = !request.slot && !request.fact
  return (
    <div className="grid gap-4" data-slot="request-controls">
      <EditForm
        request={request}
        people={fact ? people.filter((p) => p.role === "manager") : people}
        today={today}
        save={(patch) => actions.edit({ ...ref, patch })}
      />
      <ReasonForm
        key={`block-${request.revision}`}
        title={request.blockedReason ? "Unblock" : "Block"}
        description={
          request.blockedReason
            ? `Blocked: ${request.blockedReason}`
            : "Say why it can't be done for now, such as the dish being off."
        }
        withReason={!request.blockedReason}
        button={request.blockedReason ? "Unblock" : "Block with this reason"}
        submit={(reason) =>
          actions.setBlocked({
            ...ref,
            reason: request.blockedReason ? null : reason,
          })
        }
      />
      {manual ? (
        <ReasonForm
          key={`complete-${request.revision}`}
          title="Mark completed"
          description="This request has no slot, so you decide when it is done."
          withReason={false}
          button="Mark completed"
          submit={() =>
            actions.close({ ...ref, state: "completed", reason: null })
          }
        />
      ) : null}
      <ReasonForm
        key={`cancel-${request.revision}`}
        title="Cancel the request"
        description="The reason is kept in its history."
        withReason
        danger
        button="Cancel with this reason"
        submit={(reason) =>
          actions.close({ ...ref, state: "cancelled", reason })
        }
      />
    </div>
  )
}

function EditForm({
  request,
  people,
  today,
  save,
}: {
  request: RequestView
  people: RequestPerson[]
  today: string
  save: (patch: Record<string, unknown>) => Promise<Result>
}) {
  const { busy, error, run } = useRun()
  const [brief, setBrief] = React.useState(request.brief)
  const [priority, setPriority] = React.useState<Priority>(request.priority)
  const [assigneeId, setAssignee] = React.useState<string | null>(
    request.assignee?.id ?? null
  )
  const [date, setDate] = React.useState(request.date ?? "")
  const fact = request.type === "fact_confirmation"
  const patch = () => {
    const out: Record<string, unknown> = {}
    if (brief.trim() !== request.brief) out.brief = brief.trim()
    if (priority !== request.priority) out.priority = priority
    if (assigneeId !== (request.assignee?.id ?? null))
      out.assigneeId = assigneeId
    if ((date || null) !== request.date) out.date = date || null
    return out
  }
  const fieldError = (field: string) =>
    error?.field === field ? error.message : undefined
  return (
    <form
      noValidate
      className="grid gap-3 rounded-card bg-surface p-3 shadow-card sm:p-4"
      onSubmit={(event) => {
        event.preventDefault()
        const changes = patch()
        if (Object.keys(changes).length === 0) return
        void run(() => save(changes))
      }}
    >
      <h2 className="type-section-title text-ink">Change the request</h2>
      {error && !error.field ? (
        <Notice tone="negative" role="alert">
          {error.message}
        </Notice>
      ) : null}
      <FormField label="Brief" error={fieldError("brief")}>
        <Input
          value={brief}
          maxLength={REQUEST_BRIEF_MAX}
          onChange={(e) => setBrief(e.target.value)}
        />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Priority">
          <OptionSelect
            options={PRIORITIES.map((p) => ({
              id: p,
              name: REQUEST_WORDS.priority[p],
            }))}
            value={priority}
            onValueChange={(v) => v && setPriority(v as Priority)}
          />
        </FormField>
        <FormField
          label={fact ? "Who confirms it" : "Person"}
          optional={!fact}
          error={fieldError("assigneeId")}
        >
          <OptionSelect
            options={[
              ...people.map((p) => ({ id: p.id, name: p.name })),
              ...(request.assignee &&
              !people.some((p) => p.id === request.assignee!.id)
                ? [{ id: request.assignee.id, name: request.assignee.name }]
                : []),
            ]}
            value={assigneeId}
            onValueChange={setAssignee}
            emptyLabel={fact ? undefined : "Anyone at the venue"}
          />
        </FormField>
        <FormField
          label={request.slot ? "Needed by" : "Due"}
          optional
          error={fieldError("date")}
        >
          <Input
            type="date"
            min={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </FormField>
      </div>
      <Button type="submit" variant="secondary" loading={busy} disabled={busy}>
        Save changes
      </Button>
    </form>
  )
}

function ReasonForm({
  title,
  description,
  withReason,
  button,
  danger = false,
  submit,
}: {
  title: string
  description: string
  withReason: boolean
  button: string
  danger?: boolean
  submit: (reason: string) => Promise<Result>
}) {
  const { busy, error, run } = useRun()
  const [reason, setReason] = React.useState("")
  const [missing, setMissing] = React.useState(false)
  return (
    <form
      noValidate
      className="grid gap-3 rounded-card bg-surface p-3 shadow-card sm:p-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (withReason && !reason.trim()) {
          setMissing(true)
          return
        }
        setMissing(false)
        void run(() => submit(reason.trim()))
      }}
    >
      <h2 className="type-section-title text-ink">{title}</h2>
      <p className="text-body text-ink-muted">{description}</p>
      {error && error.field !== "reason" ? (
        <Notice tone="negative" role="alert">
          {error.message}
        </Notice>
      ) : null}
      {withReason ? (
        <FormField
          label="Reason"
          error={
            missing
              ? "Add a short reason."
              : error?.field === "reason"
                ? error.message
                : undefined
          }
        >
          <Input
            value={reason}
            maxLength={REASON_MAX}
            onChange={(e) => setReason(e.target.value)}
          />
        </FormField>
      ) : null}
      <Button
        type="submit"
        variant={danger ? "danger-quiet" : "secondary"}
        loading={busy}
        disabled={busy}
      >
        {button}
      </Button>
    </form>
  )
}
