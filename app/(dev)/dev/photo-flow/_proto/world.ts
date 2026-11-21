"use client"

import { useSyncExternalStore } from "react"

import { folderById } from "./catalogue"
import type { SampleKey } from "./samples"
import type { PhoneState, Photo } from "./store"

/*
 * Everything in the staff app that is not a photo file: who is signed in,
 * what a manager said about a photo, what a manager asked for, the venue's
 * questions, and which notices have been read. Sample data for one venue,
 * kept in this browser like the photos (store.ts). Under D20 a photo is
 * posted as soon as it uploads; a manager's word comes afterwards.
 */

const KEY = "nl-photo-flow:world:v1"

export const VENUES = [
  { name: "The Old Crown, Girton", role: "Staff" },
  { name: "The Prince of Wales, Bromham", role: "Staff" },
] as const

export const MANAGER = "Maya (manager, sample)"

export type FeedbackKind = "feedback" | "retake" | "label" | "remove"

/** What a manager said about one posted photo. */
export type Feedback = {
  id: string
  photoId: string
  kind: FeedbackKind
  note: string
  at: string
}

/** A dish, drink or space a manager asked the team to photograph. */
export type Ask = {
  id: string
  folderId: string
  brief: string
  neededBy: string | null
  at: string
}

export type AnswerValue = "yes" | "no" | "na" | "unknown"

export const ANSWER_WORDS: Record<AnswerValue, string> = {
  yes: "Yes",
  no: "No",
  na: "Doesn’t apply here",
  unknown: "I couldn’t find out",
}

export type Answer = {
  value: AnswerValue
  found: string
  photoIds: string[]
  at: string
}

/** A fact about the venue that someone on site has to check. */
export type Question = {
  id: string
  group: string
  text: string
  brief: string
  /** A Yes needs a photo to back it up. */
  needsPhoto: boolean
  /** Given to this person by a manager. */
  forYou: boolean
  /** Started and saved on this phone, not sent. */
  draft: { value: AnswerValue | null; found: string } | null
  answer: Answer | null
  /** Who answered, when it was not this person. */
  answeredBy: string | null
}

export type Report = {
  id: string
  folderId: string
  reason: string
  at: string
}

export type World = {
  signedIn: boolean
  email: string
  welcomed: boolean
  name: string
  job: string
  venue: number
  /** Set by a venue change, so Today can say it happened. */
  switched: boolean
  feedback: Feedback[]
  asks: Ask[]
  questions: Question[]
  reports: Report[]
  /** Notice ids the person has opened. */
  read: string[]
  monthTarget: number | null
  tell: { retakes: boolean; questions: boolean; failed: boolean }
}

export const JOBS = [
  "Kitchen",
  "Bar",
  "Front of house",
  "A bit of everything",
] as const

function ago(days: number, hour = 12): string {
  const date = new Date(Date.now() - days * 86_400_000)
  date.setHours(hour, 20, 0, 0)
  return date.toISOString()
}

function fresh(): World {
  return {
    signedIn: true,
    email: "sam@example.test",
    welcomed: true,
    name: "Sam (sample account)",
    job: "Kitchen",
    venue: 0,
    switched: false,
    feedback: [
      {
        id: "f-lamb",
        photoId: "p-himali-lamb",
        kind: "retake",
        note: "The bowl is cut off at the edge. Show the whole dish, from a little higher.",
        at: ago(1, 10),
      },
      {
        id: "f-dining",
        photoId: "p-dining-room",
        kind: "feedback",
        note: "Lovely light in this one. Thank you.",
        at: ago(8, 15),
      },
    ],
    asks: [
      {
        id: "a-naan",
        folderId: "menu/naans/garlic-naan",
        brief: "On the board, side-on, straight after it comes out.",
        neededBy: ago(-5),
        at: ago(2, 9),
      },
      {
        id: "a-carpark",
        folderId: "spaces/outside/car-park",
        brief: "From the entrance, in daylight, with the sign in view.",
        neededBy: null,
        at: ago(3, 9),
      },
    ],
    questions: [
      {
        id: "q-step-free",
        group: "Getting in",
        text: "Can guests get into the restaurant without using steps?",
        brief: "Walk it from the car park to a table. Photograph the way in.",
        needsPhoto: true,
        forYou: true,
        draft: null,
        answer: null,
        answeredBy: null,
      },
      {
        id: "q-baby-change",
        group: "Facilities",
        text: "Is there a baby-changing table?",
        brief: "Say which toilets it is in. Photograph the table.",
        needsPhoto: true,
        forYou: true,
        draft: { value: "yes", found: "" },
        answer: null,
        answeredBy: null,
      },
      {
        id: "q-wifi",
        group: "Facilities",
        text: "Is there free Wi-Fi for guests?",
        brief: "Never photograph the password or the join code.",
        needsPhoto: false,
        forYou: false,
        draft: null,
        answer: null,
        answeredBy: null,
      },
      {
        id: "q-dogs",
        group: "Policies",
        text: "Are dogs welcome in the bar?",
        brief: "Check with whoever is running the shift.",
        needsPhoto: false,
        forYou: false,
        draft: null,
        answer: {
          value: "yes",
          found: "In the bar and the garden, on a lead. Not in the restaurant.",
          photoIds: [],
          at: ago(12),
        },
        answeredBy: "Tom (bar, sample)",
      },
    ],
    reports: [],
    read: ["n-f-dining"],
    monthTarget: 10,
    tell: { retakes: true, questions: true, failed: true },
  }
}

/* ---------------------------------------------------------------- storage */

let world: World | null = null
const listeners = new Set<() => void>()

function current(): World {
  if (world === null) {
    try {
      const raw = window.localStorage.getItem(KEY)
      world = raw ? { ...fresh(), ...(JSON.parse(raw) as World) } : fresh()
    } catch {
      world = fresh()
    }
  }
  return world
}

function commit(next: World) {
  world = next
  window.localStorage.setItem(KEY, JSON.stringify(next))
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useWorld(): World | null {
  return useSyncExternalStore(subscribe, current, () => null)
}

export function setWorld(patch: Partial<World>) {
  commit({ ...current(), ...patch })
}

/** Back to the sample world. `signedOut` starts at the sign-in screen. */
export function resetWorld(signedOut = false) {
  commit(
    signedOut
      ? {
          ...fresh(),
          signedIn: false,
          welcomed: false,
          email: "",
          name: "",
          job: "",
        }
      : fresh()
  )
}

export function venueName(w: World): string {
  return VENUES[w.venue]?.name ?? VENUES[0].name
}

/** The prototype only carries one venue's album and questions. */
export function hasAlbum(w: World): boolean {
  return w.venue === 0
}

/* ------------------------------------------------------- manager's word */

const KIND_TITLE: Record<FeedbackKind, string> = {
  feedback: "Feedback from your manager",
  retake: "Another photo requested",
  label: "Label corrected",
  remove: "Removed from Album",
}

export function feedbackTitle(kind: FeedbackKind): string {
  return KIND_TITLE[kind]
}

export function feedbackFor(w: World, photoId: string): Feedback[] {
  return w.feedback.filter((item) => item.photoId === photoId)
}

export function isRemoved(w: World, photoId: string): boolean {
  return w.feedback.some((f) => f.photoId === photoId && f.kind === "remove")
}

export type OpenRetake = { feedback: Feedback; photo: Photo; folderId: string }

/**
 * Requests for another photo that are still open: the photo has a folder,
 * and the person has not posted a newer photo to that folder since.
 */
export function openRetakes(w: World, phone: PhoneState): OpenRetake[] {
  const out: OpenRetake[] = []
  for (const feedback of w.feedback) {
    if (feedback.kind !== "retake") continue
    const photo = phone.photos.find((p) => p.id === feedback.photoId)
    const folderId = photo?.label?.folderId
    if (!photo || !folderId) continue
    const answered = phone.photos.some(
      (p) =>
        p.id !== photo.id &&
        p.upload === "uploaded" &&
        p.label?.folderId === folderId &&
        p.addedAt > feedback.at
    )
    if (!answered) out.push({ feedback, photo, folderId })
  }
  return out
}

/** Asked-for folders this person has not posted to since being asked. */
export function openAsks(w: World, phone: PhoneState): Ask[] {
  return w.asks.filter(
    (ask) =>
      !phone.photos.some(
        (p) =>
          p.upload === "uploaded" &&
          p.label?.folderId === ask.folderId &&
          p.addedAt > ask.at
      )
  )
}

export function askFor(w: World, folderId: string): Ask | null {
  return w.asks.find((ask) => ask.folderId === folderId) ?? null
}

/* ----------------------------------------------------------------- notices */

export type NoticeItem = {
  id: string
  title: string
  detail: string
  at: string
  href: string
  unread: boolean
}

export function notices(
  w: World,
  phone: PhoneState,
  base: string
): NoticeItem[] {
  const items: Omit<NoticeItem, "unread">[] = []
  for (const f of w.feedback) {
    const photo = phone.photos.find((p) => p.id === f.photoId)
    if (!photo) continue
    const folder = folderById(photo.label?.folderId)
    items.push({
      id: `n-${f.id}`,
      title: `${KIND_TITLE[f.kind]}${folder ? `: ${folder.name}` : ""}`,
      detail: f.note,
      at: f.at,
      href:
        f.kind === "retake" && folder
          ? `${base}/album/${folder.id}`
          : `${base}/photo/${photo.id}`,
    })
  }
  for (const ask of w.asks) {
    const folder = folderById(ask.folderId)
    if (!folder) continue
    items.push({
      id: `n-${ask.id}`,
      title: `Asked for: ${folder.name}`,
      detail: ask.brief,
      at: ask.at,
      href: `${base}/album/${folder.id}`,
    })
  }
  for (const q of w.questions) {
    if (!q.forYou) continue
    items.push({
      id: `n-${q.id}`,
      title: "A venue question for you",
      detail: q.text,
      at: ago(2, 8),
      href: `${base}/question/${q.id}`,
    })
  }
  return items
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .map((item) => ({ ...item, unread: !w.read.includes(item.id) }))
}

export function markRead(ids: string[]) {
  const w = current()
  const read = [...new Set([...w.read, ...ids])]
  if (read.length !== w.read.length) commit({ ...w, read })
}

/* --------------------------------------------------------------- questions */

export function questionsToDo(w: World): Question[] {
  return w.questions.filter((q) => !q.answer)
}

export function saveDraft(
  id: string,
  draft: { value: AnswerValue | null; found: string }
) {
  const w = current()
  commit({
    ...w,
    questions: w.questions.map((q) => (q.id === id ? { ...q, draft } : q)),
  })
}

export function sendAnswer(id: string, answer: Omit<Answer, "at">) {
  const w = current()
  commit({
    ...w,
    questions: w.questions.map((q) =>
      q.id === id
        ? {
            ...q,
            draft: null,
            answeredBy: null,
            answer: { ...answer, at: new Date().toISOString() },
          }
        : q
    ),
  })
}

/* ----------------------------------------------------------------- reports */

export function sendReport(folderId: string, reason: string) {
  const w = current()
  commit({
    ...w,
    reports: [
      ...w.reports,
      {
        id: `r-${w.reports.length + 1}`,
        folderId,
        reason,
        at: new Date().toISOString(),
      },
    ],
  })
}

export function reportFor(w: World, folderId: string): Report | null {
  return w.reports.find((r) => r.folderId === folderId) ?? null
}

/* -------------------------------------------------------------- colleagues */

export type Colleague = { id: string; name: string; job: string }

/** Sample people, A to Z. Never ordered by how much they post. */
export const COLLEAGUES: Colleague[] = [
  { id: "c-maya", name: "Maya (manager, sample)", job: "Manager" },
  { id: "c-priya", name: "Priya (kitchen, sample)", job: "Kitchen" },
  { id: "c-tom", name: "Tom (bar, sample)", job: "Bar" },
]

export type ColleaguePost = Photo & { by: string }

function post(
  key: SampleKey,
  by: string,
  folderId: string,
  days: number
): ColleaguePost {
  return {
    id: `c-${key}`,
    batchId: "colleagues",
    fileName: `${key}.jpg`,
    source: { kind: "sample", key },
    takenAt: ago(days),
    addedAt: ago(days),
    upload: "uploaded",
    attempts: 1,
    label: { type: "folder", folderId },
    labelRun: null,
    by,
  }
}

/** Posts by colleagues at this venue, newest first. */
export const COLLEAGUE_POSTS: ColleaguePost[] = [
  post("chicken-curry", "c-priya", "menu/curries/chicken-curry", 1),
  post("patio", "c-tom", "spaces/outside/patio-terrace", 3),
  post("play-area", "c-tom", "spaces/outside/childrens-play-area", 4),
  post("front", "c-maya", "spaces/outside/front-of-the-pub", 6),
]

export function colleaguePostsIn(folderId: string): ColleaguePost[] {
  return COLLEAGUE_POSTS.filter((p) => p.label?.folderId === folderId)
}

export function colleagueName(id: string): string {
  return COLLEAGUES.find((person) => person.id === id)?.name ?? "A colleague"
}

/* ------------------------------------------------------------------- month */

export type Month = {
  label: string
  posted: number
  labelled: number
  retakes: number
  target: number | null
  toGo: number
}

/** This calendar month's own posts, with every number that makes the total. */
export function monthOf(w: World, phone: PhoneState): Month {
  const now = new Date()
  const mine = phone.photos.filter((p) => {
    const added = new Date(p.addedAt)
    return (
      p.upload === "uploaded" &&
      !isRemoved(w, p.id) &&
      added.getMonth() === now.getMonth() &&
      added.getFullYear() === now.getFullYear()
    )
  })
  return {
    label: new Intl.DateTimeFormat("en-GB", {
      month: "long",
      year: "numeric",
    }).format(now),
    posted: mine.length,
    labelled: mine.filter((p) => p.label).length,
    retakes: openRetakes(w, phone).length,
    target: w.monthTarget,
    toGo: w.monthTarget ? Math.max(0, w.monthTarget - mine.length) : 0,
  }
}
