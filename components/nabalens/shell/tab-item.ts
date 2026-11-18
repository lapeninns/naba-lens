// Lives outside the "use client" add-context module so server components
// (AppShell) can import it: a plain value exported from a client module
// reaches a server component as undefined.
/**
 * One TabBar item (v2 `nl-tab`): a 24px icon over an always-visible caption
 * label at 600, at least 64px tall.
 */
export const TAB_ITEM =
  "relative grid min-h-tabbar content-center justify-items-center gap-0.5 px-1 py-2 text-center type-tab-label [overflow-wrap:anywhere] transition-colors duration-quick outline-none focus-ring-inset"
