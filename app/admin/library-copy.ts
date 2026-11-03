import { ERROR_COPY } from "@/components/nabalens/error-state"

export const LIBRARY_COPY = {
  title: "Content",
  summary:
    "Every ready photo and video across Lapen Inns. Labels help people find them.",
  order: "newest first",
  allVenues: "All venues",
  loading: "Loading the library…",
  couldNotLoad: ERROR_COPY.couldNotLoad("the library"),
} as const
