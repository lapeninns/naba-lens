// Shared field classes for the label editor (label above, control, hint).
// Phones get the 52px control with 17px text, which also stops iOS zooming
// into a focused field; from md the 36px desktop control.

export const FIELD_LABEL =
  "text-label-touch text-ink md:text-label [&_[data-opt]]:font-normal [&_[data-opt]]:text-ink-muted"

export const FIELD_HINT = "text-meta-touch text-ink-muted md:text-meta"

export const FIELD_CONTROL =
  "h-auto min-h-13 rounded-touch border-line-control bg-panel px-3 py-2 text-body-touch text-ink placeholder:text-ink-subtle focus-visible:border-focus focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:bg-well disabled:text-ink-muted disabled:opacity-100 md:min-h-9 md:rounded-control md:py-1.5 md:text-body-sm dark:bg-panel"
