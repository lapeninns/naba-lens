/**
 * The retired /staff/manage workspace (decision D3): every URL goes to its
 * /manager twin. These run in next.config before any layout, because the
 * staff layout sends a manager account to /manager before a page under
 * /staff/manage could redirect it to the right screen. First match wins.
 * The coverage checklist has no /manager screen, so it goes to the overview.
 */
export const RETIRED_MANAGE_REDIRECTS: ReadonlyArray<{
  source: string
  destination: string
  permanent: true
}> = [
  { source: "/staff/manage", destination: "/manager", permanent: true },
  {
    source: "/staff/manage/menu/items",
    destination: "/manager/menu",
    permanent: true,
  },
  {
    source: "/staff/manage/checklist/:rest*",
    destination: "/manager",
    permanent: true,
  },
  {
    source: "/staff/manage/:rest*",
    destination: "/manager/:rest*",
    permanent: true,
  },
]
