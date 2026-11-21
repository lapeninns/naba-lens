"use client"

import * as React from "react"

import {
  CoverageNotice,
  Tally,
  TallyItem,
} from "@/components/nabalens/coverage"
import type { Notice as CoverageNoticeValue } from "@/components/nabalens/coverage"
import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { fieldControlVariants } from "@/components/ui/field-control"
import type { KnowledgeResult } from "@/lib/knowledge-client/contract"

import { LABEL, MUTED } from "../amenities/capture/field-parts"

// The shared field recipe on native controls (common-room.md §4 Field).
const INPUT = `block ${fieldControlVariants()}`

export const UPGRADE_COPY = {
  // Schema upgrades are called Question changes (redesign R5, decision 7).
  title: "Question changes",
  intro:
    "A question's newer form keeps an old answer when nothing is lost; otherwise the answer needs checking again. Run a dry run first.",
  question: "Question",
  dryRun: "Start dry run",
  running: "Running…",
  counts: (c: UpgradeCounts) =>
    [
      `${c.answers} ${c.answers === 1 ? "answer" : "answers"}`,
      `${c.lossless} kept, with details not recorded`,
      `${c.needsChecking} need checking again`,
      `${c.alreadyUpgraded} already upgraded`,
      `${c.currentSchema} already on the new form`,
    ].join(" · "),
  // The dry run's five figures (second handoff, Question changes).
  tally: {
    answers: "Answers",
    lossless: "Kept",
    losslessNote: "details not recorded",
    needsChecking: "Need checking again",
    needsCheckingNote: "a recheck opens",
    alreadyUpgraded: "Already upgraded",
    currentSchema: "On the new form",
  },
  dryRunResult: "Dry run",
  apply: "Apply upgrade",
  applyTitle: "Apply this upgrade?",
  applyBody:
    "Answers that lose nothing are kept under the new form, with details not recorded. The others need checking again, and a recheck opens for each.",
  applyConfirm: "Apply",
  cancel: "Cancel",
  applied: (derived: number, opened: number) =>
    `Upgraded. ${derived} kept, with details not recorded. ${opened} ${opened === 1 ? "recheck" : "rechecks"} opened.`,
  lost: "We couldn't confirm the upgrade ran. Run the dry run again before applying; nothing is upgraded twice.",
  failed: "This couldn't be read.",
  chooseQuestion: "Choose a question.",
  earlierForm: "Recorded under the earlier form of this question.",
} as const

export type UpgradeCounts = {
  answers: number
  lossless: number
  needsChecking: number
  alreadyUpgraded: number
  currentSchema: number
}

/** The run's counts, read defensively; null when they can't be read. */
export function upgradeCounts(
  result: Record<string, unknown>
): UpgradeCounts | null {
  const c = result.counts as Record<string, unknown> | undefined
  const n = (v: unknown) => (typeof v === "number" && v >= 0 ? v : null)
  if (!c) return null
  const out = {
    answers: n(c.answers),
    lossless: n(c.lossless),
    needsChecking: n(c.needsChecking),
    alreadyUpgraded: n(c.alreadyUpgraded),
    currentSchema: n(c.currentSchema),
  }
  return Object.values(out).every((v) => v !== null)
    ? (out as UpgradeCounts)
    : null
}

type Run = (input: {
  key: string
  mode: "dry_run" | "apply"
}) => Promise<KnowledgeResult<{ result: Record<string, unknown> }>>

/**
 * Schema upgrades (B03 UI design §8.3): a dry run, then apply. The server
 * needs a matching dry run from the last 24 hours and refuses one that's
 * out of date.
 */
export function UpgradeControl({
  questions,
  onRun,
}: {
  questions: { key: string; label: string }[]
  onRun: Run
}) {
  const id = React.useId()
  const sessionEnded = useSessionEndedCatch()
  const [key, setKey] = React.useState("")
  const [dry, setDry] = React.useState<{
    key: string
    counts: UpgradeCounts
  } | null>(null)
  const [pending, setPending] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const [notice, setNotice] = React.useState<CoverageNoticeValue | null>(null)

  async function run(mode: "dry_run" | "apply") {
    if (!key) {
      setNotice({ tone: "error", text: UPGRADE_COPY.chooseQuestion })
      return
    }
    setPending(true)
    setNotice(null)
    try {
      const result = await onRun({ key, mode })
      setOpen(false)
      if (!result.ok) {
        setNotice({ tone: "error", text: result.message })
        if (mode === "apply") setDry(null)
        return
      }
      if (mode === "dry_run") {
        const counts = upgradeCounts(result.result)
        if (!counts) setNotice({ tone: "error", text: UPGRADE_COPY.failed })
        setDry(counts ? { key, counts } : null)
        return
      }
      const r = result.result
      setDry(null)
      setNotice({
        tone: "success",
        text: UPGRADE_COPY.applied(
          typeof r.derived === "number" ? r.derived : 0,
          typeof r.rechecksOpened === "number" ? r.rechecksOpened : 0
        ),
      })
    } catch (cause) {
      setOpen(false)
      setNotice({
        tone: "error",
        text:
          sessionEnded(cause) ||
          (mode === "apply" ? UPGRADE_COPY.lost : UPGRADE_COPY.failed),
      })
      if (mode === "apply") setDry(null)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="grid min-w-0 gap-4 rounded-card bg-surface p-4 shadow-card">
      <p className={MUTED}>{UPGRADE_COPY.intro}</p>
      <CoverageNotice notice={notice} onDismiss={() => setNotice(null)} />
      {/* Second handoff: one form row from md, the question and its button. */}
      <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="grid min-w-0 gap-1.5">
          <label htmlFor={`${id}-key`} className={LABEL}>
            {UPGRADE_COPY.question}
          </label>
          <select
            id={`${id}-key`}
            value={key}
            disabled={pending}
            className={INPUT}
            onChange={(e) => {
              setKey(e.currentTarget.value)
              setDry(null)
            }}
          >
            <option value="">Choose…</option>
            {questions.map((q) => (
              <option key={q.key} value={q.key}>
                {q.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            aria-busy={pending || undefined}
            onClick={() => void run("dry_run")}
          >
            {pending && !open ? UPGRADE_COPY.running : UPGRADE_COPY.dryRun}
          </Button>
        </div>
      </div>
      {dry && dry.key === key ? (
        <section aria-label={UPGRADE_COPY.dryRunResult} className="grid gap-3">
          <Tally>
            <TallyItem
              label={UPGRADE_COPY.tally.answers}
              value={dry.counts.answers}
            />
            <TallyItem
              label={UPGRADE_COPY.tally.lossless}
              value={dry.counts.lossless}
              note={UPGRADE_COPY.tally.losslessNote}
            />
            <TallyItem
              label={UPGRADE_COPY.tally.needsChecking}
              value={dry.counts.needsChecking}
              note={UPGRADE_COPY.tally.needsCheckingNote}
              tone="attention"
            />
            <TallyItem
              label={UPGRADE_COPY.tally.alreadyUpgraded}
              value={dry.counts.alreadyUpgraded}
            />
            <TallyItem
              label={UPGRADE_COPY.tally.currentSchema}
              value={dry.counts.currentSchema}
            />
          </Tally>
          <div>
            <Button
              variant="primary"
              type="button"
              disabled={
                pending || dry.counts.lossless + dry.counts.needsChecking === 0
              }
              onClick={() => setOpen(true)}
            >
              {UPGRADE_COPY.apply}
            </Button>
          </div>
        </section>
      ) : null}
      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{UPGRADE_COPY.applyTitle}</DialogTitle>
            <DialogDescription>{UPGRADE_COPY.applyBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              {UPGRADE_COPY.cancel}
            </Button>
            <Button
              variant="primary"
              type="button"
              disabled={pending}
              aria-busy={pending || undefined}
              onClick={() => void run("apply")}
            >
              {pending ? UPGRADE_COPY.running : UPGRADE_COPY.applyConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
