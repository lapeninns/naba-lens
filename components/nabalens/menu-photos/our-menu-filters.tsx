import Link from "next/link"
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr"

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

const SEGMENT =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-chip px-3 text-center text-meta-touch font-semibold text-ink-muted outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-0 focus-visible:outline-focus aria-[current=page]:bg-panel aria-[current=page]:text-ink aria-[current=page]:shadow-[0_0_0_1px_var(--color-line-control)] md:min-h-8 md:text-label md:whitespace-nowrap"

const CHIP =
  "inline-flex min-h-11 items-center gap-1.5 rounded-chip border border-line-control px-3 text-meta-touch whitespace-nowrap text-ink outline-none hover:bg-fill-hover focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-focus aria-[current=page]:border-ink aria-[current=page]:bg-ink aria-[current=page]:text-paper md:min-h-8 md:text-meta"

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
              className="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-ink-muted"
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
              className="h-11 pl-9 md:h-9"
            />
          </span>
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="primary"
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
      <nav
        aria-label="Show"
        className="grid w-full grid-cols-2 gap-0.5 rounded-control bg-well p-0.5 md:inline-flex md:w-auto md:justify-self-start"
      >
        <Link
          href={hrefWith({ gapsOnly: false })}
          aria-current={filter.gapsOnly ? undefined : "page"}
          className={SEGMENT}
        >
          {OUR_MENU_COPY.allDishes}
        </Link>
        <Link
          href={hrefWith({ gapsOnly: true })}
          aria-current={filter.gapsOnly ? "page" : undefined}
          className={SEGMENT}
        >
          {OUR_MENU_COPY.gaps}
        </Link>
      </nav>
      {sections.length > 1 ? (
        <nav
          aria-label="Menu sections"
          className="[scrollbar-width:none] overflow-x-auto contain-inline-size [&::-webkit-scrollbar]:hidden"
        >
          <ul className="flex gap-2 pb-1">
            <li className="flex-none">
              <Link
                href={hrefWith({ sectionId: null })}
                aria-current={filter.sectionId ? undefined : "page"}
                className={CHIP}
              >
                {OUR_MENU_COPY.allSections}
              </Link>
            </li>
            {sections.map((section) => (
              <li key={section.sectionId} className="flex-none">
                <Link
                  href={hrefWith({ sectionId: section.sectionId })}
                  aria-current={
                    filter.sectionId === section.sectionId ? "page" : undefined
                  }
                  className={CHIP}
                >
                  {section.name}
                  <span aria-hidden className="tabular-nums opacity-75">
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
