"use client"

import { usePathname } from "next/navigation"

import { ERROR_COPY } from "@/components/nabalens/error-state"

import { AdminErrorPage } from "../_components/admin-boundary"

/**
 * Menus, one venue's menus or a version that could not load (redesign R5):
 * inside the admin frame, so the nav stays, with Retry. No menu changes.
 */
export default function MenusError({ retry }: { retry: () => void }) {
  const pathname = usePathname() ?? ""
  const back = { href: "/admin/menus", label: "Menus" }
  const frame = pathname.startsWith("/admin/menus/versions/")
    ? { title: "Menu version", back }
    : pathname.startsWith("/admin/menus/")
      ? { title: "Venue menus", back }
      : { title: "Menus" }
  return (
    <AdminErrorPage
      section="menus"
      {...frame}
      what={ERROR_COPY.couldNotLoad(
        frame.title === "Menus" ? "menus" : "this menu"
      )}
      retry={retry}
    >
      {ERROR_COPY.checkConnection} No menu has changed.
    </AdminErrorPage>
  )
}
