"use client"

import Link from "next/link"
import { ChatCircleTextIcon, LockIcon } from "@phosphor-icons/react"

import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { GUIDE_PATH } from "../guide/task-photo-guide"
import { Notice } from "../notice"
import { PhotoSourceActions, LIBRARY_LABEL } from "../photo-source"
import { useAdd } from "../shell/add-context"
import { ENTRY_COPY } from "../shell/entry-copy"

/**
 * Home's invitation to add photos: a question that follows the person's work
 * details ("What did you cook today?"), the photo library first and the
 * camera second. Both open the one Add queue's picker in the same click.
 */
export function ContributeCard({
  prompt,
  blocked,
  fallbackHref = "/staff",
  canAnswer = false,
}: {
  /** homePrompt(work role); the general question when there is none. */
  prompt: string
  /** Why photos can't be added (no or inactive venue), or null. */
  blocked: string | null
  /** Outside the staff layout (previews), where photos are added instead. */
  fallbackHref?: string
  /**
   * The shared entry offers "Answer a venue question" (B02-02, §3.3): the
   * venue has a working list this person can answer.
   */
  canAnswer?: boolean
}) {
  const openAdd = useAdd()
  return (
    <section
      aria-labelledby="contribute-heading"
      className="grid min-w-0 gap-3 rounded-card bg-surface p-4 shadow-card"
    >
      <div className="grid gap-1">
        <h2
          id="contribute-heading"
          className="font-display text-section-title [overflow-wrap:anywhere] text-ink"
        >
          {prompt}
        </h2>
        <p className="text-meta text-ink-muted">
          Photos you add are saved to your portfolio. Label them so the right
          dish can be found.
        </p>
      </div>
      <div className="border-t border-line pt-3">
        {blocked ? (
          <Notice tone="attention" role="status" icon={LockIcon}>
            {blocked}
          </Notice>
        ) : openAdd ? (
          <div className="flex flex-col gap-2">
            <PhotoSourceActions
              layout="row"
              libraryVariant="secondary"
              onChoose={(source) => openAdd({ source })}
            />
            {canAnswer ? (
              <Button
                type="button"
                variant="secondary"
                size="touch"
                onClick={() => openAdd({ entry: "question" })}
              >
                <ChatCircleTextIcon data-icon="inline-start" aria-hidden />
                {ENTRY_COPY.intents.question}
              </Button>
            ) : null}
          </div>
        ) : (
          <Link
            href={fallbackHref}
            className={cn(
              buttonVariants({ variant: "secondary", size: "touch" }),
              "w-full sm:w-auto"
            )}
          >
            {LIBRARY_LABEL}
          </Link>
        )}
      </div>
      <Link
        href={GUIDE_PATH}
        className="inline-flex min-h-11 items-center self-start text-body font-semibold text-accent-text underline underline-offset-3 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
      >
        How to photograph a dish
      </Link>
    </section>
  )
}
