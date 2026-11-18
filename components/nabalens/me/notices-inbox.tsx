"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CaretRightIcon } from "@phosphor-icons/react"

import { Notice } from "@/components/nabalens/notice"
import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
import { StatusChip } from "@/components/nabalens/status-chip"
import { Button } from "@/components/ui/button"
import { OptionRow } from "@/components/ui/option-row"
import {
  notificationWords,
  type AppNotification,
  type Inbox,
  type NotificationPreferences,
} from "@/lib/ops/notifications"
import { shortDay } from "@/lib/staff/my-uploads"
import { NOTICES_COPY, noticeHref } from "@/lib/staff/notices"

type Reply<T extends object = Record<never, never>> =
  ({ ok: true } & T) | { ok: false; error: string }

/*
 * The staff notice inbox (spec §17; FA-10; S2-STAFF): a list, newest first,
 * each notice in plain words with where it leads, New on the unread ones,
 * and Mark all as read. Below it, what to be told about. No toasts and no
 * pop-ups: the only other trace of a notice is the number on Me.
 */
export function NoticesInbox({
  initial,
  preferences,
  actions,
}: {
  /** The first page; null when it couldn't be read. */
  initial: Inbox | null
  preferences: NotificationPreferences | null
  actions: {
    loadMore: (before: number) => Promise<Reply<{ inbox: Inbox }>>
    markRead: (ids: number[] | null) => Promise<Reply<{ changed: number }>>
    savePreferences: (
      patch: Partial<
        Pick<
          NotificationPreferences,
          "retakes" | "assignments" | "uploadProblems"
        >
      >
    ) => Promise<Reply<{ preferences: NotificationPreferences }>>
  }
}) {
  const router = useRouter()
  const sessionEnded = useSessionEndedCatch()
  const [items, setItems] = React.useState<AppNotification[]>(
    initial?.items ?? []
  )
  const [next, setNext] = React.useState(initial?.nextBefore ?? null)
  const [unread, setUnread] = React.useState(initial?.unread ?? 0)
  const [message, setMessage] = React.useState<{
    tone: "positive" | "negative"
    text: string
  } | null>(null)
  const [pending, setPending] = React.useState(false)
  const [prefs, setPrefs] = React.useState(preferences)
  const [prefMessage, setPrefMessage] = React.useState<string | null>(null)

  async function markAll() {
    setPending(true)
    setMessage(null)
    try {
      const result = await actions.markRead(null)
      if (!result.ok) {
        setMessage({ tone: "negative", text: result.error })
        return
      }
      setItems((list) =>
        list.map((n) => (n.state === "unread" ? { ...n, state: "read" } : n))
      )
      setUnread(0)
      setMessage({ tone: "positive", text: NOTICES_COPY.marked })
      router.refresh()
    } catch (cause) {
      setMessage({
        tone: "negative",
        text: sessionEnded(cause) ?? NOTICES_COPY.failed,
      })
    } finally {
      setPending(false)
    }
  }

  async function more() {
    if (next === null) return
    setPending(true)
    try {
      const result = await actions.loadMore(next)
      if (result.ok) {
        setItems((list) => [...list, ...result.inbox.items])
        setNext(result.inbox.nextBefore)
      }
    } finally {
      setPending(false)
    }
  }

  async function toggle(
    key: "retakes" | "assignments" | "uploadProblems",
    value: boolean
  ) {
    if (!prefs) return
    const before = prefs
    setPrefs({ ...prefs, [key]: value })
    setPrefMessage(null)
    try {
      const result = await actions.savePreferences({ [key]: value })
      if (!result.ok) {
        setPrefs(before)
        setPrefMessage(result.error)
        return
      }
      setPrefs(result.preferences)
      setPrefMessage(NOTICES_COPY.saved)
    } catch (cause) {
      setPrefs(before)
      setPrefMessage(sessionEnded(cause) ?? NOTICES_COPY.failed)
    }
  }

  return (
    <div className="grid gap-gutter" data-slot="notices-inbox">
      {initial === null ? (
        <Notice tone="negative" role="alert">
          {NOTICES_COPY.failed}
        </Notice>
      ) : items.length === 0 ? (
        <p className="px-1 text-body text-ink-muted">{NOTICES_COPY.empty}</p>
      ) : (
        <>
          {unread > 0 ? (
            <Button
              variant="secondary"
              className="justify-self-start"
              loading={pending}
              onClick={markAll}
            >
              {NOTICES_COPY.markAll}
            </Button>
          ) : null}
          {message ? (
            <Notice
              tone={message.tone}
              role={message.tone === "negative" ? "alert" : "status"}
            >
              {message.text}
            </Notice>
          ) : null}
          <ul className="grid divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card">
            {items.map((n) => {
              const words = notificationWords(n)
              return (
                <li key={n.id} data-state={n.state}>
                  <Link
                    href={noticeHref(n)}
                    className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3 text-ink focus-ring-inset outline-none hover:bg-surface-2"
                  >
                    <span className="grid min-w-0 gap-0.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-item-title [overflow-wrap:anywhere]">
                          {words.title}
                        </span>
                        {n.state === "unread" ? (
                          <StatusChip tone="pending">
                            {NOTICES_COPY.unread}
                          </StatusChip>
                        ) : null}
                      </span>
                      {words.detail ? (
                        <span className="text-body [overflow-wrap:anywhere] text-ink-muted">
                          {words.detail}
                        </span>
                      ) : null}
                      <span className="text-meta text-ink-muted">
                        {[n.venueName, shortDay(n.createdAt)]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <CaretRightIcon
                      aria-hidden
                      weight="bold"
                      className="size-5 text-ink-muted"
                    />
                  </Link>
                </li>
              )
            })}
          </ul>
          {next !== null ? (
            <Button
              variant="secondary"
              className="justify-self-start"
              loading={pending}
              onClick={more}
            >
              {NOTICES_COPY.older}
            </Button>
          ) : null}
        </>
      )}

      <section
        aria-labelledby="notice-prefs"
        className="grid gap-3 rounded-card bg-surface p-4 shadow-card"
      >
        <h2 id="notice-prefs" className="type-section-title text-ink">
          {NOTICES_COPY.prefsTitle}
        </h2>
        <p className="text-body text-ink-muted">{NOTICES_COPY.prefsSummary}</p>
        {prefs ? (
          <div className="grid gap-2">
            {(["retakes", "assignments", "uploadProblems"] as const).map(
              (key) => (
                <OptionRow
                  key={key}
                  type="checkbox"
                  label={NOTICES_COPY[key]}
                  checked={prefs[key]}
                  onCheckedChange={(v) => void toggle(key, v === true)}
                />
              )
            )}
          </div>
        ) : (
          <Notice tone="attention">{NOTICES_COPY.prefsFailed}</Notice>
        )}
        {prefMessage ? (
          <p className="text-meta text-ink-muted" role="status">
            {prefMessage}
          </p>
        ) : null}
      </section>
    </div>
  )
}
