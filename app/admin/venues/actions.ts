"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import type {
  ArchiveImpact,
  ScopeImpact,
  TemplatePreview,
  VenueField,
  VenueForm,
} from "@/lib/admin/venues"
import {
  applyTemplate,
  getArchiveImpact,
  previewScopeChange,
  previewTemplate,
  saveVenue,
  setVenueReviewer,
  setVenueStatus,
} from "@/lib/server/admin/venues"
import type { ApiError } from "@/lib/server/http/errors"
import { getCoverageActor } from "@/lib/server/coverage"
import { setVenueScope } from "@/lib/server/menus/local"

// Server Functions are reachable by direct POST: each one re-authorises the
// caller (fresh profile read in getCoverageActor) and the database refuses
// anyone but an active admin on a second-factor session. Errors are
// returned, not thrown, because Next hides thrown messages.

export type FormState =
  | { status: "idle" }
  | { status: "saved"; changed: boolean; message?: string }
  | {
      status: "error"
      message: string
      fieldErrors?: Partial<Record<VenueField, string>>
      stale?: boolean
    }

const text = (form: FormData, key: string) => {
  const v = form.get(key)
  return typeof v === "string" ? v : ""
}
const int = (form: FormData, key: string) => Number(text(form, key))

function errorState(error: ApiError & { fieldErrors?: object }): FormState {
  const fieldErrors =
    (error.fieldErrors as Partial<Record<VenueField, string>> | undefined) ??
    (error.field
      ? ({ [error.field]: error.message } as Partial<
          Record<VenueField, string>
        >)
      : undefined)
  return {
    status: "error",
    message: error.field ? "Check the highlighted field." : error.message,
    fieldErrors,
    stale: error.code === "stale_version",
  }
}

const STALE =
  "Someone else changed this venue since you opened it. Reload to see their change, then make yours again."

async function caller() {
  const auth = await getCoverageActor()
  return auth.ok ? { ok: true as const, actor: auth.actor } : auth
}

function refreshVenue(venueId: string) {
  revalidatePath(`/admin/venues/${venueId}`)
  revalidatePath("/admin/venues")
  revalidatePath("/admin/overview")
}

function venueForm(form: FormData): VenueForm {
  return {
    name: text(form, "name"),
    locality: text(form, "locality"),
    address: text(form, "address"),
    timezone: text(form, "timezone"),
    reason: text(form, "reason"),
  }
}

/** Create: on success goes to the new venue's page. */
export async function createVenueAction(
  _prev: FormState,
  form: FormData
): Promise<FormState> {
  const auth = await caller()
  if (!auth.ok) return { status: "error", message: auth.message }
  const result = await saveVenue(auth.actor, null, venueForm(form), 0)
  if (!result.ok) return errorState(result)
  revalidatePath("/admin/venues")
  redirect(`/admin/venues/${result.venueId}?created=1`)
}

export async function saveVenueAction(
  _prev: FormState,
  form: FormData
): Promise<FormState> {
  const auth = await caller()
  if (!auth.ok) return { status: "error", message: auth.message }
  const venueId = text(form, "venueId")
  const result = await saveVenue(
    auth.actor,
    venueId,
    venueForm(form),
    int(form, "revision")
  )
  if (!result.ok) {
    const state = errorState(result)
    return state.status === "error" && state.stale
      ? { ...state, message: STALE }
      : state
  }
  if (result.changed) refreshVenue(venueId)
  return { status: "saved", changed: result.changed }
}

export async function setStatusAction(
  _prev: FormState,
  form: FormData
): Promise<FormState> {
  const auth = await caller()
  if (!auth.ok) return { status: "error", message: auth.message }
  const venueId = text(form, "venueId")
  const result = await setVenueStatus(auth.actor, {
    venueId,
    status: text(form, "status"),
    reason: text(form, "reason"),
    revision: int(form, "revision"),
  })
  if (!result.ok) {
    const state = errorState(result)
    return state.status === "error" && state.stale
      ? { ...state, message: STALE }
      : state
  }
  if (result.changed) refreshVenue(venueId)
  return { status: "saved", changed: result.changed }
}

export async function setReviewerAction(
  _prev: FormState,
  form: FormData
): Promise<FormState> {
  const auth = await caller()
  if (!auth.ok) return { status: "error", message: auth.message }
  const venueId = text(form, "venueId")
  const result = await setVenueReviewer(auth.actor, {
    venueId,
    responsibility: text(form, "responsibility"),
    profileId: text(form, "profileId"),
    reason: text(form, "reason"),
    revision: int(form, "revision"),
  })
  if (!result.ok) {
    const state = errorState(result)
    return state.status === "error" && state.stale
      ? {
          ...state,
          message:
            "Someone else changed this reviewer since you opened the page. Reload and try again.",
        }
      : state
  }
  if (result.changed) refreshVenue(venueId)
  return { status: "saved", changed: result.changed }
}

export async function setScopeAction(
  _prev: FormState,
  form: FormData
): Promise<FormState> {
  const auth = await caller()
  if (!auth.ok) return { status: "error", message: auth.message }
  const venueId = text(form, "venueId")
  const result = await setVenueScope(auth.actor, {
    venueId,
    key: "accommodation",
    applicable: text(form, "applicable") === "true",
    reason: text(form, "reason"),
    revision: int(form, "revision"),
  })
  if (!result.ok)
    return {
      status: "error",
      message: result.message,
      ...(result.status === 400
        ? { fieldErrors: { reason: result.message } }
        : {}),
      stale: result.status === 409,
    }
  if (result.changed) refreshVenue(venueId)
  return { status: "saved", changed: result.changed }
}

export async function applyTemplateAction(
  _prev: FormState,
  form: FormData
): Promise<FormState> {
  const auth = await caller()
  if (!auth.ok) return { status: "error", message: auth.message }
  const venueId = text(form, "venueId")
  const result = await applyTemplate(auth.actor, {
    venueId,
    sourceVenueId: text(form, "sourceVenueId"),
    reason: text(form, "reason"),
  })
  if (!result.ok) return errorState(result)
  const added = result.questions + result.places
  if (added > 0) refreshVenue(venueId)
  return {
    status: "saved",
    changed: added > 0,
    message:
      added > 0
        ? `Added ${result.questions} facility ${result.questions === 1 ? "question" : "questions"} and ${result.places} ${result.places === 1 ? "space" : "spaces"}, all still to check.`
        : "Nothing to add: the venue already has all of it.",
  }
}

// ---- previews (reads; called from the forms before a confirm) ------------------

export type Preview<T> = { ok: true; value: T } | { ok: false; message: string }

const previewError = (e: { message: string; nextAction?: string }) => ({
  ok: false as const,
  message: e.nextAction ? `${e.message} ${e.nextAction}` : e.message,
})

export async function archiveImpactAction(
  venueId: string
): Promise<Preview<ArchiveImpact>> {
  const auth = await caller()
  if (!auth.ok) return { ok: false, message: auth.message }
  const r = await getArchiveImpact(auth.actor, venueId)
  return r.ok ? { ok: true, value: r.impact } : previewError(r)
}

export async function scopeImpactAction(
  venueId: string,
  applicable: boolean
): Promise<Preview<ScopeImpact>> {
  const auth = await caller()
  if (!auth.ok) return { ok: false, message: auth.message }
  const r = await previewScopeChange(auth.actor, venueId, applicable === true)
  return r.ok ? { ok: true, value: r.impact } : previewError(r)
}

export async function templatePreviewAction(
  venueId: string,
  sourceVenueId: string | null
): Promise<Preview<TemplatePreview>> {
  const auth = await caller()
  if (!auth.ok) return { ok: false, message: auth.message }
  const r = await previewTemplate(auth.actor, venueId, sourceVenueId || null)
  return r.ok ? { ok: true, value: r.preview } : previewError(r)
}
