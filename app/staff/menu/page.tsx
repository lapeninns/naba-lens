import { permanentRedirect } from "next/navigation"

/**
 * Retired: Our menu is Album's Menu (DESIGN.md §5d, D16). The old URL keeps
 * working as a redirect.
 */
export default function RetiredMenuPage() {
  permanentRedirect("/staff/album/menu")
}
