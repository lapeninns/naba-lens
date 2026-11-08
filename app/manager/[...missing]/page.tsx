import { notFound } from "next/navigation"

/**
 * Any /manager URL that no page or route matches. A segment's not-found.tsx only
 * catches notFound() thrown inside the segment; unmatched URLs otherwise fall
 * through to the root not-found, without this area's navigation. Static and
 * dynamic routes rank above a catch-all, so this never shadows a real one, and
 * the manager layout's workspace gate runs first, as for every page here.
 */
export default function ManagerMissingPage(): never {
  notFound()
}
