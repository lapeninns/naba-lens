"use client"

import * as React from "react"

import { CoverageNotice } from "@/components/nabalens/coverage"
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
import type { KnowledgeResult } from "@/lib/knowledge-client/contract"

import { LABEL, MUTED } from "../amenities/capture/field-parts"

const INPUT =
  "block min-h-12 w-full min-w-0 rounded-control border border-line-control bg-panel px-3 py-2 text-body-touch text-ink outline-none focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-not-allowed disabled:bg-well md:text-body"

export const UPGRADE_COPY = {
  title: "Schema upgrades",
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
          size="touch"
          disabled={pending}
          aria-busy={pending || undefined}
          onClick={() => void run("dry_run")}
        >
          {pending && !open ? UPGRADE_COPY.running : UPGRADE_COPY.dryRun}
        </Button>
      </div>
      {dry && dry.key === key ? (
        <div className="grid gap-2">
          <p className="text-body-touch text-ink md:text-body">
            {UPGRADE_COPY.counts(dry.counts)}
          </p>
          <div>
            <Button
              type="button"
              size="touch"
              disabled={
                pending || dry.counts.lossless + dry.counts.needsChecking === 0
              }
              onClick={() => setOpen(true)}
            >
              {UPGRADE_COPY.apply}
            </Button>
          </div>
        </div>
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
              size="touch"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              {UPGRADE_COPY.cancel}
            </Button>
            <Button
              type="button"
              size="touch"
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
