import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { ThemeSetting } from "@/components/nabalens/theme-setting"

import { AlbumBlock } from "./blocks/album"
import { ButtonBlock } from "./blocks/button"
import { ManagerVenueBlock } from "./blocks/manager-venue"
import { ChoiceBlock } from "./blocks/choice"
import { ComboboxBlock } from "./blocks/combobox"
import { DisplayBlock } from "./blocks/display"
import { FieldsBlock } from "./blocks/fields"
import { FoundationsBlock } from "./blocks/foundations"
import { OtherBlock } from "./blocks/other"
import { OverlaysBlock } from "./blocks/overlays"
import { PatternsBlock } from "./blocks/patterns"
import { PillsBlock } from "./blocks/pills"
import { StatesBlock } from "./blocks/states"
import { GALLERY_SECTIONS, type GallerySectionId } from "./fixtures"
import { GalleryNav } from "./gallery-nav"

export const metadata: Metadata = {
  title: "Design system gallery (dev only)",
  robots: { index: false, follow: false },
}

const BLOCKS: Record<GallerySectionId, React.ComponentType> = {
  album: AlbumBlock,
  manager: ManagerVenueBlock,
  foundations: FoundationsBlock,
  button: ButtonBlock,
  fields: FieldsBlock,
  choice: ChoiceBlock,
  pills: PillsBlock,
  overlays: OverlaysBlock,
  display: DisplayBlock,
  combobox: ComboboxBlock,
  other: OtherBlock,
  patterns: PatternsBlock,
  states: StatesBlock,
}

/**
 * Dev-only gallery of the design system (docs/design-system/strategy.md
 * DS-207): the tokens, every primitive in every variant, size and state, the
 * shared patterns and the whole-screen states, with fake data. 404 in
 * production.
 */
export default function GalleryPage() {
  if (process.env.NODE_ENV === "production") notFound()
  return (
    <div className="mx-auto grid w-full max-w-page min-w-0 gap-6 px-page-gutter py-6 md:px-6">
      <header className="grid min-w-0 gap-3">
        <h1 className="type-page-title text-ink">Design system gallery</h1>
        <p className="max-w-reading text-body text-ink-muted">
          Development only. Every name, venue and photo here is made up. Hover
          cannot be shown on a page: move the pointer over a control to see it.
          Focus is shown by pressing Tab.
        </p>
        <p className="text-body">
          <Link
            href="/ui-preview"
            className="inline-flex min-h-11 items-center rounded-control font-bold underline underline-offset-4 focus-ring outline-none"
          >
            Back to the UI preview
          </Link>
        </p>
        <div id="gallery-theme" className="max-w-feed scroll-mt-4">
          <ThemeSetting layout="card" />
        </div>
      </header>

      <div className="grid min-w-0 gap-6 md:grid-cols-[13rem_minmax(0,1fr)] md:items-start">
        <GalleryNav />
        <main className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-12">
          {GALLERY_SECTIONS.map((section) => {
            const Block = BLOCKS[section.id]
            const headingId = `${section.id}-title`
            return (
              <section
                key={section.id}
                id={section.id}
                aria-labelledby={headingId}
                tabIndex={-1}
                data-slot="gallery-section"
                className="grid min-w-0 scroll-mt-24 grid-cols-[minmax(0,1fr)] gap-5 outline-none md:scroll-mt-4"
              >
                <div className="grid gap-1 border-b border-line pb-3">
                  <h2 id={headingId} className="type-section-title text-ink">
                    {section.title}
                  </h2>
                  <p className="text-body text-ink-muted">
                    {section.description}
                  </p>
                </div>
                <Block />
              </section>
            )
          })}
        </main>
      </div>
    </div>
  )
}
