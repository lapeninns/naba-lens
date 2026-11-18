import Link from "next/link"

import { CoverageSection } from "@/components/nabalens/coverage"
import { Notice } from "@/components/nabalens/notice"
import { buttonVariants } from "@/components/ui/button"
import { Photo } from "@/components/ui/photo"
import { categoryLabel, type ShotTemplate } from "@/lib/album/brief"

export const SHOT_TEMPLATES_COPY = {
  title: "Shot templates",
  intro:
    "One default instruction per category. Staff read it beside a slot when no request or manager's brief says otherwise.",
  noExample: "No example photo",
  hidden: "Example not shown: no longer accepted for public use",
  edit: "Edit",
  failed: "Shot templates couldn't be loaded",
} as const

/**
 * Settings › Shot templates (FA-52; spec §8 A7): the five categories, each
 * with its instruction and example, and Edit.
 */
export function ShotTemplatesPanel({
  templates,
}: {
  templates: ShotTemplate[] | null
}) {
  return (
    <CoverageSection id="shot-templates" title={SHOT_TEMPLATES_COPY.title}>
      <p className="px-1 text-body">{SHOT_TEMPLATES_COPY.intro}</p>
      {templates ? (
        <ul
          className="grid divide-y divide-line overflow-hidden rounded-card border border-line bg-surface"
          data-slot="shot-templates"
        >
          {templates.map((t) => {
            const label = categoryLabel(t.category)
            return (
              <li
                key={t.category}
                className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-start gap-3 px-4 py-3.5 sm:grid-cols-[3.5rem_minmax(0,1fr)_auto]"
                data-category={t.category}
              >
                {t.exampleAssetId ? (
                  <Photo
                    src={`/api/media/${encodeURIComponent(t.exampleAssetId)}/thumb`}
                    alt=""
                    ratio="1/1"
                    radius="square"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="aspect-square rounded-square bg-media-placeholder"
                  />
                )}
                <div className="grid gap-0.5">
                  <p className="font-bold">{label}</p>
                  <p className="text-body [overflow-wrap:anywhere]">
                    {t.instruction}
                  </p>
                  <p className="text-meta text-ink-muted">
                    {t.exampleUnavailable
                      ? SHOT_TEMPLATES_COPY.hidden
                      : t.exampleAssetId
                        ? null
                        : SHOT_TEMPLATES_COPY.noExample}
                  </p>
                </div>
                <Link
                  href={`/admin/settings/shot-templates/${t.category}`}
                  aria-label={`${SHOT_TEMPLATES_COPY.edit} the ${label} template`}
                  className={buttonVariants({
                    variant: "secondary",
                    className: "col-start-2 justify-self-start sm:col-start-3",
                  })}
                >
                  {SHOT_TEMPLATES_COPY.edit}
                </Link>
              </li>
            )
          })}
        </ul>
      ) : (
        <Notice tone="negative" role="alert" title={SHOT_TEMPLATES_COPY.failed}>
          Try again in a moment.
        </Notice>
      )}
    </CoverageSection>
  )
}
