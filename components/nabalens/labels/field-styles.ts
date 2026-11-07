// Shared field classes for the label editor (label above, control, hint).
// Common Room fields (DESIGN.md §4): a 56px grey field with a strong inset
// edge and 18px text at every width (no iOS zoom on focus); invalid is a 2px
// warn edge.

export const FIELD_LABEL =
  "text-label text-ink [&_[data-opt]]:font-normal [&_[data-opt]]:text-ink-muted"

export const FIELD_HINT = "text-meta text-ink-muted"

export const FIELD_CONTROL =
  "h-auto min-h-14 rounded-control border-0 bg-surface-2 px-4 py-3 text-[1.125rem] leading-snug text-ink shadow-[inset_0_0_0_1px_var(--border-strong)] placeholder:text-ink-muted focus-visible:ring-0 focus-visible:outline-3 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-focus aria-invalid:shadow-[inset_0_0_0_2px_var(--warn-fg)] disabled:bg-surface-2 disabled:text-ink-muted disabled:opacity-100 disabled:shadow-[inset_0_0_0_1px_var(--line)] dark:bg-surface-2"
