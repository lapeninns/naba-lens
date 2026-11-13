"use client"

import { ArrowClockwiseIcon } from "@phosphor-icons/react"

import { Notice } from "@/components/nabalens/notice"
import { Button } from "@/components/ui/button"

import { QUESTION_FORM_COPY, type QuestionForm } from "./question-form"

/**
 * In place of the capture form when this build has no form for the question
 * (B03 UI design §2.1). A newer form means a newer deploy, so Reload loads the
 * page again in full rather than refreshing its data.
 */
export function QuestionFormNotice({
  form,
}: {
  form: Exclude<QuestionForm, { kind: "b01" } | { kind: "facility" }>
}) {
  if (form.kind === "not_asked")
    return <Notice tone="plain">{QUESTION_FORM_COPY.notAsked}</Notice>
  return (
    <Notice
      tone="attention"
      role="status"
      action={
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => window.location.reload()}
        >
          <ArrowClockwiseIcon aria-hidden />
          {QUESTION_FORM_COPY.reload}
        </Button>
      }
    >
      {QUESTION_FORM_COPY.unknown}
    </Notice>
  )
}
