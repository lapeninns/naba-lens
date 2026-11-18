import type { Metadata } from "next"
import Link from "next/link"

import { unexpected } from "@/app/staff/manage/_shared/context"
import { AppShell } from "@/components/nabalens/app-shell"
import { CoverageSection } from "@/components/nabalens/coverage"
import { Notice } from "@/components/nabalens/notice"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { buttonVariants } from "@/components/ui/button"
import { MEDIA_LIMITS } from "@/lib/config/media"
import { requireActiveAdmin } from "@/lib/auth"
import { getCoverageActor } from "@/lib/server/coverage"
import { loadOpsSettings, loadOpsStatus } from "@/lib/server/ops"
import { loadShotTemplates } from "@/lib/server/shot-templates"
import { integrationStatus } from "@/lib/server/ops/integrations"

import {
  CategoriesPanel,
  ExceptionsPanel,
  IntegrationsPanel,
  LimitsPanel,
  OperationsPanel,
} from "./ops-panel"
import { SettingsFormView } from "./settings-form"
import { ShotTemplatesPanel } from "./shot-templates-panel"

export const metadata: Metadata = { title: "Settings" }

/**
 * Settings and activity (spec §8 A7, §16, §17). What needs attention first,
 * then operations, the organisation settings form, media limits, categories,
 * shot templates (FA-52) and integrations. Admins only: the layout's gate, requireActiveAdmin here,
 * and the database (ops_status and ops_settings_set refuse anyone else). A
 * failed monitoring read shows a notice in its place, not a failed page.
 */
export default async function AdminSettingsPage() {
  const profile = await requireActiveAdmin()
  const auth = await getCoverageActor()
  if (!auth.ok) unexpected(auth)
  const [settings, status, templates] = await Promise.all([
    loadOpsSettings(auth.actor),
    loadOpsStatus(auth.actor),
    loadShotTemplates(auth.actor),
  ])
  if (!settings.ok) throw new Error(settings.message)

  return (
    <AppShell variant="admin" active="settings" userName={profile.displayName}>
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-4">
          <PageHeader
            scope="All venues"
            title="Settings"
            summary={
              <p>
                Exceptions, operations and the rules every venue shares. Every
                change is kept in Activity.
              </p>
            }
            actions={
              <Link
                href="/admin/activity"
                className={buttonVariants({ variant: "secondary" })}
              >
                Activity
              </Link>
            }
            className="pb-0 md:pb-0"
          />
          <OfflineNotice />
        </div>

        {status.ok ? (
          <>
            <ExceptionsPanel status={status.status} />
            <OperationsPanel status={status.status} />
          </>
        ) : (
          <Notice
            tone="negative"
            role="alert"
            title="Monitoring couldn't be loaded"
          >
            {status.nextAction}
          </Notice>
        )}

        <CoverageSection id="settings" title="Rules for every venue">
          <SettingsFormView settings={settings.settings} />
        </CoverageSection>

        <LimitsPanel
          limits={{
            photoBytes: MEDIA_LIMITS.maxPhotoBytes,
            videoBytes: MEDIA_LIMITS.maxVideoBytes,
            batchFiles: MEDIA_LIMITS.maxBatchFiles,
          }}
        />
        <CategoriesPanel />
        <ShotTemplatesPanel
          templates={templates.ok ? templates.templates : null}
        />
        <IntegrationsPanel integrations={integrationStatus()} />
      </div>
    </AppShell>
  )
}
