// Purpose-specific use grants (contracts/b05-design.md §2). The database
// owns every rule; these lists only give early, friendly input errors and
// type the RPCs until lib/db/types.ts is regenerated with B05-m1.

export const USE_PURPOSES = [
  "menu_item_image",
  "venue_feature_image",
  "amenity_illustration",
  "general_gallery",
] as const
export type UsePurpose = (typeof USE_PURPOSES)[number]

export const USE_SUBJECT_KINDS = ["menu_item", "question", "none"] as const
export type UseSubjectKind = (typeof USE_SUBJECT_KINDS)[number]

/** The subject kind each purpose takes; the database checks the same pairing. */
export const SUBJECT_KIND_FOR_PURPOSE: Record<UsePurpose, UseSubjectKind> = {
  menu_item_image: "menu_item",
  amenity_illustration: "question",
  venue_feature_image: "none",
  general_gallery: "none",
}

/** Reasons a person may give. `asset_deleted` is written by the system only. */
export const USE_WITHDRAW_REASONS = [
  "granter_withdrawn",
  "clearance_failed",
  "subject_changed",
  "owner_request",
  "superseded",
] as const
export type UseWithdrawReason = (typeof USE_WITHDRAW_REASONS)[number]

export type UseGrantState = "scheduled" | "in_force" | "expired" | "withdrawn"
export type AssetUseState =
  "legacy_unknown" | "not_granted" | "granted" | "withdrawn"

export const USE_LIMITS = { noteMax: 500 } as const

export const REQUEST_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/

export type UseGrantCreated = {
  grantId: string
  state: UseGrantState
  replayed: boolean
}

export type UseGrantWithdrawn = {
  grantId: string
  withdrawn: number
  replayed: boolean
  alreadyWithdrawn?: boolean
}

export type AssetUseWithdrawn = {
  assetId: string
  withdrawn: number
  replayed: boolean
}

/** The uploader's view: labels and states, never the granter or a note. */
export type UploaderUseStatus = {
  assetId: string
  view: "uploader"
  state: AssetUseState
  destinations: {
    label: string
    state: UseGrantState
    until: string | null
  }[]
}

/** The venue manager's and admin's view. */
export type ManagerUseStatus = {
  assetId: string
  view: "manager" | "admin"
  state: AssetUseState
  baseline: "legacy_unknown" | "none"
  grants: {
    grantId: string
    destinationKey: string
    label: string
    audience: "internal" | "public"
    purpose: UsePurpose
    subject: { kind: UseSubjectKind; id: string | null; key: string | null }
    effectiveFrom: string
    effectiveUntil: string | null
    state: UseGrantState
    granterFirstName: string
    withdrawnAt: string | null
    withdrawReason: string | null
    /** B05-m2 fills this; null before. */
    derivative: string | null
  }[]
}

export type AssetUseStatus = UploaderUseStatus | ManagerUseStatus

export type UseRpcs = {
  media_use_grant_create: {
    args: {
      p_request_key: string
      p_asset_id: string
      p_destination_key: string
      p_purpose: UsePurpose
      p_subject_kind: UseSubjectKind
      p_subject_id: string | null
      p_profile_key: string | null
      p_effective_from: string | null
      p_effective_until: string | null
      p_clearance_version: string
      p_clearance: Record<string, boolean>
      p_note: string | null
    }
    returns: UseGrantCreated
  }
  media_use_grant_withdraw: {
    args: {
      p_request_key: string
      p_grant_id: string
      p_reason_code: UseWithdrawReason
      p_note: string | null
    }
    returns: UseGrantWithdrawn
  }
  media_use_withdraw_asset: {
    args: {
      p_request_key: string
      p_asset_id: string
      p_reason_code: UseWithdrawReason
      p_note: string | null
    }
    returns: AssetUseWithdrawn
  }
  asset_use_status: {
    args: { p_asset_id: string }
    returns: AssetUseStatus
  }
}
export type UseRpcName = keyof UseRpcs

export type UseErrorCode =
  | "disabled"
  | "not_permitted"
  | "not_found"
  | "invalid_input"
  | "clearance_incomplete"
  | "destination_unavailable"
  | "subject_not_publishable"
  | "profile_unavailable"
  | "state_conflict"
  | "unavailable"

/** An expected refusal, in the lib/server/media Outcome shape plus a code. */
export type UseFailure = {
  ok: false
  status: 400 | 401 | 403 | 404 | 409 | 503
  code: UseErrorCode
  message: string
  fieldErrors?: Partial<Record<string, string>>
}

export type UseResult<T> = ({ ok: true } & T) | UseFailure
