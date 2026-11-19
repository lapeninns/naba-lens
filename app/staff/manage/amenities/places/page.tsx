import { permanentRedirect } from "next/navigation"

/**
 * Retired (decision D3; DESIGN.md §15): venue managers work in /manager.
 * The old URL keeps working as a redirect.
 */
export default function RetiredManagePage() {
  permanentRedirect("/manager/amenities/places")
}
