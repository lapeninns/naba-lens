// Lives outside the "use client" add-context module so server components
// (AppShell) can import it: a plain value exported from a client module
// reaches a server component as undefined.
/** One TabBar item: icon over an always-visible label, full bar height. */
export const TAB_ITEM =
  "relative grid min-h-tabbar content-center justify-items-center gap-0.5 px-0.5 pt-2.5 pb-1 text-center type-tab-label [overflow-wrap:anywhere] transition-colors duration-quick outline-none focus-ring-inset"
