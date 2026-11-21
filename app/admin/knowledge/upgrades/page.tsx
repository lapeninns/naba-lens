import type { Metadata } from "next"

import { upgradeRunAction } from "@/app/_knowledge/actions"
import { unexpected } from "@/app/staff/manage/_shared/context"
import { AppShell } from "@/components/nabalens/app-shell"
import {
  UPGRADE_COPY,
  UpgradeControl,
} from "@/components/nabalens/knowledge/upgrade-control"
import { Notice } from "@/components/nabalens/notice"
import { VenueFactsHeader } from "@/app/admin/_components/admin-tabs"
import { requireActiveAdmin } from "@/lib/auth"
import { knowledgeServices } from "@/lib/knowledge-client/services"
import { getCoverageActor } from "@/lib/server/coverage"

export const metadata: Metadata = {
  title: "Question changes · Venue facts",
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
    <AppShell variant="admin" active="settings" userName={profile.displayName}>
      <div className="mx-auto grid w-full max-w-reading min-w-0 gap-gutter">
        <VenueFactsHeader active="question-changes" />
        {registry && !registry.ok ? (
          <Notice tone="negative">{UPGRADE_COPY.failed}</Notice>
        ) : null}
        <UpgradeControl questions={questions} onRun={upgradeRunAction} />
      </div>
    </AppShell>
  )
}
