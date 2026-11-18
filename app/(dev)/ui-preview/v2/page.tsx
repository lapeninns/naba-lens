import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { V2Preview } from "./v2-preview"

export const metadata: Metadata = {
  title: "Design system v2 (dev only)",
  robots: { index: false, follow: false },
}

/**
 * Dev-only reference for design system v2 (D10): every one of v2's 21
 * components as this app builds it, in light and dark, at phone and desktop
 * widths. 404 in production.
 */
export default function V2PreviewPage() {
  if (process.env.NODE_ENV === "production") notFound()
  return <V2Preview />
}
