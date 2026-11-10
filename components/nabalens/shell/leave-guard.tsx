"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

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
import { leaveDeliberately } from "@/lib/upload/before-unload"

type Entry = {
  active: number
  labels: number
  /** Files processing on the server: saved whether or not the person stays. */
  finishing: number
  stop: () => void
}
type Register = (id: string, entry: Entry | null) => void

const LeaveContext = React.createContext<Register | null>(null)

/**
 * Tells the staff layout's leave guard how many uploads this queue is running
 * or holding (that leaving would stop), how many files have labels the server
 * does not have yet, how many are processing (finishing either way), and how
 * to stop the uploads. Outside the guard it does nothing.
 */
export function useLeaveGuard(
  active: number,
  stop: () => void,
  labels = 0,
  finishing = 0
) {
  const register = React.useContext(LeaveContext)
  const id = React.useId()
  const stopRef = React.useRef(stop)
  React.useEffect(() => {
    stopRef.current = stop
  })
  React.useEffect(() => {
    if (!register) return
    register(
      id,
      active > 0 || labels > 0 || finishing > 0
        ? { active, labels, finishing, stop: () => stopRef.current() }
        : null
    )
    return () => register(id, null)
  }, [register, id, active, labels, finishing])
}

/**
 * Copy for S6/S20 leaving while uploads run, or while labels the server does
 * not have yet would be lost.
 */
export function leaveCopy(
  kind: "logout" | "leave",
  count: number,
  labels = 0,
  finishing = 0
) {
  const uploads =
    count === 0
      ? null
      : count === 1
        ? "Leave now and 1 upload stops. Finished photos stay uploaded."
        : `Leave now and ${count} uploads stop. Finished photos stay uploaded.`
  const finished =
    finishing === 0
      ? null
      : finishing === 1
        ? "1 photo is finishing and will still be saved."
        : `${finishing} photos are finishing and will still be saved.`
  const unsaved =
    labels === 0
      ? null
      : `Labels for ${labels} ${labels === 1 ? "photo" : "photos"} haven't saved yet.`
  return {
    title: kind === "logout" ? "Log out now?" : "Leave now?",
    body: [uploads, finished, unsaved].filter(Boolean).join(" "),
    leave: kind === "logout" ? "Log out anyway" : "Leave anyway",
    stay: count > 0 ? "Keep uploading" : "Stay",
  }
}

const isStaffPath = (path: string) =>
  path === "/staff" || path.startsWith("/staff/")

type Pending =
  | {
      kind: "logout"
      count: number
      labels: number
      finishing: number
      form: HTMLFormElement
      submitter: HTMLElement | null
    }
  | {
      kind: "leave"
      count: number
      labels: number
      finishing: number
      anchor: HTMLAnchorElement
      href: string
    }

/**
 * While uploads run or wait, or labels have not reached the server, asks
 * before Log out (any form marked `data-logout`) or a link out of /staff,
 * which would unmount the staff layout and its queue. Links between staff
 * pages keep the queue, so they pass. Tab close and reload are covered by the
 * queue's own beforeunload.
 */
export function LeaveGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const entries = React.useRef(new Map<string, Entry>())
  const bypass = React.useRef(false)
  const [pending, setPending] = React.useState<Pending | null>(null)
  const returnFocus = React.useRef<HTMLElement | null>(null)
  const stayRef = React.useRef<HTMLButtonElement>(null)

  const register = React.useCallback<Register>((id, entry) => {
    if (entry) entries.current.set(id, entry)
    else entries.current.delete(id)
  }, [])

  React.useEffect(() => {
    const running = () => {
      let count = 0
      let labels = 0
      let finishing = 0
      for (const entry of entries.current.values()) {
        count += entry.active
        labels += entry.labels
        finishing += entry.finishing
      }
      return { count, labels, finishing }
    }

    // Window capture runs before React's root listeners, so stopping here
    // keeps the logout action and Link navigation from starting.
    const onSubmit = (event: SubmitEvent) => {
      if (bypass.current || event.defaultPrevented) return
      const form = event.target
      if (!(form instanceof HTMLFormElement) || !form.matches("[data-logout]"))
        return
      // Only files that would stop ask first; processing ones finish anyway.
      const { count, labels, finishing } = running()
      if (count === 0 && labels === 0) return
      event.preventDefault()
      event.stopPropagation()
      returnFocus.current = event.submitter ?? null
      setPending({
        kind: "logout",
        count,
        labels,
        finishing,
        form,
        submitter: event.submitter,
      })
    }

    const onClick = (event: MouseEvent) => {
      if (bypass.current || event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return
      const target = event.target
      const anchor =
        target instanceof Element ? target.closest("a[href]") : null
      if (!(anchor instanceof HTMLAnchorElement)) return
      if ((anchor.target && anchor.target !== "_self") || anchor.download)
        return
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin || isStaffPath(url.pathname))
        return
      const { count, labels, finishing } = running()
      if (count === 0 && labels === 0) return
      event.preventDefault()
      event.stopPropagation()
      returnFocus.current = anchor
      setPending({
        kind: "leave",
        count,
        labels,
        finishing,
        anchor,
        href: url.pathname + url.search + url.hash,
      })
    }

    window.addEventListener("submit", onSubmit, true)
    window.addEventListener("click", onClick, true)
    return () => {
      window.removeEventListener("submit", onSubmit, true)
      window.removeEventListener("click", onClick, true)
    }
  }, [])

  function leave() {
    const p = pending
    if (!p) return
    returnFocus.current = null
    setPending(null)
    leaveDeliberately()
    for (const entry of entries.current.values()) entry.stop()
    bypass.current = true
    try {
      if (p.kind === "logout") {
        const form = p.form.isConnected
          ? p.form
          : document.querySelector<HTMLFormElement>("form[data-logout]")
        const submitter =
          p.submitter?.isConnected && form?.contains(p.submitter)
            ? p.submitter
            : undefined
        form?.requestSubmit(submitter)
      } else if (p.anchor.isConnected) {
        p.anchor.click()
      } else {
        router.push(p.href)
      }
    } finally {
      bypass.current = false
    }
  }

  const copy = pending
    ? leaveCopy(pending.kind, pending.count, pending.labels, pending.finishing)
    : null

  return (
    <LeaveContext.Provider value={register}>
      {children}
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
      >
        <AlertDialogContent
          data-slot="leave-guard"
          initialFocus={stayRef}
          finalFocus={() => {
            const el = returnFocus.current
            return el?.isConnected ? el : true
          }}
        >
          {copy ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{copy.title}</AlertDialogTitle>
                <AlertDialogDescription className="text-ink">
                  {copy.body}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <Button variant="outline" size="touch" onClick={leave}>
                  {copy.leave}
                </Button>
                <AlertDialogCancel ref={stayRef} variant="primary" size="touch">
                  {copy.stay}
                </AlertDialogCancel>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </LeaveContext.Provider>
  )
}
