"use client"

import { usePathname } from "next/navigation"

import { AdminErrorPage, AdminLoadingPage } from "../_components/admin-boundary"

/**
 * Publishing's boundaries (redesign R5): the list is a section root; the
 * builder and one package are detail pages with a BackLink to Publishing.
 */
function usePublishingFrame() {
  const pathname = usePathname() ?? ""
  const back = { href: "/admin/publishing", label: "Publishing" }
  if (pathname.startsWith("/admin/publishing/new"))
    return {
      section: "publishing" as const,
      title: "Make an export package",
      back,
    }
  if (pathname.startsWith("/admin/publishing/packages/"))
    return { section: "publishing" as const, title: "Export package", back }
  return { section: "publishing" as const, title: "Publishing" }
}

export function PublishingError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  const frame = usePublishingFrame()
  return (
    <AdminErrorPage
      {...frame}
      what={`${frame.title} couldn't be loaded`}
      error={error}
      retry={retry}
    />
  )
}

export function PublishingLoading() {
  return (
    <AdminLoadingPage {...usePublishingFrame()} label="Loading publishing…" />
  )
}
