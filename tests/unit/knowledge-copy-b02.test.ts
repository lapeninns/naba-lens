// B02-06 copy: years on short dates (CA-29), instants compared as instants
// (HM-24), upload-wait words that count and name what is saving (CA-11,
// CA-12, CA-26), slow sends (CA-24) and the stale decision (MG-07).
import { describe, expect, it } from "vitest"

import {
  isAfter,
  KNOWLEDGE_FAILURE_COPY,
  SEND_PROGRESS_COPY,
  SLOW_SEND_MS,
  sentNoticeFor,
  shortDate,
  UPLOAD_WAIT_COPY,
  uploadNoun,
} from "@/components/nabalens/knowledge/copy"
import type {
  AnswerInUse,
  FindingSummary,
} from "@/lib/knowledge-client/contract"

const NOW = new Date("2026-11-10T12:00:00.000Z")

describe("shortDate (CA-29)", () => {
  it("leaves the year out in this London year", () => {
    expect(shortDate("2026-11-03T10:00:00.000Z", NOW)).toBe("3 Nov")
  })

  it("adds the year when it isn't this London year", () => {
    expect(shortDate("2025-11-03T10:00:00.000Z", NOW)).toBe("3 Nov 2025")
  })

  it("takes the year in London, not UTC", () => {
    // 23:30 UTC on 31 Dec is 31 Dec in London (GMT); now is already 2026.
    expect(
      shortDate("2025-12-31T23:30:00.000Z", new Date("2026-01-01T00:30:00Z"))
    ).toBe("31 Dec 2025")
    // British Summer Time: 23:30 UTC on 30 Jun is 1 Jul in London.
    expect(shortDate("2026-06-30T23:30:00.000Z", NOW)).toBe("1 Jul")
  })
})

describe("instants compared as instants (HM-24)", () => {
  it("orders Z and +00:00 and different fraction lengths by time, not text", () => {
    // As text, "Z" sorts after "." and this would read the other way round.
    expect(isAfter("2026-11-06T09:00:00Z", "2026-11-06T09:00:00.5+00:00")).toBe(
      false
    )
    expect(isAfter("2026-11-06T09:00:00.5+00:00", "2026-11-06T09:00:00Z")).toBe(
      true
    )
    expect(
      isAfter("2026-11-06T09:00:00.25Z", "2026-11-06T09:00:00.123456+00:00")
    ).toBe(true)
  })

  it("Home's notice follows a send that is later than the draft", () => {
    const none: AnswerInUse = {
      status: "unavailable",
      reason: "unknown",
      detail: "not_checked",
      value: null,
      savedAt: null,
      sentAt: null,
      confirmation: { state: "not_required", self: false, at: null, by: null },
    }
    const latest = {
      answer: "yes",
      kind: "finding",
      state: "current",
      sentAt: "2026-11-06T09:00:00.5+00:00",
      savedAt: null,
      recognition: { kind: "none" },
    } as unknown as FindingSummary
    const notice = sentNoticeFor({
      myLatest: latest,
      myDraft: { savedAt: "2026-11-06T09:00:00Z" },
      answerInUse: none,
    })
    expect(notice?.title).toBe("Finding sent")
  })
})

describe("upload-wait words (CA-11, CA-12, CA-26)", () => {
  it("names photos, videos, or both", () => {
    expect(uploadNoun(1, "photo")).toBe("photo")
    expect(uploadNoun(2, "video")).toBe("videos")
    expect(uploadNoun(1, "mixed")).toBe("photo or video")
    expect(uploadNoun(3, "mixed")).toBe("photos and videos")
  })

  it("counts what is saving and says to keep this page open", () => {
    expect(UPLOAD_WAIT_COPY.pending(2, "video")).toBe(
      "Your 2 videos are still saving. Wait for them, or send without them."
    )
    expect(UPLOAD_WAIT_COPY.primary(1, "mixed")).toBe(
      "Waiting for 1 photo or video…"
    )
    expect(UPLOAD_WAIT_COPY.waiting(2, "photo")).toBe(
      "Waiting for your 2 photos to finish saving. It sends by itself when ready; keep this page open."
    )
    expect(UPLOAD_WAIT_COPY.offline(1, "video")).toBe(
      "You're offline. Keep this page open: your video finishes saving when you're back online; then you can send."
    )
    expect(UPLOAD_WAIT_COPY.offline(2, "photo")).toContain(
      "your 2 photos finish saving"
    )
  })

  it("never says processing failed for an upload that was stopped, and is plural-aware", () => {
    expect(UPLOAD_WAIT_COPY.failed(1, "photo")).toBe(
      "Your photo didn't finish saving. Add it again or choose another."
    )
    expect(UPLOAD_WAIT_COPY.failed(2, "mixed")).toBe(
      "Your 2 photos and videos didn't finish saving. Add them again or choose others."
    )
    expect(UPLOAD_WAIT_COPY.failed(1)).not.toMatch(/processed/)
  })
})

describe("slow and unsure sends (CA-05, CA-24)", () => {
  it("uses the design's words and 15 seconds", () => {
    expect(SEND_PROGRESS_COPY.sending).toBe("Sending…")
    expect(SEND_PROGRESS_COPY.slow).toBe("Still sending; keep this page open.")
    expect(SEND_PROGRESS_COPY.lastSendUnsure).toBe(
      "Your last send may not have arrived. Send again; nothing is sent twice."
    )
    expect(SLOW_SEND_MS).toBe(15_000)
  })
})

describe("a stale decision (MG-07)", () => {
  it("never claims nothing was decided", () => {
    expect(KNOWLEDGE_FAILURE_COPY.decision.stale).toBe(
      "This check changed. The page now shows the latest; check whether your decision is there."
    )
  })
})
