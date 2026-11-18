"use client"

import { useActionState, useState } from "react"

import { Notice } from "@/components/nabalens/notice"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/field"
import { OptionRow } from "@/components/ui/option-row"
import { Textarea } from "@/components/ui/textarea"
import {
  selfDecisionWords,
  type ReviewSettings,
} from "@/lib/review/single-reviewer"

import {
  setSingleReviewerAction,
  type SingleReviewerState,
} from "./single-reviewer-action"

const IDLE: SingleReviewerState = { status: "idle" }

const when = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/London",
})

/**
 * FA-9 single-reviewer venue (S3-R1 K6): off by default, so nobody decides on
 * their own photo. An admin turns it on with a reason for a venue with one
 * manager; that manager may then decide on their own photos there. Every
 * such decision is listed here for a spot check.
 */
export function SingleReviewerSetting({
  venueId,
  settings,
}: {
  venueId: string
  settings: ReviewSettings
}) {
  const [state, action, pending] = useActionState(setSingleReviewerAction, IDLE)
  const [enabled, setEnabled] = useState(settings.singleReviewer)
  const changed = enabled !== settings.singleReviewer

  return (
    <div
      className="grid gap-4 rounded-card border border-line bg-surface p-4"
      data-testid="single-reviewer"
    >
      <form action={action} className="grid gap-4" noValidate>
        <input type="hidden" name="venueId" value={venueId} />
        <input type="hidden" name="revision" value={settings.revision} />
        <OptionRow
          type="checkbox"
          name="enabled"
          checked={enabled}
          onCheckedChange={(v) => setEnabled(v === true)}
          label="One reviewer is enough here"
          hint="The manager may decide on their own photos. Each one is listed below for a spot check."
          data-testid="single-reviewer-toggle"
        />
        {changed ? (
          <FormField
            label="Why is this changing?"
            error={state.status === "error" ? state.message : undefined}
            description="Kept in Activity."
          >
            <Textarea name="reason" rows={2} maxLength={500} />
          </FormField>
        ) : null}
        {state.status === "error" && state.field !== "reason" ? (
          <Notice tone="negative" role="alert">
            {state.message}
          </Notice>
        ) : null}
        {state.status === "saved" ? (
          <Notice tone="positive" role="status">
            {state.changed
              ? "Saved. The change is in Activity."
              : "Nothing changed."}
          </Notice>
        ) : null}
        {changed ? (
          <div>
            <Button
              type="submit"
              variant="secondary"
              loading={pending}
              data-testid="single-reviewer-save"
            >
              Save
            </Button>
          </div>
        ) : null}
      </form>
      <div className="grid gap-2">
        <h3 className="text-label text-ink">Decisions on their own photos</h3>
        {settings.selfDecisions.length === 0 ? (
          <p className="text-body text-ink-muted">None yet.</p>
        ) : (
          <ul
            className="divide-y divide-line overflow-hidden rounded-card border border-line"
            data-testid="self-decisions"
          >
            {settings.selfDecisions.map((d) => (
              <li
                key={`${d.source}-${d.assetId}-${d.at}-${d.action}`}
                className="grid gap-0.5 px-3 py-2"
              >
                <span className="text-body break-words text-ink">
                  {selfDecisionWords(d)}
                </span>
                <span className="text-meta break-words text-ink-muted">
                  {d.by} · {when.format(new Date(d.at))}
                  {d.reason ? ` · ${d.reason}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
