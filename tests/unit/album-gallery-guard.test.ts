import { existsSync, readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

import ts from "typescript"
import { describe, expect, it } from "vitest"

import { visibleText, walk } from "./support/visible-text"

/**
 * Album guard (AL-6, docs/plans/album-a3-a5.md; DESIGN.md §2, §7, §9).
 *
 * Gallery first: staff screens never offer an in-app camera. Every way to
 * add a photo opens the phone's photos (the picker itself may still offer the
 * phone's own camera; that is the platform's choice, not ours). This test
 * fails on a camera action in a staff component: a "camera" photo source, a
 * `capture` attribute, a camera icon on an action, a PhotoSourceActions that
 * shows its camera button, or camera wording a person can see.
 *
 * Album words (§7): staff screens say Add photos, Retake, In the album and
 * Waiting, never upload, reshoot, pending, rejected, approved or published.
 *
 * Add itself (`app/staff/_shell`, `components/nabalens/shell`) is AL-1's and
 * has its own guard; the shared `photo-source.tsx` and `upload-dialog.tsx`
 * still hold the camera input for it until AL-1 removes it.
 */

const root = fileURLToPath(new URL("../../", import.meta.url))

/** Staff components and routes where adding a photo must open the gallery. */
const CAMERA_SCOPE = [
  "app/staff",
  "components/nabalens/album",
  "components/nabalens/amenities/capture",
  "components/nabalens/home",
  "components/nabalens/menu-photos",
  "components/nabalens/tasks",
]

/** Add (AL-1): its own guard covers it. */
const CAMERA_EXCLUDED = ["app/staff/_shell/"]

/**
 * Where a camera icon is never an action either. Me (`app/staff/*.tsx`) keeps
 * a decorative camera in its empty state and a video marker; those are not
 * controls and are not this task's files.
 */
const ICON_SCOPE = [
  "app/staff/tasks",
  "components/nabalens/album",
  "components/nabalens/amenities/capture",
  "components/nabalens/home",
  "components/nabalens/menu-photos",
  "components/nabalens/tasks",
]

/** Staff copy that follows the §7 word table. */
const WORD_SCOPE = [
  "app/staff/tasks",
  "components/nabalens/album",
  "components/nabalens/home",
  "components/nabalens/menu-photos",
  "components/nabalens/tasks",
]

/**
 * Camera wording a person could read on a control or in help text. Not
 * "capture": the amenity check form is named for it ("What to capture"),
 * and that form's words are not this task's.
 */
const CAMERA_WORDS =
  /\b(camera|take (a|another|a new) photos?|take another|reshoot)\b/i

/** §7 "Not" column for staff screens (task, due and overdue: staff copy guard). */
const NOT_ALBUM_WORDS =
  /\b(upload(s|ed|ing)?|uploader|pending|rejected|approved?|published|label this photo)\b/i

const CAMERA_ICON = /^Camera\w*Icon$/

function filesIn(paths: string[]): string[] {
  const files = paths
    .flatMap((p) => walk(join(root, p)))
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => relative(root, f).split(sep).join("/"))
    .filter((f) => !CAMERA_EXCLUDED.some((x) => f.startsWith(x)))
  return [...new Set(files)].sort()
}

function parse(fileName: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
}

/** Camera actions in code: sources, capture inputs, the camera button. */
function cameraActions(
  fileName: string,
  source: string,
  { icons = true }: { icons?: boolean } = {}
): string[] {
  const file = parse(fileName, source)
  const out: string[] = []
  const at = (node: ts.Node, what: string) => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file))
    out.push(`${line + 1} ${what}`)
  }
  const visit = (node: ts.Node) => {
    // openAdd({ source: "camera" }), open("camera"), photoInputProps("camera")
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      node.text === "camera" &&
      !(node.parent && ts.isLiteralTypeNode(node.parent))
    )
      at(node, `"camera" photo source`)
    // <input capture="environment"> and { capture: "environment" }
    if (ts.isJsxAttribute(node) && node.name.getText(file) === "capture")
      at(node, "capture attribute")
    // A string value only: the amenity form's `capture: view.capture` is data.
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(file) === "capture" &&
      ts.isStringLiteralLike(node.initializer)
    )
      at(node, "capture property")
    // A camera icon is a camera action in these screens.
    if (icons && ts.isImportSpecifier(node) && CAMERA_ICON.test(node.name.text))
      at(node, `${node.name.text} import`)
    // PhotoSourceActions draws "Take a photo" unless told not to.
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      node.tagName.getText(file) === "PhotoSourceActions" &&
      !node.attributes.properties.some(
        (p) =>
          ts.isJsxAttribute(p) &&
          p.name.getText(file) === "cameraHidden" &&
          (!p.initializer ||
            (ts.isJsxExpression(p.initializer) &&
              p.initializer.expression?.kind === ts.SyntaxKind.TrueKeyword))
      )
    )
      at(node, "PhotoSourceActions without cameraHidden")
    ts.forEachChild(node, visit)
  }
  visit(file)
  for (const { line, text } of visibleText(fileName, source))
    if (CAMERA_WORDS.test(text)) out.push(`${line} ${JSON.stringify(text)}`)
  return out
}

function wordHits(fileName: string, source: string): string[] {
  return visibleText(fileName, source)
    .filter(({ text }) => NOT_ALBUM_WORDS.test(text))
    .map(({ line, text }) => `${line} ${JSON.stringify(text)}`)
}

const read = (file: string) => readFileSync(join(root, file), "utf8")

describe("Album guard: gallery only (DESIGN.md §2, §9)", () => {
  it("scans every named staff folder", () => {
    for (const path of [...CAMERA_SCOPE, ...ICON_SCOPE, ...WORD_SCOPE])
      expect(existsSync(join(root, path)), path).toBe(true)
    expect(filesIn(CAMERA_SCOPE)).toEqual(
      expect.arrayContaining([
        "components/nabalens/menu-photos/item-row.tsx",
        "components/nabalens/tasks/retake-notes.tsx",
        "components/nabalens/home/still-needed-list.tsx",
        "components/nabalens/amenities/capture/capture-form.tsx",
        "app/staff/tasks/month/page.tsx",
      ])
    )
  })

  it("finds no in-app camera action in staff components", () => {
    const icons = new Set(filesIn(ICON_SCOPE))
    const found = filesIn(CAMERA_SCOPE).flatMap((file) =>
      cameraActions(file, read(file), { icons: icons.has(file) }).map(
        (hit) => `${file}:${hit}`
      )
    )
    expect(found).toEqual([])
  })

  it("finds none of §7's Not words in staff copy", () => {
    const found = filesIn(WORD_SCOPE).flatMap((file) =>
      wordHits(file, read(file)).map((hit) => `${file}:${hit}`)
    )
    expect(found).toEqual([])
  })

  it("fails on each camera action (a guard never seen to fail proves nothing)", () => {
    const hits = (source: string) =>
      cameraActions("probe.tsx", source).map((h) => h.replace(/^\d+ /, ""))
    expect(hits(`openAdd({ source: "camera", imagesOnly: true })`)).toEqual([
      `"camera" photo source`,
    ])
    expect(hits(`open("camera")`)).toEqual([`"camera" photo source`])
    expect(
      hits(`const a = <input type="file" capture="environment" />`)
    ).toEqual(["capture attribute"])
    expect(hits(`const p = { capture: "environment" }`)).toEqual([
      "capture property",
    ])
    expect(
      hits(`import { CameraPlusIcon } from "@phosphor-icons/react"`)
    ).toEqual(["CameraPlusIcon import"])
    expect(hits(`const a = <PhotoSourceActions onChoose={choose} />`)).toEqual([
      "PhotoSourceActions without cameraHidden",
    ])
    expect(
      hits(
        `const a = <PhotoSourceActions onChoose={choose} cameraHidden={false} />`
      )
    ).toEqual(["PhotoSourceActions without cameraHidden"])
    expect(
      hits(`const a = <Button>Take a photo of this dish</Button>`)
    ).toEqual([`"Take a photo of this dish"`])
    expect(hits(`const a = <Button>Open camera</Button>`)).toEqual([
      `"Open camera"`,
    ])
    expect(hits(`const s = { again: "Reshoot" }`)).toEqual([`"Reshoot"`])
  })

  it("passes the gallery and code that only names the camera", () => {
    const hits = (source: string) => cameraActions("probe.tsx", source)
    expect(
      hits(
        [
          `openAdd({ source: "library", imagesOnly: true })`,
          `const a = <PhotoSourceActions onChoose={choose} cameraHidden />`,
          `const b = <PhotoSourceActions onChoose={choose} cameraHidden={true} />`,
          `type Source = "library" | "camera"`,
          `// The camera is the phone's own (DESIGN.md §9).`,
          `const a = <Button>Add photos from your gallery</Button>`,
          `const c = { capture: view.capture }`,
          `import { ImagesIcon } from "@phosphor-icons/react"`,
        ].join("\n")
      )
    ).toEqual([])
    // Me's decorative icons are outside ICON_SCOPE.
    expect(
      cameraActions(
        "probe.tsx",
        `import { CameraIcon } from "@phosphor-icons/react"`,
        { icons: false }
      )
    ).toEqual([])
  })

  it("fails on §7's Not words and passes the Album ones", () => {
    const hits = (source: string) =>
      wordHits("probe.tsx", source).map((h) => h.replace(/^\d+ /, ""))
    expect(hits(`const a = <Button>Upload photos</Button>`)).toEqual([
      `"Upload photos"`,
    ])
    expect(hits("const a = `Photo uploaded ${date}`")).toEqual([
      `"Photo uploaded"`,
    ])
    expect(hits(`const s = "Pending review"`)).toEqual([`"Pending review"`])
    expect(hits(`const s = "Approved"`)).toEqual([`"Approved"`])
    expect(
      hits(
        [
          `const a = <Button>Add photos</Button>`,
          `const s = "Retake"`,
          `const t = "In the album"`,
          `const u = "Waiting for review"`,
          `import { uploadFile } from "@/lib/upload"`,
          `const href = "/api/uploads"`,
          `const k = "upload_started"`,
        ].join("\n")
      )
    ).toEqual([])
  })
})
