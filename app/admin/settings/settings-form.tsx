"use client"

import { useActionState } from "react"

import { Notice } from "@/components/nabalens/notice"
import { Button } from "@/components/ui/button"
import {
  FieldError,
  FieldSet,
  FieldLegend,
  FormField,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionRow } from "@/components/ui/option-row"
import {
  EXPORT_PROFILES,
  quietHoursText,
  settingsForm,
  type OpsSettings,
} from "@/lib/ops/settings"

import { saveSettingsAction, type SaveSettingsState } from "./actions"

export const SETTINGS_FORM_COPY = {
  save: "Save settings",
  saved: "Settings saved. The change is in Activity.",
  unchanged: "Nothing changed.",
  quiet: "Quiet hours",
  quietHint:
    "Read in each venue's own time. Digests wait until quiet hours end; in-app notices are still listed.",
  reminders: "Reminders and alerts",
  retention: "Retention and storage",
  retentionHint:
    "Unfinished or failed uploads are removed after this many days. Photos that finished sending are never removed automatically; accepted originals are kept until an admin removes them.",
  exports: "Allowed export profiles",
  reason: "Why are you changing this?",
  reasonHint: "Kept with the change in Activity",
} as const

/** A group of fields inside the one rules card: a legend, no second frame. */
const GROUP = "grid gap-4 border-t border-line pt-4 first:border-t-0 first:pt-0"

/**
 * Organisation settings (spec §8 A7; handoff "Settings › Rules"). One card,
 * one form, one main button, with the reason field beside it because every
 * change needs one. Errors are written beside the field they are about
 * (DESIGN.md §6.7); what the admin typed is kept. A save made over someone
 * else's newer change is refused and says to reload.
 */
export function SettingsFormView({ settings }: { settings: OpsSettings }) {
  const [state, action, pending] = useActionState<SaveSettingsState, FormData>(
    saveSettingsAction,
    { status: "idle" }
  )
  // After a refused save React resets the form; show what was sent again.
  const start =
    state.status === "error" && state.values
      ? state.values
      : settingsForm(settings)
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {}

  return (
    <form
      action={action}
      className="grid gap-4 rounded-card bg-surface p-4 shadow-card"
      noValidate
    >
      <input type="hidden" name="revision" value={settings.revision} />

      <FieldSet className={GROUP}>
        <FieldLegend className="type-heading-sm">
          {SETTINGS_FORM_COPY.quiet}
        </FieldLegend>
        <p className="text-meta text-ink-muted">
          Now{" "}
          {quietHoursText(
            settings.quietStart,
            settings.quietEnd,
            settings.timezone
          )}
          . {SETTINGS_FORM_COPY.quietHint}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Quiet from" error={errors.quietStart}>
            <Input
              name="quietStart"
              type="time"
              defaultValue={start.quietStart}
            />
          </FormField>
          <FormField label="Quiet until" error={errors.quietEnd}>
            <Input name="quietEnd" type="time" defaultValue={start.quietEnd} />
          </FormField>
        </div>
      </FieldSet>

      <FieldSet className={GROUP}>
        <FieldLegend className="type-heading-sm">
          {SETTINGS_FORM_COPY.reminders}
        </FieldLegend>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Remind managers about waiting photos every"
            description="Days between review digests, sent only when something waits."
            error={errors.reviewReminderDays}
          >
            <Input
              name="reviewReminderDays"
              inputMode="numeric"
              defaultValue={start.reviewReminderDays}
            />
          </FormField>
          <FormField
            label="Tell admins when a photo has waited longer than"
            description="Days. Shown as an exception here and sent to admins once a week."
            error={errors.backlogAlertDays}
          >
            <Input
              name="backlogAlertDays"
              inputMode="numeric"
              defaultValue={start.backlogAlertDays}
            />
          </FormField>
        </div>
      </FieldSet>

      <FieldSet className={GROUP}>
        <FieldLegend className="type-heading-sm">
          {SETTINGS_FORM_COPY.retention}
        </FieldLegend>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Remove unfinished uploads after"
            description={SETTINGS_FORM_COPY.retentionHint}
            error={errors.orphanCleanupDays}
            className="sm:col-span-2"
          >
            <Input
              name="orphanCleanupDays"
              inputMode="numeric"
              defaultValue={start.orphanCleanupDays}
              className="sm:max-w-[calc(50%-0.5rem)]"
            />
          </FormField>
          <FormField
            label="Storage quota (GB)"
            description="Your hosting plan's limit for originals."
            error={errors.storageQuotaGb}
          >
            <Input
              name="storageQuotaGb"
              inputMode="numeric"
              defaultValue={start.storageQuotaGb}
            />
          </FormField>
          <FormField
            label="Warn admins at (per cent)"
            description="Before uploads are blocked. Nothing is deleted to make room."
            error={errors.storageAlertPercent}
          >
            <Input
              name="storageAlertPercent"
              inputMode="numeric"
              defaultValue={start.storageAlertPercent}
            />
          </FormField>
        </div>
      </FieldSet>

      <FieldSet className={GROUP}>
        <FieldLegend className="type-heading-sm">
          {SETTINGS_FORM_COPY.exports}
        </FieldLegend>
        <div className="grid gap-2 sm:grid-cols-2">
          {EXPORT_PROFILES.map((p) => (
            <OptionRow
              key={p.id}
              type="checkbox"
              name="exportProfiles"
              value={p.id}
              label={p.label}
              defaultChecked={start.exportProfiles.includes(p.id)}
            />
          ))}
        </div>
        {errors.exportProfiles ? (
          <FieldError>{errors.exportProfiles}</FieldError>
        ) : null}
      </FieldSet>

      {state.status === "error" ? (
        <Notice tone="negative" role="alert">
          {state.message}
        </Notice>
      ) : null}
      {state.status === "saved" ? (
        <Notice tone="positive" role="status">
          {state.changed
            ? SETTINGS_FORM_COPY.saved
            : SETTINGS_FORM_COPY.unchanged}
        </Notice>
      ) : null}

      {/* The reason sits beside Save: every change needs one. */}
      <div className="grid gap-3 border-t border-line pt-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <FormField
          label={SETTINGS_FORM_COPY.reason}
          description={SETTINGS_FORM_COPY.reasonHint}
          error={errors.reason}
        >
          <Input name="reason" maxLength={500} defaultValue={start.reason} />
        </FormField>
        {/* Lines the button up with the input under the label. */}
        <div className="sm:pt-7">
          <Button type="submit" variant="primary" loading={pending}>
            {SETTINGS_FORM_COPY.save}
          </Button>
        </div>
      </div>
    </form>
  )
}
