"use client"

import { LibraryError } from "./library-boundary"

/** Library sub-pages (S2-LIBRARY) that could not load. */
export default function AdminLibraryError(props: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return <LibraryError {...props} />
}
