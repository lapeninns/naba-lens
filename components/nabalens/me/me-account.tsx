"use client"

import * as React from "react"
import Link from "next/link"
import {
  BellSimpleIcon,
  CaretRightIcon,
  LifebuoyIcon,
  StorefrontIcon,
  UserCircleIcon,
} from "@phosphor-icons/react"

import { Notice } from "@/components/nabalens/notice"
import { CountBadge } from "@/components/nabalens/status-chip"
import {
  VenueSwitcher,
  type VenueSwitcherVenue,
} from "@/components/nabalens/venue-switcher"
import type { SwitchVenueResult } from "@/lib/auth/venues"
import type { VenueManager } from "@/lib/staff/my-uploads"

/*
 * Help and account on Me (spec §6 S5; FA-1; S2-STAFF): the venues the person
 * works at, with a way to work at another (FA-22: switching never grants
 * access), their notices (FA-10: an inbox and a badge, never toasts), who
 * manages their venue (the contact-manager route) and help when adding
 * photos is refused. Work area, photo tips, theme and Log out stay where
 * they already are on Me.
 */

export const ACCOUNT_COPY = {
  title: "Help and account",
  venues: "Your venues",
  workingAt: (venue: string, role: string) => `Working at ${venue} · ${role}`,
  noVenue: "You are not at a venue yet. Ask your manager or an admin.",
  notices: "Notices",
  noticesHint: "Retakes, jobs given to you and photos that didn't send",
  managers: "Your managers",
  managersHint:
    "Ask them about a photo, a slot or your account. To tell them something has changed, use Report a change on the slot.",
  noManagers: "Your venue has no manager listed yet. Ask an admin to add one.",
  managersFailed: "Your managers couldn't be loaded. Reload the page.",
  you: "you",
  cantAdd: "If you can't add photos",
  cantAddHint: "Photo access on your phone, file types and sizes",
} as const

const ROLE_WORD = { staff: "Staff", manager: "Manager", admin: "Admin" }

const ROW =
  "grid min-h-16 w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 p-3 text-ink transition-colors duration-quick outline-none hover:bg-surface-2 focus-ring-inset"

function RowIcon({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      className="grid size-11 shrink-0 place-items-center rounded-round bg-surface-2 text-ink [&_svg]:size-6"
    >
      {children}
    </span>
  )
}

export function MeAccount({
  venues,
  switchVenue,
  managers,
  unread,
  helpHref,
  headingLevel = 2,
}: {
  /** The person's venues (my_venue_memberships); null when unread. */
  venues: VenueSwitcherVenue[] | null
  switchVenue: (
    venueId: string
  ) => Promise<SwitchVenueResult & { home?: string }>
  /** The venue's managers; null when they couldn't be read. */
  managers: VenueManager[] | null
  /** Unread notices; null when the count couldn't be read. */
  unread: number | null
  helpHref: string
  headingLevel?: 2 | 3
}) {
  const Heading = `h${headingLevel}` as "h2"
  const Sub = `h${headingLevel + 1}` as "h3"
  const id = React.useId()
  const active = venues?.find((v) => v.isActive) ?? null
  return (
    <section
      aria-labelledby={`${id}-account`}
      className="grid gap-3 pt-2"
      data-slot="me-account"
    >
      <Heading
        id={`${id}-account`}
        className="px-1 type-section-title text-ink"
      >
        {ACCOUNT_COPY.title}
      </Heading>

      <div className="grid gap-3 rounded-card bg-surface p-4 shadow-card">
        <Sub
          id={`${id}-venues`}
          className="flex items-center gap-2 text-item-title text-ink"
        >
          <StorefrontIcon aria-hidden className="size-6" />
          {ACCOUNT_COPY.venues}
        </Sub>
        {venues === null ? null : venues.length === 0 ? (
          <p className="text-body text-ink-muted">{ACCOUNT_COPY.noVenue}</p>
        ) : (
          <ul aria-labelledby={`${id}-venues`} className="grid gap-1">
            {venues.map((v) => (
              <li
                key={v.venueId}
                className="text-body [overflow-wrap:anywhere] text-ink"
              >
                {v.isActive ? (
                  <strong>
                    {ACCOUNT_COPY.workingAt(v.venueName, ROLE_WORD[v.role])}
                  </strong>
                ) : (
                  `${v.venueName} · ${ROLE_WORD[v.role]}`
                )}
              </li>
            ))}
          </ul>
        )}
        {venues && venues.length > 1 && active ? (
          <VenueSwitcher venues={venues} onSwitch={switchVenue} />
        ) : null}
      </div>

      <nav aria-label={ACCOUNT_COPY.title}>
        <ul className="grid divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card">
          <li>
            <Link href="/staff/notifications" className={ROW}>
              <RowIcon>
                <BellSimpleIcon />
              </RowIcon>
              <span className="grid min-w-0 gap-0.5">
                <span className="text-item-title">{ACCOUNT_COPY.notices}</span>
                <span className="text-body text-ink-muted">
                  {ACCOUNT_COPY.noticesHint}
                </span>
              </span>
              <span className="flex items-center gap-2 text-ink-muted">
                {unread ? (
                  <CountBadge count={unread} label="unread" tone="warn" />
                ) : null}
                <CaretRightIcon aria-hidden weight="bold" className="size-5" />
              </span>
            </Link>
          </li>
          <li>
            <Link href={helpHref} className={ROW}>
              <RowIcon>
                <LifebuoyIcon />
              </RowIcon>
              <span className="grid min-w-0 gap-0.5">
                <span className="text-item-title">{ACCOUNT_COPY.cantAdd}</span>
                <span className="text-body text-ink-muted">
                  {ACCOUNT_COPY.cantAddHint}
                </span>
              </span>
              <CaretRightIcon
                aria-hidden
                weight="bold"
                className="size-5 text-ink-muted"
              />
            </Link>
          </li>
        </ul>
      </nav>

      <div
        className="grid gap-2 rounded-card bg-surface p-4 shadow-card"
        data-slot="me-managers"
      >
        <Sub
          id={`${id}-managers`}
          className="flex items-center gap-2 text-item-title text-ink"
        >
          <UserCircleIcon aria-hidden className="size-6" />
          {ACCOUNT_COPY.managers}
          {active ? (
            <span className="font-normal text-ink-muted">
              {" "}
              · {active.venueName}
            </span>
          ) : null}
        </Sub>
        {managers === null ? (
          <Notice tone="attention">{ACCOUNT_COPY.managersFailed}</Notice>
        ) : managers.length === 0 ? (
          <p className="text-body text-ink-muted">{ACCOUNT_COPY.noManagers}</p>
        ) : (
          <ul aria-labelledby={`${id}-managers`} className="grid gap-1">
            {managers.map((m) => (
              <li
                key={m.id}
                className="text-body [overflow-wrap:anywhere] text-ink"
              >
                <strong>{m.displayName}</strong>
                {m.isYou ? ` (${ACCOUNT_COPY.you})` : null}
                {m.jobTitle ? (
                  <span className="text-ink-muted"> · {m.jobTitle}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="text-meta text-ink-muted">{ACCOUNT_COPY.managersHint}</p>
      </div>
    </section>
  )
}
