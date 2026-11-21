"use client"

import * as React from "react"
import { useActionState } from "react"

import { Notice } from "@/components/nabalens/notice"
import { Button } from "@/components/ui/button"
import { FieldLegend, FieldSet, FormField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Photo } from "@/components/ui/photo"
import { Radio, RadioGroup } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import {
  SHOT_TEMPLATE_MAX,
  type ExampleChoice,
  type ShotTemplate,
} from "@/lib/album/brief"

import { saveShotTemplateAction, type SaveShotTemplateState } from "../actions"

export const SHOT_TEMPLATE_COPY = {
  instruction: "Instruction",
  instructionHint: `One line on what the photo must show, up to ${SHOT_TEMPLATE_MAX} characters. Staff read it beside a slot when no manager has written a brief.`,
  example: "Example photo",
  exampleHint:
    "Optional. Only photos accepted for public use in the Library can be chosen. Staff see it beside the instruction.",
  noExample: "No example",
  current: "Current example",
  currentHidden:
    "Current example: no longer accepted for public use, so staff do not see it",
  reason: "Why are you changing this?",
  save: "Save template",
  saved: "Template saved. The change is in Activity.",
  unchanged: "Nothing changed.",
  older: "Older photos",
  none: "No photos are accepted for public use yet.",
  // The preview beside the form (second handoff).
  preview: "What staff will read",
  previewExample: "Example of a good photo",
  previewEmpty: "No instruction yet.",
} as const

const photoSrc = (assetId: string) =>
  `/api/media/${encodeURIComponent(assetId)}/thumb`

const uploadedOn = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })

/**
 * One category's shot template (FA-52; spec §8 A7). The instruction is one
 * line; the example is one Library photo accepted for public use, or none.
 * One form, one main button; errors sit beside their field (DESIGN.md §6.7)
 * and what the admin typed is kept. A save over someone else's newer change
 * is refused and says to reload.
 */
export function ShotTemplateForm({
  template,
  storedExampleAssetId,
  choices,
  olderHref,
}: {
  template: ShotTemplate
  /** The stored example, shown or not (it may have stopped qualifying). */
  storedExampleAssetId: string | null
  choices: ExampleChoice[]
  olderHref: string | null
}) {
  const [state, action, pending] = useActionState<
    SaveShotTemplateState,
    FormData
  >(saveShotTemplateAction, { status: "idle" })
  const start =
    state.status === "error" && state.values
      ? state.values
      : {
          instruction: template.instruction,
          exampleAssetId: storedExampleAssetId ?? "",
          reason: "",
        }
  const [example, setExample] = React.useState(start.exampleAssetId)
  const [instruction, setInstruction] = React.useState(start.instruction)
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {}
  const revision = state.status === "saved" ? state.revision : template.revision
  const listed = choices.filter((c) => c.assetId !== storedExampleAssetId)

  return (
    // Second handoff: the form left; what staff will read beside it, live.
    <div className="grid min-w-0 items-start gap-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <form action={action} className="grid min-w-0 gap-6" noValidate>
        <input type="hidden" name="category" value={template.category} />
        <input type="hidden" name="revision" value={revision} />
        <input type="hidden" name="exampleAssetId" value={example} />

        {state.status === "saved" ? (
          <Notice tone="positive" role="status">
            {state.changed
              ? SHOT_TEMPLATE_COPY.saved
              : SHOT_TEMPLATE_COPY.unchanged}
          </Notice>
        ) : null}
        {state.status === "error" && !state.fieldErrors ? (
          <Notice tone="negative" role="alert">
            {state.message}
          </Notice>
        ) : null}

        <FormField
          label={SHOT_TEMPLATE_COPY.instruction}
          description={`${SHOT_TEMPLATE_COPY.instructionHint} ${[...instruction].length} of ${SHOT_TEMPLATE_MAX}.`}
          error={errors.instruction}
        >
          <Input
            name="instruction"
            value={instruction}
            maxLength={SHOT_TEMPLATE_MAX}
            onChange={(e) => setInstruction(e.target.value)}
          />
        </FormField>

        <FieldSet className="grid gap-3">
          <FieldLegend className="type-heading-sm">
            {SHOT_TEMPLATE_COPY.example}
          </FieldLegend>
          <p className="text-meta text-ink-muted">
            {SHOT_TEMPLATE_COPY.exampleHint}
          </p>
          <RadioGroup
            aria-label={SHOT_TEMPLATE_COPY.example}
            value={example}
            onValueChange={(v) => setExample(typeof v === "string" ? v : "")}
            className="grid grid-cols-2 gap-3 sm:grid-cols-3"
            data-slot="example-choices"
          >
            <label className="col-span-2 flex min-h-12 items-center gap-3 rounded-card bg-surface p-3 edge focus-ring-within sm:col-span-3">
              <Radio value="" focus="parent" />
              <span className="text-body">{SHOT_TEMPLATE_COPY.noExample}</span>
            </label>
            {storedExampleAssetId ? (
              <ChoiceTile
                assetId={storedExampleAssetId}
                caption={
                  template.exampleUnavailable
                    ? SHOT_TEMPLATE_COPY.currentHidden
                    : SHOT_TEMPLATE_COPY.current
                }
              />
            ) : null}
            {listed.map((c) => (
              <ChoiceTile
                key={c.assetId}
                assetId={c.assetId}
                caption={`${c.venueName} · ${uploadedOn(c.uploadedAt)}`}
              />
            ))}
          </RadioGroup>
          {choices.length === 0 && !storedExampleAssetId ? (
            <p className="text-meta text-ink-muted">
              {SHOT_TEMPLATE_COPY.none}
            </p>
          ) : null}
          {olderHref ? (
            <a
              href={olderHref}
              className="justify-self-start font-semibold text-ink underline focus-ring"
            >
              {SHOT_TEMPLATE_COPY.older}
            </a>
          ) : null}
        </FieldSet>

        <FormField
          label={SHOT_TEMPLATE_COPY.reason}
          optional
          error={errors.reason}
        >
          <Textarea name="reason" defaultValue={start.reason} rows={2} />
        </FormField>

        <div>
          <Button type="submit" variant="primary" disabled={pending}>
            {SHOT_TEMPLATE_COPY.save}
          </Button>
        </div>
      </form>
      <section
        aria-labelledby="shot-template-preview"
        className="grid min-w-0 content-start gap-3 rounded-card border border-line bg-surface p-4 md:sticky md:top-4"
        data-slot="shot-template-preview"
      >
        <h2 id="shot-template-preview" className="type-section-title text-ink">
          {SHOT_TEMPLATE_COPY.preview}
        </h2>
        <p className="text-body [overflow-wrap:anywhere] text-ink">
          {instruction.trim() || SHOT_TEMPLATE_COPY.previewEmpty}
        </p>
        {example ? (
          <figure className="grid gap-1.5">
            <Photo src={photoSrc(example)} alt="" ratio="4/3" />
            <figcaption className="text-meta text-ink-muted">
              {SHOT_TEMPLATE_COPY.previewExample}
            </figcaption>
          </figure>
        ) : null}
      </section>
    </div>
  )
}

function ChoiceTile({
  assetId,
  caption,
}: {
  assetId: string
  caption: string
}) {
  return (
    <label
      className="grid content-start gap-2 rounded-card bg-surface p-2 edge focus-ring-within has-data-checked:inset-ring-2 has-data-checked:inset-ring-select"
      data-asset-id={assetId}
    >
      <Photo src={photoSrc(assetId)} alt="" ratio="1/1" radius="square" />
      <span className="flex items-start gap-2">
        <Radio value={assetId} focus="parent" aria-label={caption} />
        <span className="text-meta [overflow-wrap:anywhere] text-ink-muted">
          {caption}
        </span>
      </span>
    </label>
  )
}
