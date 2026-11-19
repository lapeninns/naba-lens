import { ERROR_COPY } from "@/components/nabalens/error-state"

export const LIBRARY_COPY = {
  // S3-R13: headed as the nav names it (app-shell.tsx ADMIN_NAV).
  title: "Library",
  summary:
    "Every ready photo and video across Lapen Inns. Labels help people find them.",
  order: "newest first",
  allVenues: "All venues",
  loading: "Loading the library…",
  couldNotLoad: ERROR_COPY.couldNotLoad("the library"),
} as const
