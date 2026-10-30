"use client"

import * as React from "react"
import { FileArrowUpIcon, SpinnerGapIcon } from "@phosphor-icons/react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  MENU_IMPORT_LIMITS,
  SUPPORTED_IMPORT_FORMATS,
  type ImportIssue,
} from "@/lib/menus/types"
import { cn } from "@/lib/utils"

import { formatBytes } from "../format"
import { UNSUPPORTED_IMPORT_COPY } from "./copy"
import { ImportIssueList } from "./import-issue-list"

export const IMPORT_ACCEPT = SUPPORTED_IMPORT_FORMATS.map((f) => `.${f}`).join(
  ","
)

const JSON_EXAMPLE = `{
  "format": "nabalens-menu@1",
  "title": "Autumn menu",
  "sections": [
    {
      "name": "Curries",
      "kind": "food",
      "items": [
        {
          "name": "Tikka masala",
          "description": "Creamy tomato sauce",
          "variants": ["Veg", "Chicken"],
          "aliases": ["CTM"],
          "key": "curries--tikka-masala"
        }
      ]
    }
  ]
}`

const CSV_EXAMPLE = `section,section_kind,item,description,variants,aliases,key,price,dietary
Curries,food,Tikka masala,Creamy tomato sauce,Veg|Chicken,CTM,,12.50,
Drinks,drinks,House lager,,,Lager,,5.20,`

/** Why a chosen file cannot be previewed, or null when it may be sent. */
export function checkImportFile(
  file: Pick<File, "name" | "size">,
  maxBytes: number = MENU_IMPORT_LIMITS.maxBytes
): string | null {
  const ext = file.name.includes(".")
    ? file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase()
    : ""
  if (!(SUPPORTED_IMPORT_FORMATS as readonly string[]).includes(ext)) {
    return `Only .json and .csv files can be imported. ${UNSUPPORTED_IMPORT_COPY}`
  }
  if (file.size === 0) return "The file is empty."
  if (file.size > maxBytes) {
    return `The file is ${formatBytes(file.size)}. The limit is ${formatBytes(maxBytes)}.`
  }
  return null
}

type MenuImportPanelProps = {
  /** Called only for a .json/.csv file within `maxBytes`. */
  onPreview: (file: File) => void | Promise<void>
  /** The preview request is running. */
  pending?: boolean
  /** Request-level failure from the preview route. */
  error?: string | null
  /** Parser issues for the last previewed file. */
  issues?: ImportIssue[]
  maxBytes?: number
  disabled?: boolean
  className?: string
}

/** Choose a structured JSON/CSV menu file; documents both formats. */
export function MenuImportPanel({
  onPreview,
  pending = false,
  error,
  issues = [],
  maxBytes = MENU_IMPORT_LIMITS.maxBytes,
  disabled = false,
  className,
}: MenuImportPanelProps) {
  const input = React.useRef<HTMLInputElement>(null)
  const [rejection, setRejection] = React.useState<{
    name: string
    reason: string
  } | null>(null)
  const [fileName, setFileName] = React.useState<string | null>(null)
  const id = React.useId()

  function choose(files: FileList | null, el: HTMLInputElement) {
    const file = files?.[0]
    // Clear so choosing the same file again still fires change.
    el.value = ""
    if (!file) return
    const reason = checkImportFile(file, maxBytes)
    if (reason) {
      setRejection({ name: file.name, reason })
      setFileName(null)
      return
    }
    setRejection(null)
    setFileName(file.name)
    void onPreview(file)
  }

  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cn("grid gap-4 rounded-lg border bg-card p-4", className)}
    >
      <div className="grid gap-1">
        <h2 id={`${id}-title`} className="text-base font-medium">
          Import a menu file
        </h2>
        <p id={`${id}-help`} className="text-sm text-muted-foreground">
          JSON or CSV only, up to {formatBytes(maxBytes)}. The file becomes a
          new draft that you review before activating.
        </p>
        <p className="text-sm font-medium">{UNSUPPORTED_IMPORT_COPY}</p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button
          size="touch"
          onClick={() => input.current?.click()}
          disabled={disabled || pending}
          aria-busy={pending || undefined}
          aria-describedby={`${id}-help`}
        >
          {pending ? (
            <SpinnerGapIcon
              data-icon="inline-start"
              className="motion-safe:animate-spin"
              aria-hidden
            />
          ) : (
            <FileArrowUpIcon data-icon="inline-start" aria-hidden />
          )}
          {pending ? "Reading file…" : "Choose JSON or CSV file"}
        </Button>
        <input
          ref={input}
          type="file"
          accept={IMPORT_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-label="Menu file (JSON or CSV)"
          disabled={disabled || pending}
          onChange={(e) => choose(e.currentTarget.files, e.currentTarget)}
        />
        <p aria-live="polite" className="min-w-0 text-sm break-all">
          {fileName && !rejection ? (
            <>
              <span className="text-muted-foreground">
                {pending ? "Checking " : "Last file: "}
              </span>
              {fileName}
            </>
          ) : null}
        </p>
      </div>

      {rejection ? (
        <Alert variant="destructive">
          <AlertTitle className="break-all">
            {rejection.name} was not imported
          </AlertTitle>
          <AlertDescription>{rejection.reason}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Preview failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {!rejection ? <ImportIssueList issues={issues} /> : null}

      <details className="group rounded-md border">
        <summary className="cursor-pointer rounded-md px-3 py-2 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          Supported formats
        </summary>
        <div className="grid gap-4 border-t px-3 py-3 text-sm">
          <div className="grid gap-1.5">
            <h3 className="font-medium">JSON (nabalens-menu@1)</h3>
            <p className="text-muted-foreground">
              One object with <code>format</code>, <code>title</code> and{" "}
              <code>sections</code>. Each section has a <code>name</code>, a{" "}
              <code>kind</code> (<code>food</code>, <code>drinks</code> or{" "}
              <code>other</code>) and <code>items</code>. Items need a{" "}
              <code>name</code>; <code>description</code>, <code>variants</code>
              , <code>aliases</code> and a stable <code>key</code> are optional.
            </p>
            <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs">
              <code>{JSON_EXAMPLE}</code>
            </pre>
          </div>
          <div className="grid gap-1.5">
            <h3 className="font-medium">CSV (header row required)</h3>
            <p className="text-muted-foreground">
              One row per item. Separate several variants or aliases with{" "}
              <code>|</code>. Price and dietary columns are kept as source
              information only; they are never shown as current.
            </p>
            <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs">
              <code>{CSV_EXAMPLE}</code>
            </pre>
          </div>
          <p className="text-muted-foreground">
            Re-importing matches items by source key only: the <code>key</code>{" "}
            value, or one made from the section and item names. Anything that
            only matches by name is listed for you to decide; nothing is merged
            automatically.
          </p>
        </div>
      </details>
    </section>
  )
}
