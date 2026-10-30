"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { CopyIcon, PlusIcon } from "@phosphor-icons/react"

import { SuggestionList, type Option } from "@/components/nabalens"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import type { SuggestionView } from "@/lib/menus/types"

import {
  createDraftFromActiveAction,
  createEmptyDraftAction,
  resolveSuggestionAction,
} from "./actions"

/** "New empty draft" and "Start a draft from the active menu". */
export function NewDraftButtons({
  venueId,
  hasActive,
}: {
  venueId: string
  hasActive: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = React.useState<"empty" | "copy" | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function run(kind: "empty" | "copy") {
    setPending(kind)
    setError(null)
    try {
      const result =
        kind === "empty"
          ? await createEmptyDraftAction(venueId)
          : await createDraftFromActiveAction(venueId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.push(`/admin/menus/versions/${result.versionId}`)
    } catch {
      setError("The draft could not be created. Try again.")
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        {hasActive ? (
          <Button
            size="touch"
            onClick={() => run("copy")}
            disabled={pending !== null}
            aria-busy={pending === "copy" || undefined}
          >
            <CopyIcon data-icon="inline-start" aria-hidden />
            {pending === "copy"
              ? "Creating draft…"
              : "Start a draft from the active menu"}
          </Button>
        ) : null}
        <Button
          variant={hasActive ? "outline" : "default"}
          size="touch"
          onClick={() => run("empty")}
          disabled={pending !== null}
          aria-busy={pending === "empty" || undefined}
        >
          <PlusIcon data-icon="inline-start" aria-hidden />
          {pending === "empty" ? "Creating draft…" : "New empty draft"}
        </Button>
      </div>
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}

/** Missing-item suggestions: link to an active-menu item, or dismiss. */
export function SuggestionsPanel({
  suggestions,
  itemOptions,
}: {
  suggestions: SuggestionView[]
  itemOptions: Option[]
}) {
  return (
    <SuggestionList
      suggestions={suggestions}
      itemOptions={itemOptions}
      onResolve={(suggestionId, itemId) =>
        resolveSuggestionAction({
          suggestionId,
          status: "resolved",
          itemId,
          note: null,
        })
      }
      onDismiss={(suggestionId) =>
        resolveSuggestionAction({
          suggestionId,
          status: "dismissed",
          itemId: null,
          note: null,
        })
      }
    />
  )
}
