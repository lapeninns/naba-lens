// S1-EXPORT words for the admin Publishing screen and the manager's Exports
// (spec §8 A5, §14; DESIGN.md §7). These are admin and manager screens, so
// the spec's publication words appear here and nowhere on staff screens
// (FA-7, departures.md "Publication words"). Exported never claims a file is
// on a website (§10 inv. 9); nothing here claims a downloaded copy can be
// recalled (§14.2).

import type {
  ExportCategory,
  ExportPackageSummary,
  PackageState,
  PublicationAction,
  PublicationState,
} from "@/lib/server/exports/model"

export const CATEGORY_WORDS: Record<ExportCategory, string> = {
  food: "Food",
  drinks: "Drinks",
  spaces: "Spaces",
  facilities: "Facilities",
  other: "Other",
}

export const PACKAGE_CHIP: Record<PackageState, string> = {
  ready: "package_ready",
  exported: "package_exported",
  needs_rebuild: "package_needs_rebuild",
  invalidated: "package_invalidated",
}

export const publicationChip = (state: PublicationState) =>
  `publication_${state}`

export const ACTION_WORDS: Record<PublicationAction, string> = {
  published: "Published",
  withdrawal_requested: "Withdrawal asked for",
  withdrawn: "Removal confirmed",
  failed: "Failed or unknown",
}

export const DOWNLOAD_NOTICES: Record<string, string> = {
  invalidated:
    "This package can't be downloaded: a photo in it was withdrawn or changed after it was made. Rebuild it without that photo.",
  too_large:
    "These originals are too large for one ZIP. Make two smaller packages, or choose Website image.",
  not_found:
    "This package isn't available to you now. Your access may have changed.",
  signed_out: "Sign in again to download.",
  unavailable: "The download couldn't be prepared. Try again in a moment.",
}

export const EXPORTS_COPY = {
  adminTitle: "Publishing",
  adminScope: "All venues",
  adminSummary:
    "Export approved photos, and record where they are published. Exported means downloaded; Published needs a page address, a date and the person who checked it.",
  managerTitle: "Exports",
  managerSummary:
    "Download approved photos of your venue as a ZIP, with a list of what each file is.",
  makePackage: "Make an export package",
  outstandingTitle: "Needs following up",
  outstandingIntro:
    "These photos are no longer approved for public use, or their publishing couldn't be confirmed. Take them down where they are used, then confirm it here. A copy someone has already downloaded can't be recalled.",
  noOutstanding:
    "Nothing to follow up. Every published photo is still approved.",
  packagesTitle: "Export packages",
  noPackages: "No packages yet.",
  noPackagesText: "Choose approved photos to download them as a ZIP.",
  destinationsTitle: "Destinations",
  destinationsIntro:
    "Places photos are put by hand, such as a venue's website or its Google profile.",
  noDestinations: "No destinations yet.",
  publishedTitle: "Published",
  noPublished: "Nothing is recorded as published yet.",
  recentTitle: "Latest records",
  profilesTitle: "Output sizes",
  profilesIntro:
    "Presets for resized files. They are our own settings, not a platform's rules.",
  items: (n: number) => (n === 1 ? "1 photo" : `${n} photos`),
  madeBy: (who: string | null, when: string) =>
    who ? `Made by ${who}, ${when}` : `Made ${when}`,
  exportedOn: (when: string) => `Last downloaded ${when}`,
  internal: "Internal",
  rebuild: "Rebuild without withdrawn photos",
  rebuilt: "Rebuilt from an earlier package",
  download: "Download ZIP",
  readMe:
    "Exported is not Published. After you put a photo somewhere, record it on the Publishing page.",
  unavailable: "Couldn't load. Reload the page to try again.",
  allVenues: "All venues",
  confirmRemoved: "Confirm it's taken down",
  removedNote: "Note (optional)",
  since: (when: string) => `Since ${when}`,
} as const

/** "18 Nov 2026" in Europe/London. */
export function londonDate(iso: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(date))
}

/** Today's London date, "YYYY-MM-DD". */
export function londonToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
  }).format(new Date())
}

export function packageTitle(pkg: ExportPackageSummary): string {
  const where = pkg.venueName ?? EXPORTS_COPY.allVenues
  return `${where} · ${pkg.profile.label}`
}
