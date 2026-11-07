import Link from "next/link"
import { CheckIcon, MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr"

import { Button, buttonVariants } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

import { OUR_MENU_COPY, sectionCount } from "./copy"
import type { OurMenuSection } from "@/lib/server/coverage/types"

/** What the list shows: the URL's `section`, `filter=gaps` and `q`. */
export type OurMenuFilter = {
  sectionId: string | null
  gapsOnly: boolean
  query: string
}

export const OUR_MENU_QUERY_MAX = 80

/** The list's URL with these filters; empty ones are left out. */
export function ourMenuHref(
  basePath: string,
  filter: Partial<OurMenuFilter> & Record<string, unknown> = {}
): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filter)) {
    if (key === "sectionId" || key === "gapsOnly" || key === "query") continue
    if (typeof value === "string" && value) params.set(key, value)
  }
  if (filter.sectionId) params.set("section", filter.sectionId)
  if (filter.gapsOnly) params.set("filter", "gaps")
  if (filter.query) params.set("q", filter.query)
  const search = params.toString()
  return search ? `${basePath}?${search}` : basePath
}

/*
 * Select pills (DESIGN.md §4): grey; the current one is accent-soft with an
 * accent-text inset edge and a tick. Pills wrap; nothing scrolls sideways.
 */
const PILL =
  "group/pill inline-flex min-h-11 items-center gap-1.5 rounded-round bg-surface-2 px-4 text-label [overflow-wrap:anywhere] text-ink outline-none transition-colors duration-(--duration-quick) hover:bg-raised focus-visible:outline-3 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-focus aria-[current=page]:bg-accent-soft aria-[current=page]:shadow-[inset_0_0_0_1.5px_var(--accent-text)]"

/** The tick on the current pill (decorative: aria-current carries it). */
const tick = (
  <CheckIcon
    aria-hidden
    weight="bold"
    className="hidden size-4 shrink-0 group-aria-[current=page]/pill:inline"
  />
)

/**
 * Search, "Still needs a photo" and the section chips for Our menu. Plain GET
 * links and a GET form, so the filters work before the page hydrates and the
 * URL can be shared.
 */
export function OurMenuFilters({
  basePath,
  filter,
  sections,
  extra = {},
}: {
  basePath: string
  filter: OurMenuFilter
  sections: OurMenuSection[]
  /** Other URL parameters the page keeps (the reviewer's `view`). */
  extra?: Record<string, string>
}) {
  const hrefWith = (change: Partial<OurMenuFilter>) =>
    ourMenuHref(basePath, { ...extra, ...filter, ...change })
  return (
    <div className="grid gap-3">
      <form
        action={basePath}
        method="get"
        role="search"
        aria-label="Menu search"
        className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end"
      >
        {Object.entries(extra).map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
        {filter.sectionId ? (
          <input type="hidden" name="section" value={filter.sectionId} />
        ) : null}
        {filter.gapsOnly ? (
          <input type="hidden" name="filter" value="gaps" />
        ) : null}
        <Field>
          <FieldLabel htmlFor="our-menu-q">{OUR_MENU_COPY.search}</FieldLabel>
          <span className="relative block">
            <MagnifyingGlassIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-ink-muted"
            />
            <Input
              id="our-menu-q"
              name="q"
              type="search"
              autoComplete="off"
              enterKeyHint="search"
              defaultValue={filter.query}
              placeholder={OUR_MENU_COPY.searchPlaceholder}
              maxLength={OUR_MENU_QUERY_MAX}
              className="pl-11"
            />
          </span>
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="secondary"
            size="touch"
            className="flex-auto md:flex-none"
          >
            <MagnifyingGlassIcon aria-hidden />
            {OUR_MENU_COPY.find}
          </Button>
          {filter.query ? (
            <Link
              href={hrefWith({ query: "" })}
              className={cn(
                buttonVariants({ variant: "secondary", size: "touch" }),
                "flex-auto md:flex-none"
              )}
            >
              {OUR_MENU_COPY.clear}
            </Link>
          ) : null}
        </div>
      </form>
      <nav aria-label="Show" className="flex flex-wrap gap-2">
        <Link
          href={hrefWith({ gapsOnly: false })}
          aria-current={filter.gapsOnly ? undefined : "page"}
          className={PILL}
        >
          {tick}
          {OUR_MENU_COPY.allDishes}
        </Link>
        <Link
          href={hrefWith({ gapsOnly: true })}
          aria-current={filter.gapsOnly ? "page" : undefined}
          className={PILL}
        >
          {tick}
          {OUR_MENU_COPY.gaps}
        </Link>
      </nav>
      {sections.length > 1 ? (
        <nav aria-label="Menu sections">
          <ul className="flex flex-wrap gap-2">
            <li className="min-w-0">
              <Link
                href={hrefWith({ sectionId: null })}
                aria-current={filter.sectionId ? undefined : "page"}
                className={PILL}
              >
                {tick}
                {OUR_MENU_COPY.allSections}
              </Link>
            </li>
            {sections.map((section) => (
              <li key={section.sectionId} className="min-w-0">
                <Link
                  href={hrefWith({ sectionId: section.sectionId })}
                  aria-current={
                    filter.sectionId === section.sectionId ? "page" : undefined
                  }
                  className={PILL}
                >
                  {tick}
                  {section.name}
                  <span
                    aria-hidden
                    className="font-mono font-semibold text-ink-muted tabular-nums"
                  >
                    {section.covered}/{section.eligible}
                  </span>
                  <span className="sr-only">
                    , {sectionCount(section.covered, section.eligible)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  )
}
