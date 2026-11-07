"use client"

import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { GUIDE_PATH } from "../guide/task-photo-guide"
import { Notice } from "../notice"
import { PhotoSourceActions, LIBRARY_LABEL } from "../photo-source"
import { useAdd } from "../shell/add-context"

/**
 * Home's invitation to add photos: a question that follows the person's work
 * details ("What did you cook today?"), the photo library first and the
 * camera second. Both open the one Add queue's picker in the same click.
 */
export function ContributeCard({
  prompt,
  blocked,
  fallbackHref = "/staff",
}: {
  /** homePrompt(work role); the general question when there is none. */
  prompt: string
  /** Why photos can't be added (no or inactive venue), or null. */
  blocked: string | null
  /** Outside the staff layout (previews), where photos are added instead. */
  fallbackHref?: string
}) {
  const openAdd = useAdd()
  return (
    <section
      aria-labelledby="contribute-heading"
      className="flex flex-col gap-3 rounded-xl border border-line bg-card p-4"
    >
      <div className="grid gap-1">
        <h2
          id="contribute-heading"
          className="font-display text-section-title-touch text-ink md:text-section-title"
        >
          {prompt}
        </h2>
        <p className="text-body-touch text-ink-muted md:text-body-sm">
          Photos you add are saved to your portfolio. Label them so the right
          dish can be found.
        </p>
      </div>
      {blocked ? (
        <Notice tone="attention" role="status">
          {blocked}
        </Notice>
      ) : openAdd ? (
        <PhotoSourceActions
          layout="row"
          onChoose={(source) => openAdd({ source })}
        />
      ) : (
        <Link
          href={fallbackHref}
          className={cn(buttonVariants({ size: "touch" }), "w-full sm:w-auto")}
        >
          {LIBRARY_LABEL}
        </Link>
      )}
      <Link
        href={GUIDE_PATH}
        className="inline-flex min-h-11 items-center self-start text-body-touch font-semibold text-accent-text underline underline-offset-3 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid md:min-h-0 md:text-body"
      >
        How to photograph a dish
      </Link>
    </section>
  )
}
