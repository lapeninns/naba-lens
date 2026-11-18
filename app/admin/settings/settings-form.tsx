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
import { Textarea } from "@/components/ui/textarea"
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
  retention: "Retention",
  retentionHint:
    "Unfinished or failed uploads are removed after this many days. Photos that finished sending are never removed automatically; accepted originals are kept until an admin removes them.",
  exports: "Allowed export profiles",
  storage: "Storage",
  reason: "Why are you changing this?",
} as const

/**
 * Organisation settings (spec §8 A7). One form, one main button. Errors are
 * written beside the field they are about (DESIGN.md §6.7); what the admin
 * typed is kept. A save made over someone else's newer change is refused and
 * says to reload.
 */
export function SettingsFormView({ settings }: { settings: OpsSettings }) {
  const [state, action, pending] = useActionState<SaveSettingsState, FormData>(
    saveSettingsAction,
    { status: "idle" }
  )
  const start = settingsForm(settings)
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {}

  return (
    <form action={action} className="grid gap-6" noValidate>
      <input type="hidden" name="revision" value={settings.revision} />

      <FieldSet className="grid gap-4 rounded-card border border-line bg-surface p-4">
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
              className="max-w-40"
            />
          </FormField>
          <FormField label="Quiet until" error={errors.quietEnd}>
            <Input
              name="quietEnd"
              type="time"
              defaultValue={start.quietEnd}
              className="max-w-40"
            />
          </FormField>
        </div>
      </FieldSet>

      <FieldSet className="grid gap-4 rounded-card border border-line bg-surface p-4">
        <FieldLegend className="type-heading-sm">
          {SETTINGS_FORM_COPY.reminders}
        </FieldLegend>
        <FormField
          label="Remind managers about waiting photos every"
          description="Days between review digests, sent only when something waits."
          error={errors.reviewReminderDays}
        >
          <Input
            name="reviewReminderDays"
            inputMode="numeric"
            defaultValue={start.reviewReminderDays}
            className="max-w-28"
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
            className="max-w-28"
          />
        </FormField>
      </FieldSet>

      <FieldSet className="grid gap-4 rounded-card border border-line bg-surface p-4">
        <FieldLegend className="type-heading-sm">
          {SETTINGS_FORM_COPY.retention}
        </FieldLegend>
        <FormField
          label="Remove unfinished uploads after"
          description={SETTINGS_FORM_COPY.retentionHint}
          error={errors.orphanCleanupDays}
        >
          <Input
            name="orphanCleanupDays"
            inputMode="numeric"
            defaultValue={start.orphanCleanupDays}
            className="max-w-28"
          />
        </FormField>
      </FieldSet>

      <FieldSet className="grid gap-3 rounded-card border border-line bg-surface p-4">
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

      <FieldSet className="grid gap-4 rounded-card border border-line bg-surface p-4">
        <FieldLegend className="type-heading-sm">
          {SETTINGS_FORM_COPY.storage}
        </FieldLegend>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Storage quota (GB)"
            description="Your hosting plan's limit for originals."
            error={errors.storageQuotaGb}
          >
            <Input
              name="storageQuotaGb"
              inputMode="numeric"
              defaultValue={start.storageQuotaGb}
              className="max-w-36"
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
              className="max-w-28"
            />
          </FormField>
        </div>
      </FieldSet>

      <FormField
        label={SETTINGS_FORM_COPY.reason}
        description="Kept in Activity with the old and new values."
        error={errors.reason}
      >
        <Textarea name="reason" rows={2} maxLength={500} />
      </FormField>

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

      <div>
        <Button type="submit" variant="primary" loading={pending}>
          {SETTINGS_FORM_COPY.save}
        </Button>
      </div>
    </form>
  )
}
