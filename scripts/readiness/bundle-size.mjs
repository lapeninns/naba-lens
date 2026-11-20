import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const root = ".next/static/chunks"
const chunks = readdirSync(root, { recursive: true, encoding: "utf8" })
  .filter((file) => /\.(?:js|css)$/.test(file))
  .map((file) => ({ file, bytes: statSync(join(root, file)).size }))
  .sort((a, b) => b.bytes - a.bytes)
if (!chunks.length)
  throw Error("Build the application before measuring client bundles")
const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`
console.log(
  `Client JS/CSS: ${chunks.length} chunks, ${kib(chunks.reduce((sum, item) => sum + item.bytes, 0))} total`
)
for (const { file, bytes } of chunks.slice(0, 10))
  console.log(`${kib(bytes)}\t${file}`)
