import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { UiPreview } from "./ui-preview"

export const metadata: Metadata = {
  title: "Naba-Lens UI preview (dev only)",
  robots: { index: false, follow: false },
}

/** Dev-only gallery of every Naba-Lens component with fake data. 404 in production. */
export default function UiPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound()
  return <UiPreview />
}
