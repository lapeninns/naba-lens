"use client"

import * as React from "react"
import {
  FileTextIcon,
  PaperclipIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
  WarningIcon,
} from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import {
  MENU_IMPORT_LIMITS,
  SUPPORTED_IMPORT_FORMATS,
  type ImportIssue,
} from "@/lib/menus/types"
import { cn } from "@/lib/utils"

import { formatBytes } from "../format"
import { Notice } from "../notice"
import { UNSUPPORTED_IMPORT_COPY } from "./copy"

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

/** "1 MB" for a whole number of megabytes, otherwise formatBytes. */
function limitText(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return Number.isInteger(mb) ? `${mb} MB` : formatBytes(bytes)
}

/** Why a chosen file cannot be previewed, or null when it may be sent. */
export function checkImportFile(
  file: Pick<File, "name" | "size">,
  maxBytes: number = MENU_IMPORT_LIMITS.maxBytes
): string | null {
  const ext = file.name.includes(".")
    ? file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase()
    : ""
  if (!(SUPPORTED_IMPORT_FORMATS as readonly string[]).includes(ext)) {
    return ext === "pdf"
      ? `${file.name} is a PDF, so it can't be read. Export the menu as JSON or CSV and choose that file.`
      : `${file.name} can't be read. Export the menu as JSON or CSV and choose that file.`
  }
  if (file.size === 0)
    return `${file.name} is empty. Export the menu again and choose that file.`
  if (file.size > maxBytes) {
    return `${file.name} is ${formatBytes(file.size)}. The limit is ${limitText(maxBytes)}; split drinks into their own file or remove source notes.`
  }
  return null
}

const capitalise = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1)

/** Problems that stopped a file, errors first, inside one failure notice. */
function ImportProblems({
  issues,
  action,
}: {
  issues: ImportIssue[]
  action: React.ReactNode
}) {
  const errors = issues.filter((i) => i.severity === "error")
  const warnings = issues.filter((i) => i.severity === "warning")
  const count = errors.length || issues.length
  return (
    <Notice
      tone="negative"
      title={`${count} ${count === 1 ? "problem stops" : "problems stop"} this file being imported`}
      action={action}
    >
      <ul className="mt-1 grid max-h-64 gap-1 overflow-y-auto">
        {[...errors, ...warnings].map((issue, i) => {
          const Icon =
            issue.severity === "error" ? WarningCircleIcon : WarningIcon
          return (
            <li
              key={`${issue.path}-${i}`}
              className="flex items-start gap-2 break-words"
            >
              <Icon
                aria-label={issue.severity === "error" ? "Error" : "Warning"}
                className={
                  issue.severity === "error"
                    ? "mt-0.5 size-4 shrink-0 text-negative"
                    : "mt-0.5 size-4 shrink-0 text-attention"
                }
              />
              <span className="min-w-0">
                {issue.path ? `${capitalise(issue.path)}: ` : null}
                {issue.message}
              </span>
            </li>
          )
        })}
      </ul>
    </Notice>
  )
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
  const [file, setFile] = React.useState<{
    name: string
    size: number
    rejection: string | null
  } | null>(null)
  const id = React.useId()

  function choose(files: FileList | null, el: HTMLInputElement) {
    const next = files?.[0]
    // Clear so choosing the same file again still fires change.
    el.value = ""
    if (!next) return
    const rejection = checkImportFile(next, maxBytes)
    setFile({ name: next.name, size: next.size, rejection })
    if (!rejection) void onPreview(next)
  }

  const open = () => input.current?.click()
  const chooseAnother = (
    <Button
      variant="secondary"
      size="sm"
      onClick={open}
      disabled={disabled || pending}
    >
      Choose another file
    </Button>
  )

  return (
    <div className={cn("grid gap-4", className)}>
      <div className="grid gap-2">
        {/* The hidden input carries the name; this is its visible label. */}
        <span aria-hidden className="text-label-touch text-ink md:text-label">
          Menu file
        </span>
        {file ? (
          <div
            className={cn(
              "flex items-center gap-3 rounded-control border bg-panel px-3 py-2",
              file.rejection ? "border-negative" : "border-line"
            )}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-well text-ink-muted">
              <FileTextIcon aria-hidden className="size-5" />
            </span>
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="font-mono text-mono break-all text-ink">
                {file.name}
              </span>
              <span className="flex items-center gap-1.5 text-meta-touch text-ink-muted md:text-meta">
                {pending ? (
                  <>
                    <SpinnerGapIcon
                      aria-hidden
                      className="size-4 motion-safe:animate-spin"
                    />
                    Comparing…
                  </>
                ) : (
                  formatBytes(file.size)
                )}
              </span>
            </span>
            <Button
              variant="quiet"
              size="sm"
              onClick={open}
              disabled={disabled || pending}
            >
              Choose another file
            </Button>
          </div>
        ) : (
          <Button
            variant="secondary"
            size="touch"
            className="w-full md:w-fit"
            onClick={open}
            disabled={disabled || pending}
            aria-describedby={`${id}-help`}
          >
            <PaperclipIcon aria-hidden />
            Choose a file
          </Button>
        )}
        <input
          ref={input}
          type="file"
          accept={IMPORT_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-label="Menu file (JSON or CSV)"
          aria-describedby={`${id}-help`}
          disabled={disabled || pending}
          onChange={(e) => choose(e.currentTarget.files, e.currentTarget)}
        />
        {file?.rejection ? (
          <p
            role="alert"
            className="flex items-start gap-1.5 text-body-touch break-words text-negative md:text-body-sm"
          >
            <WarningCircleIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            {file.rejection}
          </p>
        ) : (
          <p
            id={`${id}-help`}
            className="text-meta-touch text-ink-muted md:text-meta"
          >
            JSON (nabalens-menu@1) or CSV, up to {limitText(maxBytes)}.{" "}
            {UNSUPPORTED_IMPORT_COPY}
          </p>
        )}
      </div>

      {!file?.rejection && issues.length > 0 ? (
        <ImportProblems issues={issues} action={chooseAnother} />
      ) : !file?.rejection && error ? (
        <Notice tone="negative" action={chooseAnother}>
          {error}
        </Notice>
      ) : null}

      <details className="group rounded-control border border-line">
        <summary className="flex min-h-11 cursor-pointer items-center rounded-control px-3 text-label-touch text-ink outline-none focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-solid md:min-h-9 md:text-label">
          Supported formats
        </summary>
        <div className="grid gap-4 border-t border-line px-3 py-3 text-body-touch md:text-body-sm">
          <div className="grid gap-1.5">
            <h3 className="font-semibold text-ink">JSON (nabalens-menu@1)</h3>
            <p className="text-ink-muted">
              One object with <code>format</code>, <code>title</code> and{" "}
              <code>sections</code>. Each section has a <code>name</code>, a{" "}
              <code>kind</code> (<code>food</code>, <code>drinks</code> or{" "}
              <code>other</code>) and <code>items</code>. Items need a{" "}
              <code>name</code>; <code>description</code>, <code>variants</code>
              , <code>aliases</code> and a stable <code>key</code> are optional.
            </p>
            <pre className="overflow-x-auto rounded-control bg-well p-2 font-mono text-mono">
              <code>{JSON_EXAMPLE}</code>
            </pre>
          </div>
          <div className="grid gap-1.5">
            <h3 className="font-semibold text-ink">
              CSV (header row required)
            </h3>
            <p className="text-ink-muted">
              One row per item. Separate several variants or aliases with{" "}
              <code>|</code>. Price and dietary columns are kept as source
              information only; they are never shown as current.
            </p>
            <pre className="overflow-x-auto rounded-control bg-well p-2 font-mono text-mono">
              <code>{CSV_EXAMPLE}</code>
            </pre>
          </div>
          <p className="text-ink-muted">
            Re-importing matches items by source key only: the <code>key</code>{" "}
            value, or one made from the section and item names. Anything that
            only matches by name is listed for you to decide; nothing is merged
            automatically.
          </p>
        </div>
      </details>
    </div>
  )
}
