"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { CheckIcon } from "@phosphor-icons/react"

import {
  ReasonDialog,
  ReasonField,
} from "@/components/nabalens/coverage/reason-dialog"
import { Notice } from "@/components/nabalens/notice"
import { OptionSelect } from "@/components/nabalens/option-select"
import type { Option } from "@/components/nabalens/types"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { VenuePrivileges } from "@/lib/server/accounts"

type Result = { ok: true } | { ok: false; error: string }

const ROLE_WORD: Record<string, string> = {
  staff: "Staff",
  manager: "Manager",
  admin: "Admin",
}

/**
 * One privilege cell (handoff "One person"): a real tick for yes, the word
 * No in ink-muted for no. The tick is named "Yes", so the table still reads
 * Yes and No to a screen reader.
 */
function Allowed({ value }: { value: boolean }) {
  return value ? (
    <span className="inline-flex items-center text-accent-text">
      <CheckIcon weight="bold" aria-hidden className="size-5" />
      <span className="sr-only">Yes</span>
    </span>
  ) : (
    <span className="text-ink-muted">No</span>
  )
}

/**
 * Venues and privileges (spec §8 A6; FA-22). One row per venue the person
 * belongs to, with what they can do there, read from the same database rule
 * every request uses, so a manager role never becomes organisation-wide by
 * accident. An admin adds a venue, changes the role at one, removes one, or
 * makes the person an admin.
 */
export function VenueAccessPanel({
  member,
  privileges,
  venues,
  onSetRole,
  onRemove,
  onMakeAdmin,
}: {
  member: { id: string; displayName: string; active: boolean }
  /** Null when the read failed: the panel says so and keeps the forms off. */
  privileges: VenuePrivileges[] | null
  /** Active venues. */
  venues: Option[]
  onSetRole: (input: {
    profileId: string
    venueId: string
    role: "staff" | "manager"
    reason: string | null
  }) => Promise<Result>
  onRemove: (input: {
    profileId: string
    venueId: string
    reason: string
  }) => Promise<
    | { ok: true; outcome: "removed" | "deactivated"; warning?: string }
    | { ok: false; error: string }
  >
  onMakeAdmin: (input: { profileId: string; reason: string }) => Promise<Result>
}) {
  const router = useRouter()
  const id = React.useId()
  const [venueId, setVenueId] = React.useState<string | null>(null)
  const [role, setRole] = React.useState<string | null>("staff")
  const [reason, setReason] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [done, setDone] = React.useState<string | null>(null)
  const [removing, setRemoving] = React.useState<VenuePrivileges | null>(null)
  const [promoting, setPromoting] = React.useState(false)
  const tableRef = React.useRef<HTMLDivElement>(null)

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!venueId) return setFormError("Choose a venue.")
    if (role !== "staff" && role !== "manager")
      return setFormError("Choose staff or manager.")
    if (role === "manager" && !reason.trim())
      return setFormError("Give a short reason for manager rights.")
    setSaving(true)
    setFormError(null)
    try {
      const result = await onSetRole({
        profileId: member.id,
        venueId,
        role,
        reason: reason.trim() || null,
      })
      if (!result.ok) return setFormError(result.error)
      const venueName =
        venues.find((v) => v.id === venueId)?.name ?? "the venue"
      setDone(
        `${member.displayName} is now ${ROLE_WORD[role]} at ${venueName}.`
      )
      setReason("")
      setVenueId(null)
      router.refresh()
    } catch {
      setFormError(
        "We couldn't confirm this was saved. Refresh to check, then try again."
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <section
      aria-labelledby={`${id}-title`}
      // Handoff "One person": the heading over a framed table of real ticks
      // and the word No, then the form to add a venue or change the role.
      className="grid min-w-0 gap-3"
    >
      <h2 id={`${id}-title`} className="px-1 type-section-title text-ink">
        Venues and what they can do
      </h2>
      <p className="px-1 text-body text-ink-muted">
        Roles are per venue. Manager rights apply only at the venue named, and
        only while they are working there.
      </p>
      {done ? (
        <Notice tone="positive" role="status">
          {done}
        </Notice>
      ) : null}

      {privileges === null ? (
        <Notice tone="attention">
          We couldn&apos;t load their venues. Refresh to try again.
        </Notice>
      ) : privileges.length === 0 ? (
        <p className="text-body text-ink">
          {member.active
            ? `${member.displayName} has no venue. Add one below.`
            : `${member.displayName}'s access has ended.`}
        </p>
      ) : (
        <div ref={tableRef} tabIndex={-1} className="min-w-0">
          <Table framed>
            <TableHeader>
              <TableRow>
                <TableHead>Venue</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Working here now</TableHead>
                <TableHead>Add photos</TableHead>
                <TableHead>Review</TableHead>
                <TableHead>Invite staff</TableHead>
                <TableHead>Export</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {privileges.map((row) => (
                <TableRow key={row.venueId ?? "all"}>
                  <TableCell className="font-semibold">
                    {row.venueName}
                  </TableCell>
                  <TableCell>
                    {row.effectiveRole
                      ? ROLE_WORD[row.effectiveRole]
                      : `${ROLE_WORD[row.membershipRole] ?? ""} (no access now)`}
                  </TableCell>
                  <TableCell>
                    <Allowed value={row.isActiveVenue} />
                  </TableCell>
                  <TableCell>
                    <Allowed value={row.canUpload} />
                  </TableCell>
                  <TableCell>
                    <Allowed value={row.canReview} />
                  </TableCell>
                  <TableCell>
                    <Allowed value={row.canInviteStaff} />
                  </TableCell>
                  <TableCell>
                    <Allowed value={row.canExport} />
                  </TableCell>
                  <TableCell>
                    {row.venueId ? (
                      <Button
                        variant="danger-quiet"
                        size="sm"
                        onClick={() => setRemoving(row)}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {member.active && privileges !== null ? (
        <form
          onSubmit={save}
          className="grid gap-3 rounded-card bg-surface p-4 shadow-card lg:grid-cols-3 lg:items-start"
          noValidate
        >
          <h3 className="text-heading-sm font-semibold text-ink lg:col-span-3">
            Add a venue or change the role
          </h3>
          <div className="grid gap-1.5">
            <label htmlFor={`${id}-venue`} className="text-label text-ink">
              Venue
            </label>
            <OptionSelect
              id={`${id}-venue`}
              options={venues}
              value={venueId}
              onValueChange={setVenueId}
              placeholder="Choose a venue"
              disabled={saving}
            />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor={`${id}-role`} className="text-label text-ink">
              Role at this venue
            </label>
            <OptionSelect
              id={`${id}-role`}
              options={[
                { id: "staff", name: "Staff" },
                { id: "manager", name: "Manager" },
              ]}
              value={role}
              onValueChange={setRole}
              disabled={saving}
            />
          </div>
          <ReasonField
            id={`${id}-reason`}
            label="Reason"
            value={reason}
            onChange={setReason}
            required={role === "manager"}
            disabled={saving}
          />
          {formError ? (
            <Notice tone="negative" className="lg:col-span-3">
              {formError}
            </Notice>
          ) : null}
          <div className="flex flex-wrap gap-2 lg:col-span-3">
            <Button type="submit" variant="secondary" loading={saving}>
              Save venue role
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPromoting(true)}
            >
              Make admin
            </Button>
          </div>
        </form>
      ) : null}

      <ReasonDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
        title={
          removing
            ? `Remove ${member.displayName} from ${removing.venueName}?`
            : ""
        }
        description="Their photos and history stay. If this is their only venue, their access ends and they are signed out."
        label="Reason"
        confirmLabel="Remove"
        pendingLabel="Removing…"
        destructive
        reportFocus={() => tableRef.current}
        reportFocusOnSuccess
        onConfirm={async (text) => {
          if (!removing?.venueId) return { ok: false, error: "Choose a venue." }
          const result = await onRemove({
            profileId: member.id,
            venueId: removing.venueId,
            reason: text,
          })
          if (!result.ok) return { ok: false, error: result.error }
          setDone(
            [
              result.outcome === "deactivated"
                ? `${member.displayName} no longer has access to Naba-Lens.`
                : `${member.displayName} no longer works at ${removing.venueName}.`,
              result.warning ?? null,
            ]
              .filter(Boolean)
              .join(" ")
          )
          router.refresh()
          return { ok: true }
        }}
      />

      <ReasonDialog
        open={promoting}
        onOpenChange={setPromoting}
        title={`Make ${member.displayName} an admin?`}
        description="Admins manage every venue, people and settings. Their venue roles end; their photos and history stay."
        label="Reason"
        confirmLabel="Make admin"
        pendingLabel="Saving…"
        onConfirm={async (text) => {
          const result = await onMakeAdmin({
            profileId: member.id,
            reason: text,
          })
          if (!result.ok) return { ok: false, error: result.error }
          // Admins have no staff page: go back to the directory.
          router.push("/admin/staff")
          return { ok: true }
        }}
      />
    </section>
  )
}
