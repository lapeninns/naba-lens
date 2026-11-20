"use client"

import { useSyncExternalStore } from "react"

import { imageCaptureTime } from "@/lib/media/capture-time"

import { deleteBlob, saveBlob } from "./blobs"
import { folderById } from "./catalogue"
import { SAMPLES, type SampleKey } from "./samples"

/*
 * The prototype's whole world, kept in this browser so a refresh proves what
 * was saved. Two records, on purpose:
 *
 *  - PHONE: what this phone knows (photos, their upload state, labels).
 *    Written to localStorage before any screen says "saved".
 *  - SERVER: a stand-in for what the venue's album has received. A photo is
 *    put there by its own id, so sending it twice still leaves one copy.
 *
 * Photo files picked from the gallery are kept in IndexedDB (blobs.ts) and
 * are written there before the photo is listed as "Saved on this phone".
 * Nothing leaves the browser.
 */

const PHONE_KEY = "nl-photo-flow:phone:v1"
const SERVER_KEY = "nl-photo-flow:server:v1"

export type UploadState = "local" | "uploading" | "uploaded" | "failed"

export type PhotoLabel = { type: "folder"; folderId: string }

export type Photo = {
  /** Made on the phone; also the key the server stores the photo under. */
  id: string
  batchId: string
  fileName: string
  source: { kind: "sample"; key: SampleKey } | { kind: "file" }
  /** From the file's own data only. Null shows as "Unknown". */
  takenAt: string | null
  addedAt: string
  upload: UploadState
  attempts: number
  label: PhotoLabel | null
  /** The save that last set the label, so a folder can mark "Just added". */
  labelRun: string | null
}

export type Batch = { id: string; addedAt: string; count: number }

/** The last label save, kept so it can be shown again and undone. */
export type LabelRun = {
  id: string
  at: string
  label: PhotoLabel
  photoIds: string[]
  /** Each photo's label before this save, for Undo. */
  before: Record<string, PhotoLabel | null>
}

export type PhoneState = {
  photos: Photo[]
  batches: Batch[]
  lastRun: LabelRun | null
  /** Folder ids used most recently first, offered before any typing. */
  recent: string[]
  /** Demo setup: one photo of each new batch fails on its first try. */
  weakSignal: boolean
}

type ServerState = {
  /** Photo id → how many times it was received. One entry per photo. */
  received: Record<string, number>
  labels: Record<string, PhotoLabel>
}

const EMPTY: PhoneState = {
  photos: [],
  batches: [],
  lastRun: null,
  recent: [],
  weakSignal: false,
}

/* --------------------------------------------------------------- storage */

let state: PhoneState | null = null
const listeners = new Set<() => void>()
/** Upload progress, 0 to 1. Not saved: a refresh starts the transfer again. */
const progress = new Map<string, number>()
let progressVersion = 0

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback
  } catch {
    return fallback
  }
}

function load(): PhoneState {
  const loaded = read(PHONE_KEY, EMPTY)
  // A transfer cut off by a refresh never finished: the file is still safe
  // on the phone, so say exactly that and send it again.
  const photos = loaded.photos.map((photo): Photo => ({
    ...photo,
    upload: photo.upload === "uploading" ? "local" : photo.upload,
    label: photo.label?.type === "folder" ? photo.label : null,
  }))
  // Older previews let staff hand the label to a manager. Those photos
  // now sit in Unlabelled and their old hand-off is not undoable.
  const lastRun =
    loaded.lastRun?.label.type === "folder"
      ? {
          ...loaded.lastRun,
          before: Object.fromEntries(
            Object.entries(loaded.lastRun.before).map(([id, label]) => [
              id,
              label?.type === "folder" ? label : null,
            ])
          ),
        }
      : null
  return { ...loaded, photos, lastRun }
}

function current(): PhoneState {
  if (state === null) {
    state = load()
    window.localStorage.setItem(PHONE_KEY, JSON.stringify(state))
  }
  return state
}

function commit(next: PhoneState) {
  state = next
  window.localStorage.setItem(PHONE_KEY, JSON.stringify(next))
  listeners.forEach((listener) => listener())
}

function patchPhoto(id: string, patch: Partial<Photo>) {
  const now = current()
  commit({
    ...now,
    photos: now.photos.map((p) => (p.id === id ? { ...p, ...patch } : p)),
  })
}

function server(): ServerState {
  return read<ServerState>(SERVER_KEY, { received: {}, labels: {} })
}

function writeServer(next: ServerState) {
  window.localStorage.setItem(SERVER_KEY, JSON.stringify(next))
}

/** What the stand-in server holds. Read by the checks, never by a screen. */
export function serverSnapshot(): ServerState {
  return server()
}

function syncLabel(photo: Photo) {
  if (photo.upload !== "uploaded") return
  const now = server()
  const labels = { ...now.labels }
  if (photo.label) labels[photo.id] = photo.label
  else delete labels[photo.id]
  writeServer({ ...now, labels })
}

/* ---------------------------------------------------------------- reading */

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== PHONE_KEY) return
    state = null
    listener()
  }
  window.addEventListener("storage", onStorage)
  ensureUploader()
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

/** The phone's state, or null on the server and before the first read. */
export function usePhone(): PhoneState | null {
  return useSyncExternalStore(subscribe, current, () => null)
}

/** 0 to 1 while a photo is uploading. */
export function useProgress(id: string): number {
  useSyncExternalStore(
    subscribe,
    () => progressVersion,
    () => 0
  )
  return progress.get(id) ?? 0
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    (listener) => {
      window.addEventListener("online", listener)
      window.addEventListener("offline", listener)
      return () => {
        window.removeEventListener("online", listener)
        window.removeEventListener("offline", listener)
      }
    },
    () => navigator.onLine,
    () => true
  )
}

/* -------------------------------------------------------------- uploading */

/** Long enough to read "Uploading", short enough for a demo. */
const UPLOAD_MS = 1100
const TICK_MS = 110

let uploaderStarted = false
let busy = false

function ensureUploader() {
  if (uploaderStarted) return
  uploaderStarted = true
  window.addEventListener("online", pump)
  pump()
}

function pump() {
  if (busy || !navigator.onLine) return
  const next = current().photos.find((photo) => photo.upload === "local")
  if (!next) return
  busy = true
  patchPhoto(next.id, { upload: "uploading" })
  const started = Date.now()
  const timer = window.setInterval(() => {
    const done = Math.min(1, (Date.now() - started) / UPLOAD_MS)
    progress.set(next.id, done)
    progressVersion += 1
    listeners.forEach((listener) => listener())
    if (!navigator.onLine) return finish("local")
    if (done >= 1) finish(shouldFail(next) ? "failed" : "uploaded")
  }, TICK_MS)

  function finish(result: UploadState) {
    window.clearInterval(timer)
    progress.delete(next!.id)
    const photo = current().photos.find((p) => p.id === next!.id)
    if (photo) {
      if (result === "uploaded") {
        const now = server()
        writeServer({
          ...now,
          received: {
            ...now.received,
            [photo.id]: (now.received[photo.id] ?? 0) + 1,
          },
        })
      }
      patchPhoto(photo.id, {
        upload: result,
        attempts: photo.attempts + (result === "local" ? 0 : 1),
      })
      const after = current().photos.find((p) => p.id === photo.id)
      if (after) syncLabel(after)
    }
    busy = false
    pump()
  }
}

/** Weak signal: the second photo of a batch fails once, then goes through. */
function shouldFail(photo: Photo): boolean {
  if (!current().weakSignal || photo.attempts > 0) return false
  const batch = current().photos.filter((p) => p.batchId === photo.batchId)
  return batch.length > 1 && batch[1]?.id === photo.id
}

export function retryUpload(id: string) {
  const photo = current().photos.find((p) => p.id === id)
  if (!photo || photo.upload !== "failed") return
  patchPhoto(id, { upload: "local" })
  pump()
}

/* ----------------------------------------------------------------- adding */

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

async function takenAtOf(file: File): Promise<string | null> {
  try {
    // The date tags sit near the start of the file; never read past 512 KB.
    const head = new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer())
    return imageCaptureTime(head)?.toISOString() ?? null
  } catch {
    return null
  }
}

export type AddResult = {
  batchId: string
  kept: number
  /** Files that are not photos. */
  notPhotos: string[]
  /** Photos this phone could not store, so they were not added at all. */
  notKept: string[]
}

const PHOTO_FILE = /\.(jpe?g|png|webp|heic|heif|avif|gif)$/i

/** Some phones give a HEIC photo no type at all, so the name counts too. */
function isPhoto(file: File): boolean {
  return file.type.startsWith("image/") || PHOTO_FILE.test(file.name)
}

/**
 * Keep the chosen files on the phone, then list them. A file is listed only
 * after its bytes are stored, so "Saved on this phone" is true on refresh.
 */
export async function addFiles(files: File[]): Promise<AddResult> {
  const batchId = newId("b")
  const addedAt = new Date().toISOString()
  const photos: Photo[] = []
  const notPhotos: string[] = []
  const notKept: string[] = []
  for (const file of files) {
    if (!isPhoto(file)) {
      notPhotos.push(file.name)
      continue
    }
    const id = newId("p")
    try {
      await saveBlob(id, file)
    } catch {
      notKept.push(file.name)
      continue
    }
    photos.push({
      id,
      batchId,
      fileName: file.name,
      source: { kind: "file" },
      takenAt: await takenAtOf(file),
      addedAt,
      upload: "local",
      attempts: 0,
      label: null,
      labelRun: null,
    })
  }
  if (photos.length > 0) {
    const now = current()
    commit({
      ...now,
      photos: [...photos, ...now.photos],
      batches: [{ id: batchId, addedAt, count: photos.length }, ...now.batches],
    })
    pump()
  }
  return { batchId, kept: photos.length, notPhotos, notKept }
}

/* -------------------------------------------------------------- labelling */

export function saveLabel(photoIds: string[], label: PhotoLabel): LabelRun {
  const now = current()
  const ids = new Set(photoIds)
  const run: LabelRun = {
    id: newId("run"),
    at: new Date().toISOString(),
    label,
    photoIds: [],
    before: {},
  }
  const photos = now.photos.map((photo) => {
    if (!ids.has(photo.id)) return photo
    run.photoIds.push(photo.id)
    run.before[photo.id] = photo.label
    return { ...photo, label, labelRun: run.id }
  })
  const recent = [
    label.folderId,
    ...now.recent.filter((id) => id !== label.folderId),
  ]
  commit({ ...now, photos, lastRun: run, recent: recent.slice(0, 5) })
  photos.filter((photo) => ids.has(photo.id)).forEach(syncLabel)
  return run
}

/** Put back whatever each photo had before the last save. */
export function undoLastRun() {
  const now = current()
  const run = now.lastRun
  if (!run) return
  const photos = now.photos.map((photo) =>
    run.photoIds.includes(photo.id) && photo.labelRun === run.id
      ? { ...photo, label: run.before[photo.id] ?? null, labelRun: null }
      : photo
  )
  commit({ ...now, photos, lastRun: null })
  photos.filter((photo) => run.photoIds.includes(photo.id)).forEach(syncLabel)
}

export function dismissLastRun() {
  const now = current()
  if (now.lastRun) commit({ ...now, lastRun: null })
}

/* ------------------------------------------------------------------- demo */

export function setWeakSignal(weakSignal: boolean) {
  commit({ ...current(), weakSignal })
}

export function resetAll() {
  const weakSignal = current().weakSignal
  for (const photo of current().photos) {
    if (photo.source.kind === "file") void deleteBlob(photo.id)
  }
  writeServer({ received: {}, labels: {} })
  commit({ ...EMPTY, weakSignal })
}

export const DEMO_BATCH = "b-demo"

/**
 * The ready-to-try state: a mixed batch of eight was added a moment ago.
 * Seven posted and one didn't upload. Earlier photos include labelled and
 * unlabelled posts.
 */
export function seedDemo() {
  resetAll()
  const now = Date.now()
  const minutes = (n: number) => new Date(now - n * 60_000).toISOString()
  const days = (n: number, hour: number) => {
    const date = new Date(now - n * 86_400_000)
    date.setHours(hour, 12, 0, 0)
    return date.toISOString()
  }
  const make = (
    key: SampleKey,
    batchId: string,
    addedAt: string,
    takenAt: string | null,
    extra: Partial<Photo> = {}
  ): Photo => ({
    id: `p-${key}`,
    batchId,
    fileName: SAMPLES[key].file,
    source: { kind: "sample", key },
    takenAt,
    addedAt,
    upload: "uploaded",
    attempts: 1,
    label: null,
    labelRun: null,
    ...extra,
  })
  const added = minutes(1)
  const fresh: Photo[] = [
    make("momo-overhead", DEMO_BATCH, added, minutes(34)),
    make("momo-angle", DEMO_BATCH, added, minutes(33)),
    make("momo-close", DEMO_BATCH, added, minutes(33)),
    make("curry-angle", DEMO_BATCH, added, minutes(21)),
    make("curry-side", DEMO_BATCH, added, minutes(20)),
    // Saved from a message, so the file carries no date.
    make("guinness", DEMO_BATCH, added, null),
    make("bar-lounge", DEMO_BATCH, added, minutes(9)),
    make("hot-wings", DEMO_BATCH, added, minutes(6), { upload: "failed" }),
  ]
  const older: Photo[] = [
    make("beer-garden", "b-earlier-2", days(1, 16), days(1, 15)),
    make("himali-lamb", "b-earlier-1", days(2, 19), days(2, 19), {
      label: { type: "folder", folderId: "menu/chef-selection/himali-lamb" },
    }),
    make("chicken-bhuna", "b-earlier-1", days(2, 19), null),
    make("dining-room", "b-earlier-0", days(9, 11), days(9, 11), {
      label: { type: "folder", folderId: "spaces/inside/restaurant" },
    }),
  ]
  const photos = [...fresh, ...older]
  const received: Record<string, number> = {}
  const labels: Record<string, PhotoLabel> = {}
  for (const photo of photos) {
    if (photo.upload !== "uploaded") continue
    received[photo.id] = 1
    if (photo.label) labels[photo.id] = photo.label
  }
  writeServer({ received, labels })
  commit({
    ...current(),
    photos,
    batches: [
      { id: DEMO_BATCH, addedAt: added, count: fresh.length },
      { id: "b-earlier-2", addedAt: days(1, 16), count: 1 },
      { id: "b-earlier-1", addedAt: days(2, 19), count: 2 },
      { id: "b-earlier-0", addedAt: days(9, 11), count: 1 },
    ],
    lastRun: null,
    recent: [],
  })
}

/* ------------------------------------------------------------- derivations */

export type Stage = "failed" | "local" | "uploading" | "posted"

/** One word for where a photo is. Upload trouble always comes first. */
export function stageOf(photo: Photo): Stage {
  if (photo.upload === "failed") return "failed"
  if (photo.upload === "local") return "local"
  if (photo.upload === "uploading") return "uploading"
  return "posted"
}

export function folderOf(photo: Photo) {
  return photo.label?.type === "folder"
    ? folderById(photo.label.folderId)
    : null
}

export function photosIn(state: PhoneState, folderId: string): Photo[] {
  return state.photos.filter(
    (photo) => photo.upload === "uploaded" && photo.label?.folderId === folderId
  )
}

export function unlabelled(state: PhoneState): Photo[] {
  return state.photos.filter((photo) => photo.label === null)
}

export function failed(state: PhoneState): Photo[] {
  return state.photos.filter((photo) => photo.upload === "failed")
}
