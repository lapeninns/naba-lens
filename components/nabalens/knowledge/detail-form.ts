// The capture form's B03 detail section, per question schema (B03 UI design
// §3): what is sent, what is checked before sending, and a stored detail read
// back into the draft. Facility and accessibility so far.

import type { Place, QuestionFeature } from "@/lib/knowledge-client/contract"

import {
  accessDetail,
  accessErrors,
  accessFieldErrors,
  accessFromDetail,
  accessTouched,
  emptyAccess,
  type AccessDraft,
  type AccessField,
} from "./accessibility-detail"
import {
  emptyFacility,
  facilityDetail,
  facilityErrors,
  facilityFieldErrors,
  facilityFromDetail,
  facilityTouched,
  type FacilityDraft,
  type FacilityField,
} from "./facility-detail"

export type DetailForm =
  | { schema: "facility"; places: Place[] }
  | {
      schema: "accessibility"
      places: Place[]
      features: QuestionFeature[]
      /** step_free_entrance: entrances from Places, no separate scope. */
      stepFree: boolean
      /** Managers and admins keep Places; staff are told to ask. */
      canManagePlaces: boolean
    }

export type DetailParts = {
  facility?: FacilityDraft | null
  access?: AccessDraft | null
}

export type DetailErrors = {
  facility: Partial<Record<FacilityField, string>>
  access: Partial<Record<AccessField, string>>
}

export const NO_DETAIL_ERRORS: DetailErrors = { facility: {}, access: {} }

export const entrancesOf = (places: Place[]) =>
  places.filter((p) => p.kind === "entrance")

/** Accessibility asks its own section for every answer but Couldn't establish. */
export const showsAccess = (form: DetailForm | null, answer: string | null) =>
  form?.schema === "accessibility" && !!answer && answer !== "unknown"

/** The facility fields: Yes only, on both schemas. */
export const showsFacility = (form: DetailForm | null, answer: string | null) =>
  !!form && answer === "yes"

/** The detail to send for `answer`, or null when there is none. */
export function detailToSend(
  form: DetailForm,
  parts: DetailParts,
  answer: string | null
): Record<string, unknown> | null {
  const facility =
    answer === "yes" ? facilityDetail(parts.facility ?? emptyFacility()) : null
  if (form.schema === "facility") return facility
  if (!showsAccess(form, answer)) return null
  const out = {
    ...accessDetail(parts.access ?? emptyAccess(), {
      stepFree: form.stepFree,
      features: form.features,
      entrances: entrancesOf(form.places),
    }),
    ...(facility ?? {}),
  }
  return Object.keys(out).length ? out : null
}

/** What the form can tell before sending. */
export function detailErrorsFor(
  form: DetailForm,
  parts: DetailParts,
  answer: string | null,
  ctx: { venueName: string; today: string }
): DetailErrors {
  return {
    facility: showsFacility(form, answer)
      ? facilityErrors(parts.facility ?? emptyFacility())
      : {},
    access:
      form.schema === "accessibility" && showsAccess(form, answer)
        ? accessErrors(parts.access ?? emptyAccess(), {
            answer,
            stepFree: form.stepFree,
            entrances: entrancesOf(form.places),
            venueName: ctx.venueName,
            today: ctx.today,
          })
        : {},
  }
}

/**
 * What Save for later keeps on the account: both parts as typed, whatever
 * the answer, so switching answers back loses nothing.
 */
export function draftDetail(
  form: DetailForm,
  parts: DetailParts
): Record<string, unknown> | null {
  const out = {
    ...(form.schema === "accessibility" && parts.access
      ? accessDetail(parts.access, {
          stepFree: form.stepFree,
          features: form.features,
          entrances: entrancesOf(form.places),
        })
      : {}),
    ...(parts.facility ? facilityDetail(parts.facility) : {}),
  }
  return Object.keys(out).length ? out : null
}
export const hasDetailErrors = (e: DetailErrors) =>
  Object.values(e.facility).some(Boolean) ||
  Object.values(e.access).some(Boolean)

/** The server's field errors (keyed by path) onto the sections. */
export function detailFieldErrors(
  fieldErrors: Partial<Record<string, string>> | undefined
): DetailErrors {
  return {
    facility: facilityFieldErrors(fieldErrors),
    access: accessFieldErrors(fieldErrors),
  }
}

/** A stored detail (account draft) back into both parts. */
export function partsFromDetail(detail: unknown): Required<DetailParts> {
  return {
    facility: facilityFromDetail(detail),
    access: accessFromDetail(detail),
  }
}

export const partsTouched = (parts: DetailParts) =>
  Boolean(
    (parts.facility && facilityTouched(parts.facility)) ||
    (parts.access && accessTouched(parts.access))
  )
