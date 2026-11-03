"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  CaretDownIcon,
  DotsThreeIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react"

import {
  ACTIVE_MEANING_COPY,
  SuggestionList,
  type Option,
} from "@/components/nabalens"
import { Notice } from "@/components/nabalens/notice"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { StatusChip } from "@/components/nabalens/status-chip"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { SuggestionView } from "@/lib/menus/types"

import {
  createDraftFromActiveAction,
  createEmptyDraftAction,
  resolveSuggestionAction,
} from "./actions"
import { ImportFlow } from "./import-flow"

const versionHref = (id: string) =>
  `/admin/menus/versions/${encodeURIComponent(id)}`

/** The scope line's venue picker: moves to another venue's menus. */
export function VenueSwitch({
  venueId,
  venues,
}: {
  venueId: string
  venues: { id: string; name: string }[]
}) {
  const router = useRouter()
  const id = React.useId()
  return (
    <span className="relative inline-flex items-center">
      <label htmlFor={id} className="sr-only">
        Venue
      </label>
      <select
        id={id}
        value={venueId}
        onChange={(e) =>
          router.push(
            `/admin/menus/${encodeURIComponent(e.currentTarget.value)}`
          )
        }
        className="min-h-11 cursor-pointer appearance-none rounded-control bg-transparent pr-6 pl-1 font-semibold text-ink-muted outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-focus md:min-h-8"
      >
        {venues.map((venue) => (
          <option key={venue.id} value={venue.id}>
            {venue.name}
          </option>
        ))}
      </select>
      <CaretDownIcon
        aria-hidden
        className="pointer-events-none absolute right-1 size-3.5"
      />
    </span>
  )
}

function useCreateDraft(venueId: string) {
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
      router.push(versionHref(result.versionId))
    } catch {
      setError("The draft could not be created. Try again.")
    } finally {
      setPending(null)
    }
  }
  return { pending, error, run }
}

/**
 * A13's header, notices and import panel around the server-rendered lists.
 * "Import a menu" opens the import and compare flow (A14) in place.
 */
export function VenueMenusView({
  venueId,
  venueName,
  venueActive,
  venues,
  active,
  children,
}: {
  venueId: string
  venueName: string
  venueActive: boolean
  venues: { id: string; name: string }[] | null
  /** The venue's active version, if any. */
  active: { title: string } | null
  children: React.ReactNode
}) {
  const draft = useCreateDraft(venueId)
  const [importing, setImporting] = React.useState(false)
  const importRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (importing) importRef.current?.focus()
  }, [importing])

  const busy = draft.pending !== null
  const title = `${venueName} menus`

  return (
    <>
      <PageHeader
        venueScope
        scope={[
          venues && venues.length > 1 ? (
            <VenueSwitch key="venue" venueId={venueId} venues={venues} />
          ) : (
            venueName
          ),
          "All months",
        ]}
        title={title}
        summary={
          <p>
            {!venueActive ? (
              <>
                <StatusChip tone="closed">Venue inactive</StatusChip>{" "}
              </>
            ) : null}
            {ACTIVE_MEANING_COPY}
          </p>
        }
        actions={
          <>
            {active ? (
              <Button
                variant="secondary"
                size="touch"
                onClick={() => draft.run("copy")}
                disabled={busy}
                aria-busy={draft.pending === "copy" || undefined}
              >
                {draft.pending === "copy"
                  ? "Creating draft…"
                  : "Start a draft from the active menu"}
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="touch"
                onClick={() => draft.run("empty")}
                disabled={busy}
                aria-busy={draft.pending === "empty" || undefined}
              >
                {draft.pending === "empty"
                  ? "Creating draft…"
                  : "Start an empty draft"}
              </Button>
            )}
            <Button
              size="touch"
              onClick={() => setImporting(true)}
              disabled={importing}
            >
              <UploadSimpleIcon aria-hidden />
              Import a menu
            </Button>
            {active ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="quiet"
                      size="icon"
                      className="max-md:flex-none!"
                      aria-label={`More actions for ${title}`}
                      disabled={busy}
                    />
                  }
                >
                  <DotsThreeIcon weight="bold" aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-56">
                  <DropdownMenuItem onClick={() => draft.run("empty")}>
                    Start an empty draft
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </>
        }
      />
      {/* minmax(0, 1fr): an auto track would grow to the versions table's
          min-content and push the page wider than the screen. */}
      <div className="grid grid-cols-1 gap-6 md:gap-8">
        <OfflineNotice />
        {draft.error ? <Notice tone="negative">{draft.error}</Notice> : null}
        {importing ? (
          <div
            ref={importRef}
            tabIndex={-1}
            className="rounded-panel outline-none"
          >
            <ImportFlow
              venueId={venueId}
              venueName={venueName}
              activeTitle={active?.title ?? null}
              onClose={() => setImporting(false)}
            />
          </div>
        ) : null}
        {children}
      </div>
    </>
  )
}

/** "More actions for <version>": open it, or copy the active one. */
export function VersionRowActions({
  versionId,
  title,
  venueId,
  isActive,
}: {
  versionId: string
  title: string
  venueId: string
  isActive: boolean
}) {
  const router = useRouter()
  const draft = useCreateDraft(venueId)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="quiet"
              size="icon"
              aria-label={`More actions for ${title}`}
              disabled={draft.pending !== null}
              aria-busy={draft.pending !== null || undefined}
            />
          }
        >
          <DotsThreeIcon weight="bold" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuItem onClick={() => router.push(versionHref(versionId))}>
            Open
          </DropdownMenuItem>
          {isActive ? (
            <DropdownMenuItem onClick={() => draft.run("copy")}>
              Start a draft from this version
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {draft.error ? (
        <p role="alert" className="text-meta text-negative">
          {draft.error}
        </p>
      ) : null}
    </>
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
