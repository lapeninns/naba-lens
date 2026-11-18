import type { MetricCategory } from "@/lib/metrics/model"
import { DEFAULT_PERIOD } from "@/lib/metrics/model"

/** Typed links to the metrics screens; the defaults stay out of the URL. */
export type MetricsQuery = {
  venue?: string | null
  days?: number
  category?: MetricCategory | null
}

function withQuery(path: string, q: MetricsQuery): string {
  const params = new URLSearchParams()
  if (q.venue) params.set("venue", q.venue)
  if (q.days && q.days !== DEFAULT_PERIOD) params.set("days", String(q.days))
  if (q.category) params.set("category", q.category)
  const search = params.toString()
  return search ? `${path}?${search}` : path
}

export const metricsHrefs = {
  manager: (q: Omit<MetricsQuery, "venue"> = {}) =>
    withQuery("/manager/metrics", q),
  admin: (q: MetricsQuery = {}) => withQuery("/admin/metrics", q),
}
