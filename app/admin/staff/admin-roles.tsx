"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { ReasonDialog } from "@/components/nabalens/coverage/reason-dialog"
import { Notice } from "@/components/nabalens/notice"
import { OptionSelect } from "@/components/nabalens/option-select"
import type { Option } from "@/components/nabalens/types"
import { Button } from "@/components/ui/button"

type Admin = { id: string; displayName: string }

/**
 * Admins (spec §3.1, §8 A6). An admin removes another admin's role; the
 * person becomes staff at the venue chosen. The database refuses removing
 * the last active admin and never lets an admin change their own role.
 * Making someone an admin is on their staff page.
 */
export function AdminRoles({
  admins,
  selfId,
  venues,
  onRevoke,
}: {
  admins: Admin[]
  selfId: string
  venues: Option[]
  onRevoke: (input: {
    profileId: string
    venueId: string
    reason: string
  }) => Promise<{ ok: true } | { ok: false; error: string }>
}) {
  const router = useRouter()
  const [target, setTarget] = React.useState<Admin | null>(null)
  const [venueId, setVenueId] = React.useState<string | null>(null)
  const [done, setDone] = React.useState<string | null>(null)
  const listRef = React.useRef<HTMLUListElement>(null)

  return (
    <section
      aria-labelledby="admin-roles"
      className="grid min-w-0 gap-3 rounded-card bg-surface p-4 shadow-card"
    >
      <h2 id="admin-roles" className="type-section-title text-ink">
        Admins
      </h2>
      <p className="text-body text-ink-muted">
        Admins manage every venue. There is always at least one active admin.
      </p>
      {done ? (
        <Notice tone="positive" role="status">
          {done}
        </Notice>
      ) : null}
      <ul ref={listRef} tabIndex={-1} className="grid divide-y divide-line">
        {admins.map((admin) => (
          <li
            key={admin.id}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <p className="text-body font-bold text-ink">
              {admin.displayName}
              {admin.id === selfId ? (
                <span className="font-normal text-ink-muted"> (you)</span>
              ) : null}
            </p>
            {admin.id !== selfId ? (
              <Button
                variant="danger-quiet"
                size="sm"
                onClick={() => {
                  setVenueId(null)
                  setTarget(admin)
                }}
              >
                Remove admin role
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <ReasonDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null)
        }}
        title={target ? `Remove ${target.displayName}'s admin role?` : ""}
        description="They become staff at the venue you choose. Their photos and history stay."
        label="Reason"
        confirmLabel="Remove admin role"
        pendingLabel="Saving…"
        destructive
        reportFocus={() => listRef.current}
        reportFocusOnSuccess
        onConfirm={async (reason) => {
          if (!target) return { ok: false, error: "Choose an admin." }
          if (!venueId)
            return { ok: false, error: "Choose the venue they will work at." }
          const result = await onRevoke({
            profileId: target.id,
            venueId,
            reason,
          })
          if (!result.ok) return { ok: false, error: result.error }
          setDone(`${target.displayName} is no longer an admin.`)
          router.refresh()
          return { ok: true }
        }}
      >
        <div className="grid gap-1.5">
          <label htmlFor="admin-roles-venue" className="text-label text-ink">
            Venue they will work at
          </label>
          <OptionSelect
            id="admin-roles-venue"
            options={venues}
            value={venueId}
            onValueChange={setVenueId}
            placeholder="Choose a venue"
          />
        </div>
      </ReasonDialog>
    </section>
  )
}
