import { join } from "node:path"

import { format, resolveConfig } from "prettier"

import {
  renderMetricsDoc,
  renderRunbook,
  renderRunbookIndex,
  renderSwitchCatalogue,
} from "../../lib/ops/docs"
import { RUNBOOKS } from "../../lib/ops/runbooks"
import { TRAINING_DOCS } from "./training-docs"

/** The generated operations documents, formatted as the repository formats Markdown. */
export async function formattedOpsDocs(
  root: string
): Promise<[string, string][]> {
  const docs: [string, string][] = [
    ["docs/operations/metrics.md", renderMetricsDoc()],
    ["docs/operations/runbooks/README.md", renderRunbookIndex()],
    ...RUNBOOKS.map((rb): [string, string] => [
      `docs/operations/runbooks/${rb.id}.md`,
      renderRunbook(rb),
    ]),
    ["docs/operations/switches.md", renderSwitchCatalogue()],
    ...TRAINING_DOCS.map(([path, render]): [string, string] => [
      path,
      render(),
    ]),
  ]
  return Promise.all(
    docs.map(async ([path, text]): Promise<[string, string]> => {
      const filepath = join(root, path)
      const options = (await resolveConfig(filepath)) ?? {}
      return [path, await format(text, { ...options, filepath })]
    })
  )
}
