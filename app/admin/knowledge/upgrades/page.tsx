import type { Metadata } from "next"

import { upgradeRunAction } from "@/app/_knowledge/actions"
import { unexpected } from "@/app/staff/manage/_shared/context"
import { AppShell } from "@/components/nabalens/app-shell"
import {
  UPGRADE_COPY,
  UpgradeControl,
} from "@/components/nabalens/knowledge/upgrade-control"
import { Notice } from "@/components/nabalens/notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { requireActiveAdmin } from "@/lib/auth"
import { knowledgeServices } from "@/lib/knowledge-client/services"
import { getCoverageActor } from "@/lib/server/coverage"

export const metadata: Metadata = {
  title: "Schema upgrades · Knowledge · Naba-Lens",
}

/** Admin (B03 UI design §8.3): a question's schema upgrade, dry run first. */
export default async function UpgradesPage() {
  const profile = await requireActiveAdmin()
  const auth = await getCoverageActor()
  if (!auth.ok) unexpected(auth)
  const registry = await knowledgeServices
    .listQuestionRegistry(auth.actor, {})
    .catch(() => null)
  const questions = registry?.ok
    ? registry.questions.map((q) => ({
        key: q.key,
        label: q.guidance.question,
      }))
    : []
  return (
    <AppShell variant="admin" active="coverage" userName={profile.displayName}>
      <div className="mx-auto grid w-full max-w-(--size-reading) min-w-0 gap-(--gutter)">
        <PageHeader title={UPGRADE_COPY.title} />
        {registry && !registry.ok ? (
          <Notice tone="negative">{UPGRADE_COPY.failed}</Notice>
        ) : null}
        <UpgradeControl questions={questions} onRun={upgradeRunAction} />
      </div>
    </AppShell>
  )
}
