"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import { ArrowLeftIcon, CheckIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { FilterPill, PillGroup } from "@/components/ui/filter-pill"
import { SearchField } from "@/components/ui/search-field"
import { cn } from "@/lib/utils"

import { PhotoImage, photosWord, trailWords } from "./bits"
import {
  ALL_FOLDERS,
  GROUPS,
  SHELVES,
  folderById,
  folderTrail,
  searchFolders,
  type Folder,
  type Shelf,
} from "./catalogue"
import { photosIn, type PhoneState, type Photo, type PhotoLabel } from "./store"

/*
 * Choose one label for the selected photos. Everything the person must be
 * sure of sits at the top, where the phone keyboard never reaches: the
 * photos themselves, how many there are, and the search. Choosing a result
 * does not save: it fills the bar at the foot, which says what will happen
 * in words ("Label 3 photos as Momo") before the one Save button.
 */

type Filter = "all" | Shelf

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "menu", label: "Dishes" },
  { id: "drinks", label: "Drinks" },
  { id: "spaces", label: "Spaces" },
]

/** How far the on-screen keyboard covers the bottom of the page, in px. */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const view = window.visualViewport
    if (!view) return
    const measure = () =>
      setInset(
        Math.max(
          0,
          Math.round(window.innerHeight - view.height - view.offsetTop)
        )
      )
    measure()
    view.addEventListener("resize", measure)
    view.addEventListener("scroll", measure)
    return () => {
      view.removeEventListener("resize", measure)
      view.removeEventListener("scroll", measure)
    }
  }, [])
  return inset
}

export function LabelPicker({
  photos,
  state,
  onBack,
  onSave,
}: {
  photos: Photo[]
  state: PhoneState
  onBack: () => void
  onSave: (label: PhotoLabel) => void
}) {
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<Filter>("all")
  const [choice, setChoice] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const saveRef = useRef<HTMLButtonElement | null>(null)
  const summaryId = useId()
  const keyboard = useKeyboardInset()
  const count = photos.length

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  // Once a label is chosen the next thing to do is Save, so focus goes
  // there: a keyboard or screen-reader user hears the whole sentence.
  useEffect(() => {
    if (choice) saveRef.current?.focus()
  }, [choice])

  const typed = query.trim() !== ""
  const results = useMemo(() => {
    const found = searchFolders(query)
    return filter === "all" ? found : found.filter((f) => f.shelf === filter)
  }, [query, filter])
  const recent = state.recent
    .map((id) => folderById(id))
    .filter((folder): folder is Folder => folder !== null)

  const chosen = choice ? folderById(choice) : null

  const choose = (id: string) => setChoice((now) => (now === id ? null : id))

  const moveFocus = (event: React.KeyboardEvent, from: "search" | "list") => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    const options = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("[data-option]") ?? []
    )
    if (options.length === 0) return
    const at = options.indexOf(document.activeElement as HTMLElement)
    if (from === "search") {
      if (event.key === "ArrowDown") {
        event.preventDefault()
        options[0].focus()
      }
      return
    }
    event.preventDefault()
    if (event.key === "ArrowUp" && at <= 0) searchRef.current?.focus()
    else options[at + (event.key === "ArrowDown" ? 1 : -1)]?.focus()
  }

  const option = (folder: Folder) => (
    <Option
      key={folder.id}
      id={folder.id}
      on={choice === folder.id}
      onChoose={choose}
      title={folder.name}
      detail={optionDetail(folder, photosIn(state, folder.id).length)}
    />
  )

  const resultWords = typed
    ? results.length === 0
      ? "No matches"
      : results.length === 1
        ? "1 match"
        : `${results.length} matches`
    : ""

  return (
    <div
      className="mx-auto min-h-dvh w-full max-w-feed bg-canvas pb-[calc(13rem+env(safe-area-inset-bottom,0px))] text-ink"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          if (choice) {
            setChoice(null)
            searchRef.current?.focus()
          } else onBack()
        }
      }}
    >
      <div className="sticky top-0 z-sticky grid gap-2 border-b border-line bg-canvas px-gutter pt-2 pb-3">
        <div className="flex items-center gap-2">
          <Button
            variant="quiet"
            size="icon"
            aria-label="Back to the photos"
            onClick={onBack}
            className="-ml-2"
          >
            <ArrowLeftIcon aria-hidden weight="bold" />
          </Button>
          <ul
            aria-label="Selected photos"
            className="flex min-w-0 flex-none items-center -space-x-2"
          >
            {photos.slice(0, 4).map((photo) => (
              <li
                key={photo.id}
                className="w-12 flex-none rounded-square ring-2 ring-canvas"
              >
                <PhotoImage photo={photo} ratio="1/1" radius="square" eager />
              </li>
            ))}
          </ul>
          <h1 className="min-w-0 text-heading" data-picker-title="">
            Label {photosWord(count)}
            {count > 4 ? (
              <span className="block text-meta font-medium text-ink-muted">
                {count - 4} more not shown
              </span>
            ) : null}
          </h1>
        </div>
        <SearchField
          ref={searchRef}
          size="sm"
          label="Find the dish, drink or space"
          hideLabel
          placeholder="Search dishes, drinks and spaces"
          value={query}
          onValueChange={(next) => {
            setQuery(next)
            setChoice(null)
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              listRef.current
                ?.querySelector<HTMLElement>("[data-option]")
                ?.focus()
            } else moveFocus(event, "search")
          }}
          resultCount={resultWords}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>

      <div className="grid gap-4 px-gutter pt-3">
        <PillGroup label="Show">
          {FILTERS.map((item) => (
            <FilterPill
              key={item.id}
              selected={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </FilterPill>
          ))}
        </PillGroup>

        <div
          ref={listRef}
          className="grid gap-5"
          onKeyDown={(event) => moveFocus(event, "list")}
        >
          {typed ? (
            results.length > 0 ? (
              <OptionList label="Matches">{results.map(option)}</OptionList>
            ) : (
              <p className="text-body" data-no-match="">
                Nothing at this pub matches “{query.trim()}”. Check the
                spelling, or choose Label later.
              </p>
            )
          ) : filter === "all" ? (
            <>
              {recent.length > 0 ? (
                <OptionList label="Used just now">
                  {recent.map(option)}
                </OptionList>
              ) : null}
              <p className="text-body text-ink-muted">
                Type a few letters, such as “momo” or “garden”. Or show only
                dishes, drinks or spaces to see the whole list.
              </p>
            </>
          ) : (
            GROUPS[filter].map((group) => (
              <OptionList key={group.id} label={group.name}>
                {group.folders.map(option)}
              </OptionList>
            ))
          )}

          <Button
            variant="quiet"
            onClick={onBack}
            className="justify-self-start"
          >
            Label later
          </Button>
        </div>
      </div>

      {chosen ? (
        <div
          data-confirm=""
          style={{ bottom: keyboard }}
          className="fixed inset-x-0 z-dock mx-auto grid w-full max-w-feed gap-3 bg-surface px-gutter pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] shadow-bar"
        >
          <p id={summaryId} className="grid gap-0.5">
            <span className="text-meta text-ink-muted">
              Label {photosWord(count)} as
            </span>
            <span className="font-display text-title">{chosen.name}</span>
            <span className="text-meta text-ink-muted">
              {trailWords(folderTrail(chosen).slice(0, 3))}
            </span>
          </p>
          <Button
            ref={saveRef}
            variant="primary"
            size="lg"
            className="w-full"
            aria-describedby={summaryId}
            onClick={() => onSave({ type: "folder", folderId: chosen.id })}
          >
            Save label
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function optionDetail(folder: Folder, have: number): string {
  const kind = SHELVES[folder.shelf].one
  const base = `${kind[0].toUpperCase()}${kind.slice(1)} · ${folder.groupName}`
  return have > 0 ? `${base} · ${photosWord(have)} so far` : base
}

function OptionList({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="grid gap-2">
      <h2 id={id} className="text-label text-ink-muted">
        {label}
      </h2>
      <ul className="grid gap-2">{children}</ul>
    </section>
  )
}

function Option({
  id,
  on,
  onChoose,
  title,
  detail,
}: {
  id: string
  on: boolean
  onChoose: (id: string) => void
  title: string
  detail: string
}) {
  return (
    <li>
      <button
        type="button"
        data-option={id}
        aria-pressed={on}
        onClick={() => onChoose(id)}
        className={cn(
          "flex min-h-14 w-full items-center gap-3 rounded-control px-4 py-2 text-left focus-ring transition-colors duration-quick",
          on
            ? "bg-accent-soft edge-selected"
            : "bg-surface edge hover:bg-raised active:bg-raised"
        )}
      >
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="text-heading [overflow-wrap:anywhere]">{title}</span>
          <span className="text-meta text-ink-muted">{detail}</span>
        </span>
        {on ? (
          <CheckIcon
            aria-hidden
            weight="bold"
            className="size-6 flex-none text-accent-text"
          />
        ) : null}
      </button>
    </li>
  )
}

/** How many things can be searched, for the hint under an empty search. */
export const LABEL_COUNT = ALL_FOLDERS.length
