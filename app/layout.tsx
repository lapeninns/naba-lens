import type { Metadata, Viewport } from "next"
import { Figtree, Fraunces } from "next/font/google"

import "./globals.css"
import { CANVAS_SRGB } from "@/lib/pwa/canvas-colours"
import { InstallPromptCapture } from "@/components/nabalens/me/install-app"
import { ThemeProvider } from "@/components/theme-provider"
import { SentryConsent } from "@/components/nabalens/sentry-consent"
import { cn } from "@/lib/utils"

// Body face (design system v2, D10): everything people read and tap, at
// 400, 500, 600 and 700. Variable, so one file covers the four weights.
// Tabular figures for times and counts come from the same face
// (font-mono in app/globals.css).
const fontSans = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
})

// Display face (v2): names of things and big numbers, at 600. Variable,
// with the optical-size axis v2 loads (opsz 9..144) so large counts and
// small titles each get their own cut.
const fontDisplay = Fraunces({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-fraunces",
})

// Pages give their own short title ("Account"); the template adds the app
// name once, so no page repeats it.
export const metadata: Metadata = {
  title: { default: "Naba-Lens", template: "%s · Naba-Lens" },
  description:
    "Staff photos and videos of each venue's dishes, drinks and spaces, in one place.",
  // Added to a home screen (FA-53; spec §15.3): app/manifest.ts, and
  // app/apple-icon.png for iOS, which also reads these.
  applicationName: "Naba-Lens",
  appleWebApp: {
    capable: true,
    title: "Naba-Lens",
    statusBarStyle: "default",
  },
}

// Browser chrome matches the paper canvas in each theme (v2 `paper`, the
// `canvas` role, in sRGB, DESIGN.md §3.1; app/manifest.ts uses the light one). `cover` hands the notch and home indicator areas to the page:
// app/globals.css pads the body at the sides, and bottom bars and sheets add
// the bottom inset themselves.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: CANVAS_SRGB.light },
    { media: "(prefers-color-scheme: dark)", color: CANVAS_SRGB.dark },
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
        "font-sans"
      )}
    >
      <body>
        {process.env.NEXT_PUBLIC_SENTRY_DSN && <SentryConsent />}
        <InstallPromptCapture />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
