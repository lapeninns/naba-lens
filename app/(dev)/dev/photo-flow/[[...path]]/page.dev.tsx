import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { Suspense } from "react"

import { PhotoFlowApp } from "../_proto/app"

export const metadata: Metadata = {
  title: "Staff photo workflow (prototype)",
  robots: { index: false, follow: false },
}

/**
 * Dev-only prototype of the staff photo workflow: Add, upload, label and
 * find the photos again in Album. The `.dev.tsx` extension keeps this route
 * out of a production build (next.config.ts `pageExtensions`), and it is a
 * 404 there in any case. Nothing here reads or writes the database: the
 * whole world lives in the browser (`_proto/store.ts`).
 */
export default function PhotoFlowPage() {
  if (process.env.NODE_ENV === "production") notFound()
  return (
    <Suspense>
      <PhotoFlowApp />
    </Suspense>
  )
}
