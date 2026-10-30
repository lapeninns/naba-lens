import "server-only"

import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdtemp, open, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"

import type { ArchiveConfig } from "./config"
import type { ArchiveSource, ArchiveStore, PreparedOriginal } from "./core"

const IO_TIMEOUT_MS = 60_000

/** Bounded disk spool avoids buffering a 200 MiB video in the function heap. */
export async function prepareOriginal(
  config: ArchiveConfig,
  source: ArchiveSource,
  signal: AbortSignal = AbortSignal.timeout(45_000)
): Promise<PreparedOriginal> {
  const directory = await mkdtemp(join(tmpdir(), "nabalens-archive-"))
  const path = join(directory, "original")
  const dispose = () => rm(directory, { recursive: true, force: true })
  try {
    const key = source.originalPath.split("/").map(encodeURIComponent).join("/")
    const response = await fetch(
      `${config.sourceUrl}/storage/v1/object/authenticated/media/${key}`,
      {
        headers: {
          apikey: config.sourceServiceKey,
          authorization: `Bearer ${config.sourceServiceKey}`,
        },
        cache: "no-store",
        redirect: "error",
        signal,
      }
    )
    if (!response.ok || !response.body)
      throw new Error("archive_source_unavailable")
    const reader = response.body.getReader()
    const file = await open(path, "wx", 0o600)
    const hash = createHash("sha256")
    let size = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > source.sizeBytes)
          throw new Error("archive_source_size_changed")
        hash.update(value)
        for (let offset = 0; offset < value.byteLength;) {
          const result = await file.write(
            value,
            offset,
            value.byteLength - offset
          )
          if (result.bytesWritten === 0)
            throw new Error("archive_spool_write_failed")
          offset += result.bytesWritten
        }
      }
      if (size !== source.sizeBytes)
        throw new Error("archive_source_size_changed")
    } finally {
      void reader.cancel().catch(() => undefined)
      await file.close()
    }
    return {
      sha256: hash.digest("hex"),
      sizeBytes: size,
      handle: path,
      dispose,
    }
  } catch {
    await dispose()
    throw new Error("archive_source_read_failed")
  }
}

function alreadyExists(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("$metadata" in error))
    return false
  const status = (error.$metadata as { httpStatusCode?: number })
    ?.httpStatusCode
  // R2 checks a bucket lock before evaluating If-None-Match. A locked existing
  // key must still pass the subsequent full read-back, never count as success here.
  return (
    status === 412 ||
    (status === 409 &&
      "name" in error &&
      error.name === "ObjectLockedByBucketPolicy")
  )
}

/** Full read-back verification is intentional: ETag is not a SHA-256 checksum. */
async function verify(
  client: S3Client,
  bucket: string,
  key: string,
  expectedHash: string,
  expectedSize: number,
  signal: AbortSignal
) {
  try {
    const response = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      {
        abortSignal: signal,
      }
    )
    const body = response.Body as
      (AsyncIterable<Uint8Array> & { destroy?(): void }) | undefined
    if (!response.Body || response.ContentLength !== expectedSize) {
      body?.destroy?.()
      throw new Error("size")
    }
    const hash = createHash("sha256")
    let size = 0
    try {
      for await (const chunk of body!) {
        size += chunk.byteLength
        if (size > expectedSize) throw new Error("size")
        hash.update(chunk)
      }
    } finally {
      body?.destroy?.()
    }
    if (size !== expectedSize || hash.digest("hex") !== expectedHash)
      throw new Error("checksum")
  } catch {
    throw new Error("archive_destination_verification_failed")
  }
}

export function createArchiveStore(
  config: ArchiveConfig,
  signal: AbortSignal = AbortSignal.timeout(45_000)
): ArchiveStore {
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    maxAttempts: 2,
    // R2 does not support every automatically selected AWS checksum algorithm.
    // Our SHA-256 is verified with a full GET after each conditional write.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    requestHandler: {
      connectionTimeout: 10_000,
      requestTimeout: IO_TIMEOUT_MS,
    },
  })
  return {
    async putOriginalIfAbsent(key, original, mime) {
      const body = createReadStream(original.handle as string)
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: key,
            Body: body,
            ContentLength: original.sizeBytes,
            ContentType: mime,
            Metadata: { sha256: original.sha256 },
            IfNoneMatch: "*",
          }),
          { abortSignal: signal }
        )
      } catch (error) {
        if (!alreadyExists(error))
          throw new Error("archive_destination_write_failed")
      } finally {
        body.destroy()
      }
    },
    verifyOriginal: (key, hash, size) =>
      verify(client, config.bucket, key, hash, size, signal),
    async putManifestIfAbsent(key, body) {
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: key,
            Body: body,
            ContentType: "application/json",
            ContentLength: body.byteLength,
            CacheControl: "private, no-store",
            IfNoneMatch: "*",
          }),
          { abortSignal: signal }
        )
      } catch (error) {
        if (!alreadyExists(error))
          throw new Error("archive_manifest_write_failed")
      }
    },
    verifyManifest: (key, hash, size) =>
      verify(client, config.bucket, key, hash, size, signal),
    close: () => client.destroy(),
  }
}
