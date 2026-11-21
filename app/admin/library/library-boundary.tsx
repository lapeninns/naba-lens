"use client"

import { usePathname } from "next/navigation"

import { AdminErrorPage, AdminLoadingPage } from "../_components/admin-boundary"
import {
  ADMIN_SECTION_TITLES,
  AdminTabs,
  LIBRARY_TABS,
} from "../_components/admin-tabs"

/**
 * A Library tab root keeps the Library title and tabs; a detail page (a
 * photo, a collection, compare) keeps a BackLink to its parent (redesign R5).
 */
function useLibraryFrame() {
  const pathname = usePathname() ?? ""
  const tab = LIBRARY_TABS.find((t) => t.href === pathname)
  if (tab)
    return {
      section: "content" as const,
      title: ADMIN_SECTION_TITLES.library,
      tabs: <AdminTabs set="library" active={tab.id} />,
    }
  const collection = pathname.startsWith("/admin/library/collections/")
  return {
    section: "content" as const,
    title: collection ? "Collection" : "Photo details",
    back: collection
      ? { href: "/admin/library/collections", label: "Collections" }
      : { href: "/admin", label: ADMIN_SECTION_TITLES.library },
  }
}

export function LibraryError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <AdminErrorPage
      {...useLibraryFrame()}
      what="This part of the library couldn't be loaded"
      error={error}
      retry={retry}
    />
  )
}

export function LibraryLoading() {
  return <AdminLoadingPage {...useLibraryFrame()} label="Loading the library" />
}
