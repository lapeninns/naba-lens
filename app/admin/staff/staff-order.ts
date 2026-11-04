import type { StaffMember } from "@/components/nabalens"

const collator = new Intl.Collator("en-GB", { sensitivity: "base" })

/** "Priya Gurung" -> first "Priya", surname "Gurung"; one word is the surname. */
export function splitName(displayName: string) {
  const words = displayName.trim().split(/\s+/)
  const surname = words.pop() ?? ""
  return { first: words.join(" "), surname }
}

export function firstName(displayName: string) {
  const { first, surname } = splitName(displayName)
  return first.split(" ")[0] || surname
}

/** "Priya's", "James's": the copy deck's possessive for a first name. */
export function possessive(name: string) {
  return `${name}'s`
}

/** Without a team, the person's monthly target shows Needs setup. */
export function needsSetup(member: StaffMember) {
  return member.status !== "inactive" && !member.department
}

/**
 * The people order used across Naba-Lens: Needs setup and Invited first, then
 * A to Z by surname, ties by first name. Surname order avoids reading as a
 * ranking.
 */
export function compareStaff(a: StaffMember, b: StaffMember) {
  const lifted = (m: StaffMember) =>
    needsSetup(m) || m.status === "invited" ? 0 : 1
  const byGroup = lifted(a) - lifted(b)
  if (byGroup !== 0) return byGroup
  const an = splitName(a.displayName)
  const bn = splitName(b.displayName)
  return (
    collator.compare(an.surname, bn.surname) ||
    collator.compare(an.first, bn.first) ||
    a.id.localeCompare(b.id)
  )
}

export function sortStaff<T extends StaffMember>(staff: T[]): T[] {
  return [...staff].sort(compareStaff)
}
