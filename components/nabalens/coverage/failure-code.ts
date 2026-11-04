/*
 * Run failures store a SQLSTATE only. Serialisation and uniqueness failures
 * mean another write touched a target mid-run; anything else stopped the run.
 */
export const CONFLICT_CODES: ReadonlySet<string> = new Set([
  "23505",
  "40001",
  "40P01",
  "55P03",
])

export function isConflictCode(errorCode: string | null): boolean {
  return errorCode !== null && CONFLICT_CODES.has(errorCode)
}

/** The code shown after the words: the deck's name for a conflict, else the SQLSTATE. */
export function failureCode(errorCode: string): string {
  return isConflictCode(errorCode) ? "PREP_TARGET_CONFLICT" : errorCode
}
