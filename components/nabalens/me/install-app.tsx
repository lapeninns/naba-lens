"use client"

import * as React from "react"
import { DeviceMobileIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"

/*
 * Add to home screen on Me › Help and account (FA-53; spec §15.3). Naba-Lens
 * can be installed where the browser offers it; browser use is unchanged, and
 * there is no service worker (app/manifest.ts).
 *
 *   - Chrome, Edge and other browsers that fire `beforeinstallprompt`: an
 *     **Add to home screen** button that opens the browser's own prompt. It
 *     shows only while the browser offers installation. Answering the prompt
 *     either way spends it, so the button goes; it comes back only if the
 *     browser offers again. Once installed it never comes back.
 *   - iPhone and iPad (no such event): three short steps for Safari's Share
 *     menu, on iOS only.
 *   - Anything else, or already opened from the home screen: nothing.
 *
 * The browser fires `beforeinstallprompt` once per page load, usually before
 * anyone opens Me, so the root layout mounts InstallPromptCapture and this
 * module keeps the event until Me asks for it.
 */

export const INSTALL_COPY = {
  title: "Add to home screen",
  hint: "Open Naba-Lens from your home screen like an app. It works the same in the browser.",
  button: "Add to home screen",
  iosLead: "On iPhone or iPad, in Safari:",
  iosSteps: [
    "Tap Share (the square with an arrow).",
    "Tap Add to Home Screen.",
    "Tap Add.",
  ],
} as const

/** Chrome's install prompt event (not in TypeScript's DOM types). */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>
}

export type InstallOffer = "prompt" | "ios" | "none"

let deferred: BeforeInstallPromptEvent | null = null
/** Installed in this page's life (accepted, or `appinstalled`). */
let installed = false
const subscribers = new Set<() => void>()

function notify() {
  subscribers.forEach((fn) => fn())
}

function onBeforeInstallPrompt(event: Event) {
  // Keep the browser's mini bar away; Me offers it instead.
  event.preventDefault()
  deferred = event as BeforeInstallPromptEvent
  notify()
}

function onInstalled() {
  deferred = null
  installed = true
  notify()
}

/**
 * Opens the browser's own install prompt. A prompt can be used once, so the
 * offer goes whatever the answer (or if the browser refuses to show it).
 */
async function promptInstall() {
  const event = deferred
  if (!event) return
  try {
    await event.prompt()
    const { outcome } = await event.userChoice
    if (outcome === "accepted") installed = true
  } catch {
    // Already used or refused by the browser: nothing more to offer.
  } finally {
    if (deferred === event) deferred = null
    notify()
  }
}

let listening = false
/** Registers the window listeners once. Exported for tests. */
export function listenForInstallPrompt() {
  if (listening || typeof window === "undefined") return
  listening = true
  window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt)
  window.addEventListener("appinstalled", onInstalled)
}

// As early as this module is evaluated (the root layout imports it).
listenForInstallPrompt()

/** Test seam: forget the kept event. */
export function resetInstallPromptForTests() {
  deferred = null
  installed = false
  notify()
}

function isStandalone(): boolean {
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return (
    nav.standalone === true ||
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches)
  )
}

/** iPhone, iPod or iPad (iPadOS reports a Mac with touch). */
export function isIos(nav: {
  userAgent: string
  platform?: string
  maxTouchPoints?: number
}): boolean {
  if (/iPhone|iPad|iPod/.test(nav.userAgent)) return true
  return nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1
}

function currentOffer(): InstallOffer {
  if (installed || isStandalone()) return "none"
  if (deferred) return "prompt"
  if (isIos(window.navigator)) return "ios"
  return "none"
}

function subscribe(fn: () => void) {
  subscribers.add(fn)
  return () => {
    subscribers.delete(fn)
  }
}

/** Renders nothing; mounting it keeps the event from the first page load. */
export function InstallPromptCapture() {
  return null
}

/** The install row on Me › Help and account, or nothing. */
export function InstallApp({
  headingLevel = 3,
}: {
  /** Under Help and account's own heading. */
  headingLevel?: 3 | 4 | 5
}) {
  const Heading = `h${headingLevel}` as "h3"
  const offer = React.useSyncExternalStore(
    subscribe,
    currentOffer,
    () => "none" as const
  )
  const [busy, setBusy] = React.useState(false)
  const id = React.useId()

  if (offer === "none") return null

  async function install() {
    setBusy(true)
    await promptInstall()
    setBusy(false)
  }

  return (
    <section
      aria-labelledby={`${id}-install`}
      className="grid gap-3 rounded-card bg-surface p-4 shadow-card"
      data-slot="me-install"
      data-offer={offer}
    >
      <Heading
        id={`${id}-install`}
        className="flex items-center gap-2 text-item-title text-ink"
      >
        <DeviceMobileIcon aria-hidden className="size-6" />
        {INSTALL_COPY.title}
      </Heading>
      <p className="text-body text-ink-muted">{INSTALL_COPY.hint}</p>
      {offer === "prompt" ? (
        <Button
          type="button"
          className="w-full sm:w-auto sm:justify-self-start"
          onClick={install}
          loading={busy}
        >
          <DeviceMobileIcon data-icon="inline-start" aria-hidden />
          {INSTALL_COPY.button}
        </Button>
      ) : (
        <div className="grid gap-1">
          <p className="text-body text-ink">{INSTALL_COPY.iosLead}</p>
          <ol className="grid list-decimal gap-1 pl-6 text-body text-ink">
            {INSTALL_COPY.iosSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      )}
    </section>
  )
}
