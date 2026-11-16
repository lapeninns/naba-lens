import { cloneElement, isValidElement, useId } from "react"
import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"

/*
 * The field family (DESIGN.md §4 Field, §7): a label, one control, its error
 * and its hint. FormField is the way to write a labelled control: it makes
 * the ids and links the parts. The loose parts stay for layouts it does not
 * cover (choice cards, fieldsets, a row of fields).
 *
 * No "use client": every part renders on the server, and `useId` works there.
 */

function FieldSet({ className, ...props }: React.ComponentProps<"fieldset">) {
  return (
    <fieldset
      data-slot="field-set"
      className={cn(
        "flex flex-col gap-4 has-[>[data-slot=checkbox-group]]:gap-3 has-[>[data-slot=radio-group]]:gap-3",
        className
      )}
      {...props}
    />
  )
}

function FieldLegend({
  className,
  variant = "legend",
  ...props
}: React.ComponentProps<"legend"> & { variant?: "legend" | "label" }) {
  return (
    <legend
      data-slot="field-legend"
      data-variant={variant}
      className={cn(
        "mb-1.5 text-ink data-[variant=label]:text-label data-[variant=legend]:type-section-title",
        className
      )}
      {...props}
    />
  )
}

function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-group"
      className={cn(
        "group/field-group @container/field-group flex w-full flex-col gap-5 data-[slot=checkbox-group]:gap-3 *:data-[slot=field-group]:gap-4",
        className
      )}
      {...props}
    />
  )
}

const fieldVariants = cva("group/field flex w-full gap-1.5", {
  variants: {
    orientation: {
      vertical: "flex-col *:w-full [&>.sr-only]:w-auto",
      horizontal:
        "flex-row items-center has-[>[data-slot=field-content]]:items-start *:data-[slot=field-label]:flex-auto has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
      responsive:
        "flex-col *:w-full @md/field-group:flex-row @md/field-group:items-center @md/field-group:*:w-auto @md/field-group:has-[>[data-slot=field-content]]:items-start @md/field-group:*:data-[slot=field-label]:flex-auto [&>.sr-only]:w-auto @md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
    },
  },
  defaultVariants: {
    orientation: "vertical",
  },
})

function Field({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof fieldVariants>) {
  return (
    <div
      role="group"
      data-slot="field"
      data-orientation={orientation}
      className={cn(fieldVariants({ orientation }), className)}
      {...props}
    />
  )
}

function FieldContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-content"
      className={cn(
        "group/field-content flex flex-1 flex-col gap-0.5 leading-snug",
        className
      )}
      {...props}
    />
  )
}

function FieldLabel({
  className,
  optional = false,
  children,
  ...props
}: React.ComponentProps<typeof Label> & {
  /**
   * Fields are required unless marked: this adds the muted " (optional)"
   * after the label, the one way that is written.
   */
  optional?: boolean
}) {
  return (
    <Label
      data-slot="field-label"
      className={cn(
        "group/field-label peer/field-label flex w-fit gap-2 leading-snug group-data-[disabled=true]/field:opacity-50 has-data-checked:bg-accent-soft has-data-checked:shadow-[inset_0_0_0_2px_var(--select)] has-[>[data-slot=field]]:rounded-card has-[>[data-slot=field]]:bg-surface has-[>[data-slot=field]]:shadow-card has-[>[data-slot=field]]:not-has-[:disabled,[data-disabled]]:hover:bg-surface-2 has-[>[data-slot=field]]:has-[:focus-visible]:outline-3 has-[>[data-slot=field]]:has-[:focus-visible]:outline-offset-2 has-[>[data-slot=field]]:has-[:focus-visible]:outline-focus has-[>[data-slot=field]]:has-[:focus-visible]:outline-solid *:data-[slot=field]:p-3",
        "has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col",
        className
      )}
      {...props}
    >
      {children}
      {optional ? (
        <span data-slot="field-optional" className="font-normal text-ink-muted">
          {" (optional)"}
        </span>
      ) : null}
    </Label>
  )
}

function FieldTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-label"
      className={cn(
        "flex w-fit items-center gap-2 text-label text-ink group-data-[disabled=true]/field:opacity-50",
        className
      )}
      {...props}
    />
  )
}

function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn(
        "text-left text-body font-normal text-ink-muted group-has-data-horizontal/field:text-balance [[data-variant=legend]+&]:-mt-1.5",
        "last:mt-0 nth-last-2:-mt-1",
        "[&>a]:font-bold [&>a]:text-ink [&>a]:underline [&>a]:underline-offset-4",
        className
      )}
      {...props}
    />
  )
}

function FieldSeparator({
  children,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  children?: React.ReactNode
}) {
  return (
    <div
      data-slot="field-separator"
      data-content={!!children}
      className={cn("relative -my-2 h-6 text-meta", className)}
      {...props}
    >
      <Separator className="absolute inset-0 top-1/2" />
      {children && (
        <span
          className="relative mx-auto block w-fit bg-canvas px-2 text-ink-muted"
          data-slot="field-separator-content"
        >
          {children}
        </span>
      )}
    </div>
  )
}

function FieldError({
  className,
  children,
  errors,
  announce = "assertive",
  ...props
}: React.ComponentProps<"div"> & {
  errors?: Array<{ message?: string } | undefined>
  /**
   * How the error is read out. "assertive" (`role="alert"`, the default)
   * interrupts. Where a form already has one assertive notice, pass "polite"
   * (`role="status"`) so the field errors do not talk over it.
   */
  announce?: "assertive" | "polite"
}) {
  const content = children || errorList(errors)

  if (!content) {
    return null
  }

  return (
    <div
      role={announce === "polite" ? "status" : "alert"}
      data-slot="field-error"
      // Never colour alone: an icon and the words, in warn (DESIGN.md §4).
      className={cn(
        "flex items-start gap-1.5 text-body font-bold text-warn-fg",
        className
      )}
      {...props}
    >
      <WarningCircleIcon aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0">{content}</div>
    </div>
  )
}

function errorList(
  errors: Array<{ message?: string } | undefined> | undefined
): React.ReactNode {
  if (!errors?.length) {
    return null
  }

  const uniqueErrors = [
    ...new Map(errors.map((error) => [error?.message, error])).values(),
  ]

  if (uniqueErrors.length == 1) {
    return uniqueErrors[0]?.message
  }

  return (
    <ul className="ml-4 flex list-disc flex-col gap-1">
      {uniqueErrors.map(
        (error, index) => error?.message && <li key={index}>{error.message}</li>
      )}
    </ul>
  )
}

/** What FormField gives its control. */
type FormFieldControlProps = {
  id: string
  /**
   * The label's id. `htmlFor` names an input, a button or a textarea; a
   * group (`role="radiogroup"`) is not labelable, so it takes this instead.
   */
  "aria-labelledby": string
  /** The error's id, then the hint's; unset when the field has neither. */
  "aria-describedby"?: string
  /** Set while the field has an error. */
  "aria-invalid"?: true
  /** Set unless the field is marked optional. */
  required?: true
}

type FormFieldProps = Omit<React.ComponentProps<typeof Field>, "children"> & {
  /** The visible name of the control. */
  label: React.ReactNode
  /** Keep the label for screen readers only, where the screen already says it. */
  hideLabel?: boolean
  /** Fields are required unless this is set; it adds " (optional)". */
  optional?: boolean
  /** A hint under the control. */
  description?: React.ReactNode
  /** The error under the control. Its presence marks the control invalid. */
  error?: React.ReactNode
  /** Passed to FieldError: "assertive" (default) or "polite". */
  announce?: "assertive" | "polite"
  /** The control's id. Made with `useId` when left out. */
  id?: string
  /**
   * One control. An element is given the wiring as props: Input, Textarea,
   * a native control, Select, Combobox, SegmentedControl and RadioGroup all
   * take it. A function receives the wiring instead, for a control that
   * takes it under other names or on an inner part:
   * `{(control) => <OptionSelect id={control.id} … />}`.
   */
  children:
    | React.ReactElement<Record<string, unknown>>
    | ((control: FormFieldControlProps) => React.ReactNode)
}

function isShown(node: React.ReactNode) {
  return node != null && node !== false && node !== ""
}

function words(...ids: Array<unknown>) {
  const list = ids.filter(
    (id): id is string => typeof id === "string" && id !== ""
  )
  return list.length ? list.join(" ") : undefined
}

/*
 * A labelled control with its hint and error (DESIGN.md §4 Field; strategy
 * 7.2). It makes the ids and links the label (`htmlFor`), the error and the
 * hint (`aria-describedby`), `aria-invalid` and `required`, so no screen
 * wires them by hand. Order on screen and in the DOM: label, control, error,
 * hint.
 *
 * The wiring goes on by cloning the child or through a render function, not
 * through context: context would make every control a client component,
 * and this way a FormField with a plain Input still renders on the server.
 * What the child sets itself (an id, a name, `required`, `aria-invalid`)
 * wins. The label is linked both ways, `htmlFor` and `aria-labelledby`, so
 * a group that `htmlFor` cannot name (RadioGroup, SegmentedControl) still
 * gets its name.
 */
function FormField({
  label,
  hideLabel = false,
  optional = false,
  description,
  error,
  announce,
  id: idProp,
  children,
  ...props
}: FormFieldProps) {
  const generated = useId()
  const child = typeof children === "function" ? null : children
  const own = isValidElement(child) ? child.props : {}

  const id =
    idProp ?? (typeof own.id === "string" && own.id ? own.id : generated)
  const labelId = `${id}-label`
  const errorId = `${id}-error`
  const descriptionId = `${id}-description`
  const hasError = isShown(error)
  const hasDescription = isShown(description)

  const control: FormFieldControlProps = {
    id,
    "aria-labelledby": labelId,
    "aria-describedby": words(
      hasError && errorId,
      hasDescription && descriptionId
    ),
    "aria-invalid": hasError || undefined,
    required: !optional || undefined,
  }

  return (
    <Field
      // The spec's field is a plain wrapper: a group with no name is noise.
      role={undefined}
      data-invalid={hasError || undefined}
      data-optional={optional || undefined}
      {...props}
    >
      <FieldLabel
        id={labelId}
        htmlFor={id}
        optional={optional}
        className={hideLabel ? "sr-only" : undefined}
      >
        {label}
      </FieldLabel>
      {typeof children === "function"
        ? children(control)
        : cloneElement(children, {
            id,
            // A name the control gave itself is kept: aria-labelledby would
            // otherwise override its aria-label.
            "aria-labelledby":
              own["aria-labelledby"] ??
              (own["aria-label"] ? undefined : labelId),
            "aria-describedby": words(
              own["aria-describedby"],
              control["aria-describedby"]
            ),
            "aria-invalid": own["aria-invalid"] ?? control["aria-invalid"],
            required: own.required ?? control.required,
          })}
      {hasError ? (
        <FieldError id={errorId} announce={announce}>
          {error}
        </FieldError>
      ) : null}
      {hasDescription ? (
        <FieldDescription id={descriptionId}>{description}</FieldDescription>
      ) : null}
    </Field>
  )
}

export {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldContent,
  FieldTitle,
  FormField,
}
export type { FormFieldControlProps, FormFieldProps }
