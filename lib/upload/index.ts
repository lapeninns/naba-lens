// Browser upload transport. Client-only: import from "use client" modules.
export { guardBeforeUnload } from "./before-unload"
export { FinaliseRefusedError, ReservationGoneError } from "./errors"
export {
  DEFAULT_IMAGE_TYPES,
  DEFAULT_VIDEO_TYPES,
  guessContentType,
  guessMediaKind,
  preflight,
} from "./preflight"
export { QueueUploadError, toQueueUploader } from "./queue-adapter"
export type { QueueResumeToken, QueueUploaderOptions } from "./queue-adapter"
export type { XhrLike } from "./signed-put"
export { SUPABASE_TUS_CHUNK_SIZE, tusFingerprint } from "./tus"
export type { TusAdapters } from "./tus"
export {
  createUploader,
  DEFAULT_RESUMABLE_THRESHOLD,
  DEFAULT_RETRY_DELAYS,
} from "./uploader"
export type { CreateUploaderOptions, MediaUploader } from "./uploader"
export {
  fileIdentity,
  localUploadKeyStore,
  UPLOAD_KEYS_STORAGE_KEY,
} from "./upload-keys"
export type {
  LocalUploadKeyStoreOptions,
  UploadKeyScope,
  UploadKeyStore,
} from "./upload-keys"
export {
  detectCaptureCapabilities,
  type CaptureCapabilities,
  type ProbeEnvironment,
} from "./capabilities"
export {
  accountHash,
  indexedDbJournalBackend,
  JOURNAL_ACCOUNT_STORAGE_KEY,
  JOURNAL_DB_NAME,
  JOURNAL_LIMITS,
  memoryJournalBackend,
  openCaptureJournal,
  resumeAction,
} from "./journal"
export type {
  CaptureJournal,
  CaptureJournalOptions,
  JournalBackend,
  JournalEntry,
  JournalState,
  JournalSubject,
  PickInput,
  ResumeAction,
} from "./journal"
export {
  claimCaptureDataForAccount,
  clearCaptureDataOnDevice,
} from "./device-cleanup"
export {
  annotateCapture,
  captureEntryId,
  createCaptureSessions,
  forgetCapture,
  getCaptureJournal,
} from "./capture-session"
export type {
  CaptureAnnotation,
  CaptureSession,
  CaptureSessionDeps,
} from "./capture-session"
export type * from "./types"
