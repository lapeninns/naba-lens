/**
 * Answer to a Server Action posted without a session (proxy.ts). Next shows
 * the text of a 4xx `text/plain` action response as the rejected action's
 * error message, so callers that show `error.message` say what happened, and
 * the session guard recognises it.
 */
export const SESSION_ENDED_MESSAGE =
  "You were signed out. Sign in again, then try again. Nothing was saved."

export function isSessionEndedError(error: unknown): boolean {
  return error instanceof Error && error.message === SESSION_ENDED_MESSAGE
}
