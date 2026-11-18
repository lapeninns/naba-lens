"use client"

import { useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { DownloadSimpleIcon } from "@phosphor-icons/react"

import { Notice } from "@/components/nabalens/notice"
import { StatusChip } from "@/components/nabalens/status-chip"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/field"
import { FilterPill, PillGroup } from "@/components/ui/filter-pill"
import { Input } from "@/components/ui/input"
import { OptionRow } from "@/components/ui/option-row"
import { RadioGroup } from "@/components/ui/radio-group"
import { packageHref, type ExportArea } from "@/lib/server/exports/hrefs"
import type {
  ExportCandidate,
  ExportCategory,
  ExportMode,
  ExportProfile,
} from "@/lib/server/exports/model"

import { createPackageAction } from "../actions"
import { CATEGORY_WORDS, EXPORTS_COPY, publicationChip } from "./copy"

/*
 * Choosing what goes in an export package (spec §14.1). Public mode shows
 * only photos approved for public use now; an admin's internal export is a
 * separate page and every internal photo is marked so. One main button
 * (DESIGN.md §11 rule 2): "Make package". Alt text is written and reviewed
 * by the person here; nothing is proposed automatically (Release 2).
 * Selections are kept while the request runs and after an error (§6.7).
 */

const keyFor = (
  c: Pick<ExportCandidate, "assetId" | "subjectKind" | "subjectId">
) => `${c.assetId}/${c.subjectKind}/${c.subjectId}`

const newKey = () =>
  `exp-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now())}`

export function ExportBuilder({
  area,
  mode,
  candidates,
  profiles,
  preselect = [],
}: {
  area: ExportArea
  mode: ExportMode
  candidates: ExportCandidate[]
  profiles: ExportProfile[]
  /**
   * Asset ids chosen in the Library (S2-LIBRARY, spec §8 A4 "export
   * selected"): every candidate row of these assets starts chosen. Ids that
   * are not exportable here are simply not offered.
   */
  preselect?: string[]
}) {
  const router = useRouter()
  const [category, setCategory] = useState<ExportCategory | "all">("all")
  const [chosen, setChosen] = useState<Set<string>>(
    () =>
      new Set(
        candidates
          .filter((c) => preselect.includes(c.assetId))
          .map((c) => keyFor(c))
      )
  )
  const [alt, setAlt] = useState<Record<string, string>>({})
  const [profileKey, setProfileKey] = useState<string>("website")
  const [width, setWidth] = useState("")
  const [height, setHeight] = useState("")
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  // One request key per intent: a retry after a lost answer replays it.
  const requestKey = useRef(newKey())

  const categories = useMemo(() => {
    const counts = new Map<ExportCategory, number>()
    for (const c of candidates)
      counts.set(c.category, (counts.get(c.category) ?? 0) + 1)
    return [...counts.entries()]
  }, [candidates])
  const shown = candidates.filter(
    (c) => category === "all" || c.category === category
  )
  const custom = profileKey === "custom"

  function toggle(c: ExportCandidate, on: boolean) {
    requestKey.current = newKey()
    setChosen((prev) => {
      const next = new Set(prev)
      if (on) next.add(keyFor(c))
      else next.delete(keyFor(c))
      return next
    })
  }

  function submit() {
    setError(null)
    const items = candidates
      .filter((c) => chosen.has(keyFor(c)))
      .map((c) => ({
        assetId: c.assetId,
        subjectKind: c.subjectKind,
        subjectId: c.subjectId,
        altText: alt[keyFor(c)]?.trim() || null,
      }))
    startTransition(async () => {
      const result = await createPackageAction({
        requestKey: requestKey.current,
        mode,
        profileKey,
        items,
        customWidth: custom ? width : null,
        customHeight: custom ? height : null,
        note,
      })
      if (!result.ok) {
        setError(result.message)
        return
      }
      router.push(packageHref(area, result.packageId))
    })
  }

  if (candidates.length === 0) {
    return (
      <Notice role="status">
        {mode === "internal"
          ? "No photos at this venue yet."
          : "No photos at this venue are approved for public use yet. A photo appears here once a manager accepts it."}
      </Notice>
    )
  }

  return (
    <form
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <section aria-labelledby="export-choose" className="grid gap-3">
        <h2 id="export-choose" className="type-section-title text-ink">
          Choose photos
        </h2>
        <PillGroup label="Category">
          <FilterPill
            selected={category === "all"}
            count={candidates.length}
            onClick={() => setCategory("all")}
          >
            All
          </FilterPill>
          {categories.map(([cat, n]) => (
            <FilterPill
              key={cat}
              selected={category === cat}
              count={n}
              onClick={() => setCategory(cat)}
            >
              {CATEGORY_WORDS[cat]}
            </FilterPill>
          ))}
        </PillGroup>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="quiet"
            size="sm"
            onClick={() => {
              requestKey.current = newKey()
              setChosen(
                (prev) => new Set([...prev, ...shown.map((c) => keyFor(c))])
              )
            }}
          >
            Choose all shown
          </Button>
          <Button
            type="button"
            variant="quiet"
            size="sm"
            disabled={chosen.size === 0}
            onClick={() => {
              requestKey.current = newKey()
              setChosen(new Set())
            }}
          >
            Clear
          </Button>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((c) => {
            const k = keyFor(c)
            const on = chosen.has(k)
            return (
              <li
                key={k}
                className="grid gap-2 rounded-card border border-line bg-surface p-3"
              >
                <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URL behind an authorised route */}
                  <img
                    src={`/api/exports/thumb/${c.assetId}`}
                    alt=""
                    width={88}
                    height={88}
                    loading="lazy"
                    className="size-22 rounded-control bg-surface-2 object-cover"
                  />
                  <div className="grid min-w-0 content-start gap-1">
                    <p className="text-label break-words text-ink">
                      {c.subjectLabel}
                    </p>
                    <p className="text-meta text-ink-muted">
                      {CATEGORY_WORDS[c.category]}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {c.approvalLevel === "internal" ? (
                        <StatusChip state="internal_only" />
                      ) : null}
                      <StatusChip
                        state={publicationChip(c.publication.state)}
                      />
                    </div>
                  </div>
                </div>
                <OptionRow
                  type="checkbox"
                  size="sm"
                  label="Include"
                  checked={on}
                  onCheckedChange={(v) => toggle(c, v === true)}
                />
                {on ? (
                  <FormField
                    label="Alt text"
                    optional
                    description="What the photo shows, for people who can't see it. Up to 250 characters."
                  >
                    <Input
                      value={alt[k] ?? ""}
                      maxLength={250}
                      onChange={(e) => {
                        requestKey.current = newKey()
                        setAlt((prev) => ({ ...prev, [k]: e.target.value }))
                      }}
                    />
                  </FormField>
                ) : null}
              </li>
            )
          })}
        </ul>
      </section>

      <section aria-labelledby="export-size" className="grid gap-3">
        <h2 id="export-size" className="type-section-title text-ink">
          Output size
        </h2>
        <RadioGroup
          aria-labelledby="export-size"
          value={profileKey}
          onValueChange={(v) => {
            requestKey.current = newKey()
            setProfileKey(String(v))
          }}
          className="grid gap-2 sm:grid-cols-2"
        >
          {profiles.map((p) => (
            <OptionRow
              key={p.key}
              type="radio"
              value={p.key}
              label={p.label}
              hint={
                p.format === "original"
                  ? "The unchanged file. It may keep camera details, including location."
                  : p.maxWidth && p.maxHeight
                    ? `${p.format === "webp" ? "WebP" : "JPEG"}, fits ${p.maxWidth} × ${p.maxHeight}, no camera details or location`
                    : `${p.format === "webp" ? "WebP" : "JPEG"}, a size you choose, no camera details or location`
              }
            />
          ))}
        </RadioGroup>
        {custom ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Width in pixels" description="64 to 8192">
              <Input
                inputMode="numeric"
                value={width}
                onChange={(e) => setWidth(e.target.value.replace(/\D/g, ""))}
              />
            </FormField>
            <FormField label="Height in pixels" description="64 to 8192">
              <Input
                inputMode="numeric"
                value={height}
                onChange={(e) => setHeight(e.target.value.replace(/\D/g, ""))}
              />
            </FormField>
          </div>
        ) : null}
        <FormField
          label="What it's for"
          optional
          description="Shown in the package list. Up to 200 characters."
        >
          <Input
            value={note}
            maxLength={200}
            onChange={(e) => setNote(e.target.value)}
          />
        </FormField>
      </section>

      <div className="grid gap-2">
        {error ? (
          <Notice tone="negative" role="alert">
            {error}
          </Notice>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={chosen.size === 0 || pending}
          aria-busy={pending || undefined}
        >
          <DownloadSimpleIcon aria-hidden weight="bold" />
          {chosen.size === 0
            ? "Choose photos to make a package"
            : `Make package · ${EXPORTS_COPY.items(chosen.size)}`}
        </Button>
        <p className="text-meta text-ink-muted">{EXPORTS_COPY.readMe(area)}</p>
      </div>
    </form>
  )
}
