import { join } from "node:path"

import { format, resolveConfig } from "prettier"

import { renderMetricsDoc, renderRunbookIndex } from "../../lib/ops/docs"

/** The generated operations documents, formatted as the repository formats Markdown. */
export async function formattedOpsDocs(
  root: string
): Promise<[string, string][]> {
  const docs: [string, string][] = [
    ["docs/operations/metrics.md", renderMetricsDoc()],
    ["docs/operations/runbooks/README.md", renderRunbookIndex()],
  ]
  return Promise.all(
    docs.map(async ([path, text]): Promise<[string, string]> => {
      const filepath = join(root, path)
      const options = (await resolveConfig(filepath)) ?? {}
      return [path, await format(text, { ...options, filepath })]
    })
  )
}
