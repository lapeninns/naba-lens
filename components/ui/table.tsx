import * as React from "react"

import { cn } from "@/lib/utils"

/*
 * Table (DESIGN.md §4, Table; strategy 7.5: tables on admin from md, stacked
 * below). Two modes:
 *
 *  - scroll (default): the table keeps its columns and its wrapper scrolls
 *    sideways.
 *  - stacked (`<Table stacked>`): below md each row becomes a block, the
 *    header row is hidden from sight but still read, and each cell shows its
 *    own `label` before its value. From md it is the same table as scroll.
 *
 * Every part names its ARIA role. A browser drops the table roles from a
 * `table`, `tr` or `td` whose display is changed, which is what stacking
 * does; written out, a screen reader still hears rows, cells and headers.
 *
 * Draw the surface (card fill, radius, shadow) on a wrapper: the table is
 * the grid only.
 */

// Applies below md, and only inside a stacked table.
const STACKED = {
  block: "max-md:group-data-stacked/table:block",
  srOnly: "max-md:group-data-stacked/table:sr-only",
} as const

function Table({
  className,
  stacked = false,
  ...props
}: React.ComponentProps<"table"> & {
  /** Below md, turn each row into a block of labelled values. */
  stacked?: boolean
}) {
  return (
    <div
      data-slot="table-container"
      data-mode={stacked ? "stacked" : "scroll"}
      data-stacked={stacked || undefined}
      className="group/table relative w-full overflow-x-auto max-md:data-stacked:overflow-x-visible"
    >
      <table
        role="table"
        data-slot="table"
        className={cn("w-full caption-top text-body", STACKED.block, className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      role="rowgroup"
      data-slot="table-header"
      className={cn(
        "[&_tr]:border-b [&_tr]:border-line [&_tr]:hover:bg-transparent",
        STACKED.srOnly,
        className
      )}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      role="rowgroup"
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", STACKED.block, className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      role="rowgroup"
      data-slot="table-footer"
      className={cn(
        "border-t border-line bg-surface-2 font-bold [&>tr]:last:border-b-0",
        STACKED.block,
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      role="row"
      data-slot="table-row"
      className={cn(
        // A selected row is told apart by its fill, which forced colours
        // remove; it gets an outline there. Give it a tick or a word too.
        "border-b border-line transition-colors hover:bg-surface-2 has-aria-expanded:bg-surface-2 aria-selected:bg-accent-soft data-[state=selected]:bg-accent-soft forced-colors:aria-selected:outline-2 forced-colors:aria-selected:-outline-offset-2 forced-colors:aria-selected:outline-solid forced-colors:data-[state=selected]:outline-2 forced-colors:data-[state=selected]:-outline-offset-2 forced-colors:data-[state=selected]:outline-solid",
        STACKED.block,
        "max-md:group-data-stacked/table:py-2",
        className
      )}
      {...props}
    />
  )
}

function TableHead({
  className,
  scope = "col",
  numeric = false,
  ...props
}: React.ComponentProps<"th"> & {
  /** A column of numbers: right-aligned, like its cells. */
  numeric?: boolean
}) {
  return (
    <th
      // A row's own heading (`scope="row"`) sits in the body.
      role={scope === "row" ? "rowheader" : "columnheader"}
      scope={scope}
      data-slot="table-head"
      data-numeric={numeric || undefined}
      className={cn(
        "h-11 px-3 py-2.5 text-left align-middle text-label font-semibold whitespace-nowrap text-ink-muted [&:has([role=checkbox])]:pr-0",
        numeric && "text-right",
        STACKED.block,
        "max-md:group-data-stacked/table:h-auto max-md:group-data-stacked/table:py-1 max-md:group-data-stacked/table:text-left max-md:group-data-stacked/table:whitespace-normal",
        className
      )}
      {...props}
    />
  )
}

function TableCell({
  className,
  label,
  numeric = false,
  children,
  ...props
}: React.ComponentProps<"td"> & {
  /** The column's name, shown before the value in a stacked table below md.
   *  Leave it off the row's title cell, which needs no label. */
  label?: string
  /** A number: right-aligned, mono, tabular figures. */
  numeric?: boolean
}) {
  return (
    <td
      role="cell"
      data-slot="table-cell"
      data-label={label}
      data-numeric={numeric || undefined}
      className={cn(
        "px-3 py-3 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        numeric && "text-right font-mono tabular-nums",
        "max-md:group-data-stacked/table:py-1 max-md:group-data-stacked/table:text-left max-md:group-data-stacked/table:whitespace-normal",
        label === undefined
          ? STACKED.block
          : "max-md:group-data-stacked/table:flex max-md:group-data-stacked/table:items-baseline max-md:group-data-stacked/table:gap-2",
        className
      )}
      {...props}
    >
      {label === undefined ? (
        children
      ) : (
        <>
          {/* Sighted readers only: the hidden header row already gives a
              screen reader the column's name. */}
          <span
            aria-hidden
            data-slot="table-cell-label"
            className="hidden w-32 shrink-0 font-sans text-meta text-ink-muted max-md:group-data-stacked/table:block"
          >
            {label}
          </span>
          <span
            data-slot="table-cell-value"
            className="contents max-md:group-data-stacked/table:block max-md:group-data-stacked/table:min-w-0 max-md:group-data-stacked/table:flex-1"
          >
            {children}
          </span>
        </>
      )}
    </td>
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn(
        "px-3 py-3 text-left type-section-title text-ink",
        STACKED.block,
        className
      )}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
