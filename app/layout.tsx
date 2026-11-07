import {
  Atkinson_Hyperlegible_Mono,
  Atkinson_Hyperlegible_Next,
  Figtree,
} from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { cn } from "@/lib/utils"

// Body face (Common Room): body text, buttons, fields, chips.
const fontSans = Atkinson_Hyperlegible_Next({
  subsets: ["latin"],
  variable: "--font-atkinson-next",
})

// Display face: the wordmark, titles, counts, tab labels, the Complete stamp.
const fontDisplay = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
})

// Meta, times and percentages (tabular), file names, request IDs.
const fontMono = Atkinson_Hyperlegible_Mono({
  subsets: ["latin"],
  variable: "--font-atkinson-mono",
})

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
