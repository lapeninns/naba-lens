"use client"

import * as React from "react"

import { SectionTabs, type SectionTab } from "../section-tabs"

/**
 * The counts beside Album's tabs (the handoff's Album figures): Menu counts
 * the dishes still Missing, Amenities the findings from staff to confirm.
 * The layout seeds them from reads it already makes; a count it could not
 * read is left out, never shown as zero. Spaces has no count the layout
 * reads, so it shows none.
 */
export type AlbumCounts = { menu?: number; amenities?: number }

const AlbumCountsContext = React.createContext<AlbumCounts>({})

export function AlbumCountsProvider({
  counts,
  children,
}: {
  counts: AlbumCounts
  children: React.ReactNode
}) {
  const { menu, amenities } = counts
  const value = React.useMemo(() => ({ menu, amenities }), [menu, amenities])
  return (
    <AlbumCountsContext.Provider value={value}>
      {children}
    </AlbumCountsContext.Provider>
  )
}

export const ALBUM_COUNT_LABEL = {
  menu: "missing",
  amenities: "to confirm",
} as const

/**
 * Album's section tabs with their counts. Tabs are data from the server;
 * the counts and their words are read here (a Server Component cannot pass
 * a function to a Client Component).
 */
export function AlbumSectionTabs({
  label,
  tabs,
  active,
  className,
}: {
  label: string
  tabs: SectionTab[]
  active: string
  className?: string
}) {
  const counts = React.useContext(AlbumCountsContext)
  const counted = tabs.map((tab) => {
    const key = tab.id === "menu" || tab.id === "amenities" ? tab.id : null
    const value = key ? counts[key] : undefined
    return key && value !== undefined && value > 0
      ? { ...tab, count: { value, label: ALBUM_COUNT_LABEL[key] } }
      : tab
  })
  return (
    <SectionTabs
      label={label}
      tabs={counted}
      active={active}
      className={className}
    />
  )
}
