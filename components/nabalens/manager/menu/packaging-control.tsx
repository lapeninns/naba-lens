"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { Notice } from "@/components/nabalens/notice"
import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

/*
 * Packaged and Photo wanted on one menu item or local offering (FA-51; spec
 * §4.2). A packaged item without Photo wanted is optional: it stays listed
 * and takes photos, but leaves the coverage total and is never counted as
 * empty. Photo wanted is the collection plan's designation and counts it
 * again. Each switch asks once, without a reason, before it changes.
 *
 * Used on the manager's menu item page (variant "card") and on the admin
 * venue menus page, one row per item (variant "row").
 */

export const PACKAGING_COPY = {
  title: "Packaged",
  intro:
    "Bottled or canned. A packaged item stays listed and takes photos, but only counts in coverage when a photo is wanted.",
  packaged: "Packaged (bottled or canned)",
  photoWanted: "Photo wanted",
  photoWantedOff: "Mark it packaged first.",
  state: (p: { packaged: boolean; photoWanted: boolean }) =>
    !p.packaged
      ? "Counts in coverage."
      : p.photoWanted
        ? "Packaged. A photo is wanted, so it counts in coverage."
        : "Packaged. Optional: not counted in coverage.",
  confirm: {
    packagedOn: (name: string) => ({
      title: `Mark ${name} as packaged?`,
      body: "It stays listed and still takes photos, but leaves the coverage total until a photo is wanted.",
      action: "Mark as packaged",
    }),
    packagedOff: (name: string) => ({
      title: `Mark ${name} as not packaged?`,
      body: "It needs a photo again and counts in coverage.",
      action: "Mark as not packaged",
    }),
    wantedOn: (name: string) => ({
      title: `Ask for a photo of ${name}?`,
      body: "It counts in coverage again, like any other item.",
      action: "Ask for a photo",
    }),
    wantedOff: (name: string) => ({
      title: `Stop asking for a photo of ${name}?`,
      body: "It stays listed and still takes photos, but leaves the coverage total.",
      action: "Stop asking",
    }),
  },
  cancel: "Cancel",
  saved: "Saved.",
  network: "That didn't go through. Check your connection and try again.",
} as const

export type PackagingValue = { packaged: boolean; photoWanted: boolean }

export type SetPackaging = (input: {
  itemId: string
  venueId?: string
  packaged: boolean
  photoWanted: boolean
}) => Promise<{ ok: true } | { ok: false; error: string }>

export type PackagingControlProps = {
  itemId: string
  name: string
  /** Admins name the venue; a manager's comes from their scope. */
  venueId?: string
  value: PackagingValue
  setAction: SetPackaging
  variant?: "card" | "row"
  /** Shown under the name in a row: the section, or "Special". */
  detail?: string | null
}

type Pending = {
  next: PackagingValue
  copy: { title: string; body: string; action: string }
}

export function PackagingControl({
  itemId,
  name,
  venueId,
  value,
  setAction,
  variant = "card",
  detail,
}: PackagingControlProps) {
  const copy = PACKAGING_COPY
  const router = useRouter()
  const sessionEnded = useSessionEndedCatch()
  const id = React.useId()
  const [current, setCurrent] = React.useState(value)
  const [pending, setPending] = React.useState<Pending | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [notice, setNotice] = React.useState<{
    tone: "positive" | "negative"
    text: string
  } | null>(null)

  React.useEffect(() => setCurrent(value), [value])

  const ask = (next: PackagingValue) => {
    const c = copy.confirm
    const text =
      next.packaged !== current.packaged
        ? next.packaged
          ? c.packagedOn(name)
          : c.packagedOff(name)
        : next.photoWanted
          ? c.wantedOn(name)
          : c.wantedOff(name)
    setNotice(null)
    setPending({ next, copy: text })
  }

  const confirm = async () => {
    if (!pending || busy) return
    setBusy(true)
    try {
      const result = await setAction({
        itemId,
        ...(venueId ? { venueId } : {}),
        ...pending.next,
      })
      if (!result.ok) {
        setNotice({ tone: "negative", text: result.error })
      } else {
        setCurrent(pending.next)
        setNotice({ tone: "positive", text: copy.saved })
        router.refresh()
      }
    } catch (cause) {
      setNotice({ tone: "negative", text: sessionEnded(cause) ?? copy.network })
    } finally {
      setBusy(false)
      setPending(null)
    }
  }

  const switches = (
    <div className="grid gap-3">
      <label className="flex min-h-11 items-center justify-between gap-3">
        <span className="text-body text-ink">{copy.packaged}</span>
        <Switch
          checked={current.packaged}
          disabled={busy}
          onCheckedChange={(on) =>
            ask({ packaged: on, photoWanted: on ? current.photoWanted : false })
          }
          data-testid="packaged-switch"
        />
      </label>
      <label className="flex min-h-11 items-center justify-between gap-3">
        <span className="grid gap-0.5">
          <span className="text-body text-ink">{copy.photoWanted}</span>
          {!current.packaged ? (
            <span id={`${id}-wanted-off`} className="text-meta text-ink-muted">
              {copy.photoWantedOff}
            </span>
          ) : null}
        </span>
        <Switch
          checked={current.photoWanted}
          aria-disabled={!current.packaged || undefined}
          aria-describedby={!current.packaged ? `${id}-wanted-off` : undefined}
          disabled={busy}
          onCheckedChange={(on) => {
            if (current.packaged) ask({ packaged: true, photoWanted: on })
          }}
          data-testid="photo-wanted-switch"
        />
      </label>
    </div>
  )

  const dialog = (
    <AlertDialog
      open={!!pending}
      onOpenChange={(open) => {
        if (!open && !busy) setPending(null)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{pending?.copy.title}</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogDescription className="text-ink">
          {pending?.copy.body}
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{copy.cancel}</AlertDialogCancel>
          <Button onClick={confirm} disabled={busy}>
            {pending?.copy.action}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  if (variant === "row")
    return (
      <li
        data-slot="packaging-row"
        data-item={itemId}
        className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] sm:items-center sm:gap-4"
      >
        <span className="grid min-w-0 gap-0.5">
          <span className="font-bold break-words text-ink">{name}</span>
          <span className="text-meta text-ink-muted">
            {[detail, copy.state(current)].filter(Boolean).join(" · ")}
          </span>
          {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
        </span>
        {switches}
        {dialog}
      </li>
    )

  return (
    <section
      aria-labelledby={`${id}-title`}
      data-slot="packaging-control"
      className={cn(
        "grid gap-3 rounded-card bg-surface p-3 shadow-card sm:p-4"
      )}
    >
      <h3 id={`${id}-title`} className="type-section-title text-ink">
        {copy.title}
      </h3>
      <p className="text-body text-ink-muted">{copy.intro}</p>
      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
      <p className="text-body text-ink" data-testid="packaging-state">
        {copy.state(current)}
      </p>
      {switches}
      {dialog}
    </section>
  )
}
