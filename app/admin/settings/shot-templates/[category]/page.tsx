import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr"

import { unexpected } from "@/app/staff/manage/_shared/context"
import { AppShell } from "@/components/nabalens/app-shell"
import { Notice } from "@/components/nabalens/notice"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { categoryLabel, isCoverageCategory } from "@/lib/album/brief"
import { requireActiveAdmin } from "@/lib/auth"
import { getCoverageActor } from "@/lib/server/coverage"
import {
  listExampleChoices,
  loadShotTemplates,
} from "@/lib/server/shot-templates"

import { ShotTemplateForm } from "./shot-template-form"

export const metadata: Metadata = { title: "Shot template" }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `?before=<iso>~<asset id>`: the example list's next page. */
function cursorOf(value: string | string[] | undefined) {
  if (typeof value !== "string" || value.length > 80) return null
  const [at, id] = value.split("~")
  if (!at || !id || !UUID.test(id) || Number.isNaN(Date.parse(at))) return null
  return { at, id }
}

/**
 * Settings › Shot templates › one category (FA-52; spec §8 A7, §5.2 step 2).
 * Admins only: the layout's gate, requireActiveAdmin here, and the database
 * (shot_template_set and the example list refuse anyone else, and an admin
 * without a second factor).
 */
export default async function ShotTemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ category: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { category } = await params
  if (!isCoverageCategory(category)) notFound()
  const profile = await requireActiveAdmin()
  const auth = await getCoverageActor()
  if (!auth.ok) unexpected(auth)
  const before = cursorOf((await searchParams).before)
  const [templates, choices] = await Promise.all([
    loadShotTemplates(auth.actor),
    listExampleChoices(auth.actor, { before }),
  ])
  if (!templates.ok) throw new Error(templates.message)
  const template = templates.templates.find((t) => t.category === category)
  if (!template) notFound()
  const label = categoryLabel(category)
  const next = choices.ok ? choices.nextCursor : null

  return (
    <AppShell variant="admin" active="settings" userName={profile.displayName}>
      <div className="grid gap-6">
        <Link
          href="/admin/settings#shot-templates"
          className="inline-flex min-h-12 items-center gap-1 justify-self-start font-bold text-ink focus-ring"
        >
          <ArrowLeftIcon aria-hidden className="size-5" />
          Settings
        </Link>
        <PageHeader
          scope="All venues"
          title={`${label} shot template`}
          summary={
            <p>
              What staff read beside a {label.toLowerCase()} slot when no
              request or manager&apos;s brief says otherwise. A manager&apos;s
              brief is never changed.
            </p>
          }
          className="pb-0 md:pb-0"
        />
        <OfflineNotice />
        {choices.ok ? null : (
          <Notice tone="negative" role="alert">
            {choices.message}
          </Notice>
        )}
        <ShotTemplateForm
          template={template}
          storedExampleAssetId={template.storedExampleAssetId ?? null}
          choices={choices.ok ? choices.items : []}
          olderHref={
            next
              ? `/admin/settings/shot-templates/${category}?before=${encodeURIComponent(`${next.at}~${next.id}`)}`
              : null
          }
        />
      </div>
    </AppShell>
  )
}
