/**
 * B10-05b role-based training (b10-design §7.3): one card per module and a
 * 15-minute in-shift walkthrough (OD-B10-7 default). Cards point at the
 * released guides and repeat in-app wording only through guidance line IDs
 * (components/nabalens/guide/screen-guidance.ts), so they add no new claim.
 *
 * Status: draft. The product owner reviews every card (§7.2 item 1); sessions
 * at a venue need staff contact authorised for that venue (X2) and are
 * recorded in its onboarding record (training.sessions).
 *
 * Out of scope (owner correction, 11 Nov 2026): anything about websites,
 * NabaPresence or other external destinations.
 */

import type { OwnerRole } from "./metrics"

export type GuideRef = {
  file: "docs/usage-staff.md" | "docs/usage-manager.md" | "docs/operations.md"
  /** A heading in that file, exactly. */
  heading: string
}

export type TrainingModule = {
  id: "T1" | "T2" | "T3" | "T4" | "T5" | "T6"
  title: string
  audience: string
  /** Who runs the session. */
  trainerRole: OwnerRole
  covers: readonly string[]
  guides: readonly GuideRef[]
  /** In-app guidance lines (G-xx) the card repeats. */
  guidanceIds: readonly string[]
  /** Titles from GUIDE_SUBJECT_TIPS the card repeats word for word. */
  photoTips: readonly string[]
  /** Operations docs the card points at (operators only). */
  operations: readonly string[]
  practicalTask: string
  /** What the module leaves out, and why. */
  notCovered: readonly string[]
}

const STAFF = "docs/usage-staff.md" as const
const MANAGER = "docs/usage-manager.md" as const

export const TRAINING_STATUS =
  "Draft for product-owner review (b10-design §7.2 item 1). Not delivered at any venue."

export const TRAINING_MODULES: readonly TrainingModule[] = [
  {
    id: "T1",
    title: "Everyone",
    audience: "All staff",
    trainerRole: "VM",
    covers: [
      "Signing in and leaving safely",
      "Home and To do",
      "Add",
      "What Saved for later means",
      "Couldn't establish",
      "My contributions on Me",
      "What happens after sending",
      "Capturing only when safe; no guests or private information in frame",
    ],
    guides: [
      { file: STAFF, heading: "Sign in and leave safely" },
      { file: STAFF, heading: "Home: monthly photos and venue tasks" },
      { file: STAFF, heading: "Add photos from any page" },
      {
        file: "docs/operations.md",
        heading: "Capture safely; publishing is a separate decision",
      },
    ],
    guidanceIds: ["G-01", "G-02", "G-03", "G-05"],
    photoTips: [],
    operations: [],
    practicalTask:
      "Send one finding on a question from the venue's working list (B10-03 knowledge.working_list).",
    notCovered: [
      "Monthly credit rules: explained from the staff guide on request, never restated on the card (no new credit claim).",
    ],
  },
  {
    id: "T2",
    title: "Kitchen",
    audience: "Kitchen staff (Back of house)",
    trainerRole: "VM",
    covers: [
      "Photographing a dish from Our menu",
      "Labels and variants",
      "Several photos of one dish",
      "Better photo requested",
      "The optional photo tips",
    ],
    guides: [
      { file: STAFF, heading: "Our menu" },
      { file: STAFF, heading: "Photo guide" },
      { file: STAFF, heading: "Add labels (optional)" },
      { file: STAFF, heading: "Review results and replacement photos" },
    ],
    guidanceIds: [],
    photoTips: ["Tandoor and grilled dishes", "Bread"],
    operations: [],
    practicalTask: "Photograph one dish and label it.",
    notCovered: [
      "Ingredients, allergens, sizes or availability: not part of photo capture and never claimed in training.",
    ],
  },
  {
    id: "T3",
    title: "Bar",
    audience: "Bar staff",
    trainerRole: "VM",
    covers: [
      "The Drinks photo tip (text only)",
      "Venue questions bar staff are asked",
    ],
    guides: [
      { file: STAFF, heading: "Our menu" },
      { file: STAFF, heading: "Amenity checks" },
    ],
    guidanceIds: ["G-01", "G-05"],
    photoTips: ["Drinks"],
    operations: [],
    practicalTask:
      "Answer one question the venue's selected set gives bar staff (B10-03 questions.selected_set; the product owner and venue manager choose it).",
    notCovered: [
      "Which questions are bar questions: a venue decision, not inferred here.",
    ],
  },
  {
    id: "T4",
    title: "Service",
    audience: "Front-of-house staff",
    trainerRole: "VM",
    covers: [
      "Arrival, entrance, toilets and Wi-Fi questions",
      "Covering the Wi-Fi password and join QR code before any photo",
      "Reporting a change to a current answer",
    ],
    guides: [
      { file: STAFF, heading: "Amenity checks" },
      { file: STAFF, heading: "Add photos from any page" },
    ],
    guidanceIds: ["G-05", "G-06"],
    photoTips: [],
    operations: [],
    practicalTask: "Report a change to one current answer.",
    notCovered: [],
  },
  {
    id: "T5",
    title: "Venue manager",
    audience: "Manager accounts and staff holding a manager grant",
    trainerRole: "PO",
    covers: [
      "To confirm and conflicting findings",
      "Self-confirmation, where the question allows it",
      "Rechecks",
      "Triage on the overview",
      "Menu photo review",
      "Assigning checks",
      "Manager uploads (owner decision 32)",
    ],
    guides: [
      { file: MANAGER, heading: "Overview" },
      { file: MANAGER, heading: "Review" },
      { file: MANAGER, heading: "Menu" },
      { file: MANAGER, heading: "Amenities" },
    ],
    guidanceIds: ["G-09", "G-10", "G-11"],
    photoTips: [],
    operations: [],
    practicalTask: "Decide one finding and one recheck.",
    notCovered: [
      "Self-review credit and manager targets: open owner questions (B02-03 Q2, Q3, Q5); not taught until decided.",
    ],
  },
  {
    id: "T6",
    title: "Operator",
    audience: "Admins and the operations owner",
    trainerRole: "OPS",
    covers: [
      "The onboarding record",
      "Enabling a working list (SW-01)",
      "The runbooks, starting with incident triage",
      "Credential rotation",
      "The switch catalogue",
    ],
    guides: [
      { file: "docs/operations.md", heading: "Incident: lost or stolen phone" },
    ],
    guidanceIds: [],
    photoTips: [],
    operations: [
      "docs/operations/onboarding-records.md",
      "docs/operations/runbooks/RB-17.md",
      "docs/operations/runbooks/RB-06.md",
      "docs/operations/runbooks/RB-07.md",
      "docs/operations/switches.md",
    ],
    practicalTask: "Walk RB-06 and RB-07 on the owned stack.",
    notCovered: [
      "The operations dashboard: not available until B10-01 S3 is built and released.",
    ],
  },
]

/** The 15-minute in-shift walkthrough (OD-B10-7 default), the same shape for every module. */
export const WALKTHROUGH_STEPS: readonly { minutes: number; step: string }[] = [
  {
    minutes: 2,
    step: "Before the session: confirm staff contact is authorised for this venue (X2), choose a quiet moment in the shift, and never use real guests or private information as examples.",
  },
  {
    minutes: 3,
    step: "Open the screens the card lists on the trainee's own phone, signed in as themselves. Show where Tips for this screen sits only if the switch is on; otherwise read the card's lines aloud.",
  },
  {
    minutes: 7,
    step: "The trainee does the card's practical task themselves. The trainer does not touch the phone. Note where they hesitate, without their name.",
  },
  {
    minutes: 2,
    step: "Answer questions from the guides the card links. If a question needs a policy, credit or review answer the guides don't give, say it will be answered by the product owner, and note it.",
  },
  {
    minutes: 1,
    step: "Record the session in the venue's onboarding record (training.sessions: module, date, role kind, no names) and each hesitation in the friction log with its classification (B10-05d).",
  },
]
