import type { Metadata, Viewport } from "next"
import {
  Atkinson_Hyperlegible_Mono,
  Atkinson_Hyperlegible_Next,
  Fraunces,
} from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { cn } from "@/lib/utils"

// Body face (Album, DESIGN.md §3.3): body text, buttons, fields, chips,
// tab labels.
const fontSans = Atkinson_Hyperlegible_Next({
  subsets: ["latin"],
  variable: "--font-atkinson-next",
})

// Display face: the wordmark, titles, counts and the section stamp, at 21px
// and up or 17px caps. Variable, with the optical-size axis so large counts
// and small headings each get their own cut.
const fontDisplay = Fraunces({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-fraunces",
})

// Meta, times and percentages (tabular), file names, request IDs.
const fontMono = Atkinson_Hyperlegible_Mono({
  subsets: ["latin"],
  variable: "--font-atkinson-mono",
})

// Pages give their own short title ("Account"); the template adds the app
// name once, so no page repeats it.
export const metadata: Metadata = {
  title: { default: "Naba-Lens", template: "%s · Naba-Lens" },
  description:
    "Staff photos and videos of each venue's dishes, drinks and spaces, in one place.",
}

// Browser chrome matches the grey canvas in each theme (the canvas token in
// sRGB). `cover` hands the notch and home indicator areas to the page:
// app/globals.css pads the body at the sides, and bottom bars and sheets add
// the bottom inset themselves.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef0f3" },
    { media: "(prefers-color-scheme: dark)", color: "#131415" },
  ],
  colorScheme: "light dark",
  viewportFit: "cover",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontSans.variable,
        fontDisplay.variable,
        fontMono.variable,
        "font-sans"
      )}
    >
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
