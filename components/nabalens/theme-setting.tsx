"use client"

import { SegmentedControl } from "@/components/ui/segmented-control"
import * as React from "react"
import { useTheme } from "next-themes"

import { cn } from "@/lib/utils"

import { Card } from "./common-room/card"

export const THEME_SETTING_COPY = {
  heading: "Appearance",
  help: "System follows this device's light or dark setting.",
  options: [
    { value: "system", label: "System" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ],
} as const

type ThemeChoice = (typeof THEME_SETTING_COPY.options)[number]["value"]

const CHOICES: readonly string[] = THEME_SETTING_COPY.options.map(
  (option) => option.value
)
const OPTIONS = [...THEME_SETTING_COPY.options]

const subscribe = () => () => {}

/**
 * The person's choice of theme: follow the device, or always light or dark.
 * `section` puts the heading above a card (staff Me); `card` keeps heading,
 * control and help inside one card (manager Account).
 */
export function ThemeSetting({
  layout = "section",
  className,
}: {
  layout?: "section" | "card"
  className?: string
}) {
  const { theme, setTheme } = useTheme()
  // The stored choice is only known in the browser. Until then no segment is
  // selected, so server and client markup match and nothing moves.
  const mounted = React.useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  )
  const headingId = React.useId()
  const helpId = React.useId()
  const value: ThemeChoice | "" =
    mounted && theme && CHOICES.includes(theme) ? (theme as ThemeChoice) : ""

  const control = (
    <SegmentedControl<ThemeChoice | "">
      name="theme"
      aria-labelledby={headingId}
      aria-describedby={helpId}
      options={OPTIONS}
      value={value}
      onValueChange={setTheme}
    />
  )
  const help = (
    <p id={helpId} className="text-meta text-ink-muted">
      {THEME_SETTING_COPY.help}
    </p>
  )

  if (layout === "card") {
    return (
      <Card
        as="section"
        aria-labelledby={headingId}
        data-slot="theme-setting"
        className={className}
      >
        <h2 id={headingId} className="text-meta font-semibold text-ink-muted">
          {THEME_SETTING_COPY.heading}
        </h2>
        {control}
        {help}
      </Card>
    )
  }

  return (
    <section
      aria-labelledby={headingId}
      data-slot="theme-setting"
      className={cn("grid gap-3 pt-2", className)}
    >
      <h2 id={headingId} className="px-1 type-section-title text-ink">
        {THEME_SETTING_COPY.heading}
      </h2>
      <Card>
        {control}
        {help}
      </Card>
    </section>
  )
}
