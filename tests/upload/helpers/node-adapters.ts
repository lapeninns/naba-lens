// Node stand-ins for the browser pieces the transport uses: XMLHttpRequest,
// tus-js-client's Blob reader and its localStorage-backed URL storage.

import http from "node:http"

import type { TusAdapters, XhrLike } from "../../../lib/upload"

/** Minimal XMLHttpRequest over node:http, with upload progress events. */
export class NodeXhr implements XhrLike {
  status = 0
  responseText = ""
  upload: XhrLike["upload"] = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  ontimeout: (() => void) | null = null
  private method = "GET"
  private url = ""
  private headers: Record<string, string> = {}
  private request: http.ClientRequest | null = null
  private aborted = false

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value
  }

  send(body: Blob) {
    void body.arrayBuffer().then((buffer) => {
      if (this.aborted) return
      const bytes = Buffer.from(buffer)
      const req = http.request(this.url, {
        method: this.method,
        headers: { ...this.headers, "content-length": bytes.length },
      })
      this.request = req
      req.on("response", (res) => {
        const chunks: Buffer[] = []
        res.on("data", (c: Buffer) => chunks.push(c))
        res.on("end", () => {
          this.status = res.statusCode ?? 0
          this.responseText = Buffer.concat(chunks).toString("utf8")
          this.onload?.()
        })
      })
      req.on("error", () => {
        if (!this.aborted) this.onerror?.()
      })
      // Write in pieces so progress events fire like a browser's.
      const piece = Math.max(1, Math.ceil(bytes.length / 4))
      for (let sent = 0; sent < bytes.length; sent += piece) {
        req.write(bytes.subarray(sent, sent + piece))
        this.upload.onprogress?.({
          lengthComputable: true,
          loaded: Math.min(sent + piece, bytes.length),
          total: bytes.length,
        } as ProgressEvent)
      }
      req.end()
    })
  }

  abort() {
    if (this.aborted) return
    this.aborted = true
    this.request?.destroy()
    this.onabort?.()
  }
}

type Stored = {
  fingerprint: string
  upload: {
    size: number | null
    metadata: Record<string, string>
    creationTime: string
    uploadUrl: string | null
    parallelUploadUrls: string[] | null
  }
}

/** tus URL storage kept in memory; shared across uploads like localStorage. */
export class MemoryUrlStorage {
  readonly entries = new Map<string, Stored>()
  private counter = 0

  async findAllUploads() {
    return [...this.entries].map(([key, e]) => ({
      ...e.upload,
      urlStorageKey: key,
    }))
  }

  async findUploadsByFingerprint(fingerprint: string) {
    return (await this.findAllUploads()).filter(
      (u) => this.entries.get(u.urlStorageKey)?.fingerprint === fingerprint
    )
  }

  async removeUpload(key: string) {
    this.entries.delete(key)
  }

  async addUpload(fingerprint: string, upload: Stored["upload"]) {
    const key = `tus::${fingerprint}::${++this.counter}`
    this.entries.set(key, { fingerprint, upload })
    return key
  }
}

/** tus-js-client's Node build reads Buffers/streams, not Blobs; bridge that. */
export const blobFileReader: NonNullable<TusAdapters["fileReader"]> = {
  async openFile(input: Blob) {
    const buffer = Buffer.from(await input.arrayBuffer())
    return {
      size: buffer.length,
      async slice(start: number, end: number) {
        // tus-js-client reads `size` from the chunk to track the offset.
        const value = Object.assign(buffer.subarray(start, end), {
          size: Math.max(0, Math.min(end, buffer.length) - start),
        })
        return { value, done: end >= buffer.length }
      },
      close() {},
    }
  },
}
