"use client"

import { PublishingError } from "./publishing-boundary"

export default function AdminPublishingError(props: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return <PublishingError {...props} />
}
