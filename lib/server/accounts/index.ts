// Account management for admins (spec v0.2 §3 staff directory, backlog M5).
// Every function takes an AccountsContext and re-checks the caller itself, so a
// Server Function or Route Handler cannot forget the admin check. These modules
// stay free of `server-only` so integration tests can call them directly with
// separate identities; the request-bound context lives in ./request.ts.

export {
  requireAdminCaller,
  resolveCaller,
  type AccountError,
  type AccountErrorCode,
  type AccountResult,
  type AccountsContext,
  type InviteMailer,
} from "./context"
export {
  inviteStaff,
  resendInvitation,
  supabaseInviteMailer,
  INVITE_EMAIL_FAILED,
  type InviteOutcome,
} from "./invite"
export { setStaffActive, updateStaffAccount } from "./manage"
export {
  getStaffAccount,
  listAssignableVenues,
  listStaffDirectory,
  staffStatus,
  type StaffAccountStatus,
  type StaffDirectoryEntry,
} from "./directory"
export { replaceProfileAvatar, type AvatarDeriver } from "./avatar"
export type { AccountPatch, InviteInput } from "./validation"
