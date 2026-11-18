// S1-EXPORT (spec §14.1): the ZIP writer, readable filenames, the manifest
// and the output profiles. The database rules (access, eligibility,
// invalidation, Exported) are in tests/security/exports.test.ts.
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import sharp from "sharp"
import { describe, expect, it } from "vitest"

import {
  csvField,
  exportFilename,
  extensionFor,
  MANIFEST_COLUMNS,
  manifestCsv,
  parseCandidates,
  parsePackageDetail,
  parsePublication,
  PUBLICATION_STATES,
  PUBLICATION_WORDS,
  type ManifestRow,
} from "@/lib/server/exports/model"
import { renderExportFile } from "@/lib/server/exports/render"
import { crc32, ZipWriter } from "@/lib/server/exports/zip"

/** Reads a stored ZIP back from its central directory, checking each CRC. */
function readZip(bytes: Uint8Array) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = bytes.length - 22
  expect(v.getUint32(end, true)).toBe(0x06054b50)
  const count = v.getUint16(end + 10, true)
  let p = v.getUint32(end + 16, true)
  const out: { name: string; data: Uint8Array }[] = []
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50)
    const crc = v.getUint32(p + 16, true)
    const size = v.getUint32(p + 20, true)
    const nameLen = v.getUint16(p + 28, true)
    const offset = v.getUint32(p + 42, true)
    const name = new TextDecoder().decode(
      bytes.subarray(p + 46, p + 46 + nameLen)
    )
    const localNameLen = v.getUint16(offset + 26, true)
    const start = offset + 30 + localNameLen
    const data = bytes.subarray(start, start + size)
    expect(crc32(data)).toBe(crc)
    out.push({ name, data })
    p += 46 + nameLen
  }
  return out
}

const concat = (chunks: Uint8Array[]) => {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

describe("ZipWriter", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926)
  })

  it("writes stored entries that read back byte for byte", () => {
    const zip = new ZipWriter(new Date("2026-11-18T10:20:30Z"))
    const a = new TextEncoder().encode("hello")
    const b = new Uint8Array(70_000).map((_, i) => i % 251)
    const chunks = [
      ...zip.add("white-horse-korma-1a2b3c4d.webp", a),
      ...zip.add("manifest.json", b),
      zip.finish(),
    ]
    const files = readZip(concat(chunks))
    expect(files.map((f) => f.name)).toEqual([
      "white-horse-korma-1a2b3c4d.webp",
      "manifest.json",
    ])
    expect(Array.from(files[0]!.data)).toEqual(Array.from(a))
    expect(files[1]!.data).toEqual(b)
  })

  it("is read by the system unzip when it is available", () => {
    const zip = new ZipWriter()
    const bytes = concat([
      ...zip.add("a.txt", new TextEncoder().encode("one")),
      ...zip.add("b.txt", new TextEncoder().encode("two")),
      zip.finish(),
    ])
    const dir = mkdtempSync(join(tmpdir(), "export-zip-"))
    const file = join(dir, "t.zip")
    writeFileSync(file, bytes)
    let listing: string
    try {
      listing = execFileSync("unzip", ["-t", file], { encoding: "utf8" })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return
      throw e
    }
    expect(listing).toMatch(/No errors detected/)
  })

  it("refuses unsafe and repeated names", () => {
    const zip = new ZipWriter()
    expect(() => zip.add("../x.jpg", new Uint8Array(1))).toThrow("zip_bad_name")
    expect(() => zip.add("/x.jpg", new Uint8Array(1))).toThrow("zip_bad_name")
    zip.add("x.jpg", new Uint8Array(1))
    expect(() => zip.add("x.jpg", new Uint8Array(1))).toThrow(
      "zip_duplicate_name"
    )
  })
})

describe("filenames", () => {
  it("joins the stored stem and the extension", () => {
    expect(exportFilename("white-horse-chicken-momo-1a2b3c4d", "webp")).toBe(
      "white-horse-chicken-momo-1a2b3c4d.webp"
    )
  })

  it("refuses anything that is not a plain slug", () => {
    for (const stem of [
      "IMG_2041",
      "anna's photo",
      "../etc",
      "a--b",
      "52.2N-0.1E",
      "",
    ]) {
      expect(() => exportFilename(stem, "jpg")).toThrow()
    }
    expect(() => exportFilename("ok", "j.pg")).toThrow()
  })

  it("names originals by their type and resized files by the profile", () => {
    expect(extensionFor("original", "image/jpeg")).toBe("jpg")
    expect(extensionFor("original", "image/heic")).toBe("heic")
    expect(extensionFor("webp", "image/heic")).toBe("webp")
    expect(extensionFor("jpeg", "image/png")).toBe("jpg")
  })
})

describe("manifest", () => {
  it("writes every column, quoting and neutralising formulas", () => {
    const row = Object.fromEntries(
      MANIFEST_COLUMNS.map((c) => [c, null])
    ) as ManifestRow
    row.file = "a.webp"
    row.subject = 'Fish, "chips"'
    row.caption = "=HYPERLINK(1)"
    row.width = 1600
    const csv = manifestCsv([row])
    const [header, line] = csv.trim().split("\r\n")
    expect(header!.split(",")).toEqual([...MANIFEST_COLUMNS])
    expect(line).toContain('"Fish, ""chips"""')
    expect(line).toContain("'=HYPERLINK(1)")
    expect(line).toContain(",1600,")
    expect(csvField(null)).toBe("")
  })
})

describe("publication words", () => {
  it("names every spec state, and Exported is never Published (§10 inv. 9)", () => {
    expect(PUBLICATION_STATES).toHaveLength(8)
    for (const s of PUBLICATION_STATES)
      expect(PUBLICATION_WORDS[s]).toBeTruthy()
    expect(PUBLICATION_WORDS.exported).toBe("Exported")
    expect(PUBLICATION_WORDS.exported).not.toMatch(/publish/i)
  })

  it("reads an unknown or missing state as Not exported", () => {
    expect(parsePublication(null).state).toBe("not_selected")
    expect(parsePublication({ state: "installed" }).state).toBe("not_selected")
  })
})

describe("parsers", () => {
  const item = {
    assetId: "00000000-0000-4000-8000-000000000001",
    subjectKind: "menu_item",
    subjectId: "00000000-0000-4000-8000-000000000002",
    subjectLabel: "Korma",
    category: "food",
    approvalLevel: "public",
    approvalId: "p1",
    approvalVersion: "2",
    uploadedAt: "2026-11-18T10:00:00Z",
    publication: { state: "exported", exportedAt: "2026-11-18T11:00:00Z" },
  }

  it("keeps good candidate rows and drops malformed ones", () => {
    const parsed = parseCandidates({
      venueId: "v",
      venueName: "The Bell",
      mode: "public",
      items: [item, { ...item, category: "bedrooms" }, null],
    })
    expect(parsed?.items).toHaveLength(1)
    expect(parsed?.items[0]?.publication.state).toBe("exported")
  })

  it("reads a package with items and downloads", () => {
    const detail = parsePackageDetail({
      id: "00000000-0000-4000-8000-0000000000aa",
      mode: "public",
      profile: { key: "website", label: "Website image", format: "webp" },
      state: "needs_rebuild",
      createdAt: "2026-11-18T10:00:00Z",
      itemCount: 1,
      staleAssets: [item.assetId],
      items: [
        {
          ...item,
          position: 1,
          venueId: "v",
          filenameStem: "the-bell-korma-00000000",
          useRestrictions: ["internal_only"],
          eligible: false,
        },
      ],
      downloads: [{ id: "d", startedAt: "2026-11-18T10:01:00Z" }],
    })
    expect(detail?.state).toBe("needs_rebuild")
    expect(detail?.items[0]?.eligible).toBe(false)
    expect(detail?.downloads).toHaveLength(1)
  })
})

describe("output profiles", () => {
  async function photoWithLocation() {
    return new Uint8Array(
      await sharp({
        create: {
          width: 3000,
          height: 2000,
          channels: 3,
          background: "#884422",
        },
      })
        .withExif({
          IFD0: { Make: "TestPhone" },
          IFD3: { GPSLatitudeRef: "N", GPSLatitude: "52/1 13/1 0/1" },
        })
        .jpeg()
        .toBuffer()
    )
  }

  it("passes an Original through unchanged", async () => {
    const bytes = await photoWithLocation()
    const out = await renderExportFile(
      { bytes, mime: "image/jpeg", width: 3000, height: 2000 },
      { format: "original", maxWidth: null, maxHeight: null, quality: null }
    )
    expect(out.bytes).toBe(bytes)
    expect(out.ext).toBe("jpg")
  })

  it("fits Website inside its box and writes no camera details or location", async () => {
    const out = await renderExportFile(
      {
        bytes: await photoWithLocation(),
        mime: "image/jpeg",
        width: 3000,
        height: 2000,
      },
      { format: "webp", maxWidth: 1600, maxHeight: 1600, quality: 82 }
    )
    expect(out).toMatchObject({ ext: "webp", width: 1600, height: 1067 })
    const meta = await sharp(out.bytes).metadata()
    expect(meta.format).toBe("webp")
    expect(meta.exif).toBeUndefined()
  })

  it("never enlarges, and writes JPEG for Social", async () => {
    const small = new Uint8Array(
      await sharp({
        create: {
          width: 400,
          height: 300,
          channels: 4,
          background: "#00000000",
        },
      })
        .png()
        .toBuffer()
    )
    const out = await renderExportFile(
      { bytes: small, mime: "image/png", width: 400, height: 300 },
      { format: "jpeg", maxWidth: 1080, maxHeight: 1350, quality: 85 }
    )
    expect(out).toMatchObject({ ext: "jpg", width: 400, height: 300 })
    expect((await sharp(out.bytes).metadata()).format).toBe("jpeg")
  })
})
