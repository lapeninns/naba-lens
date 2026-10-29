// In-process stand-in for Supabase Storage's two upload endpoints:
//  - TUS at /storage/v1/upload/resumable, served by @tus/server + @tus/file-store
//  - signed PUT at /storage/v1/object/upload/sign/{bucket}/{key}?token=...
// It mimics the Supabase behaviours the transport relies on: objects are not
// overwritten (`x-upsert: false` -> 409 / 400 "Duplicate"), and a finished TUS
// upload URL answers 404 to HEAD. Fault hooks let tests fail or drop requests.

import { mkdtemp, readFile, rm } from "node:fs/promises"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { Readable } from "node:stream"

import { FileStore } from "@tus/file-store"
import { Server } from "@tus/server"

export const TUS_PATH = "/storage/v1/upload/resumable"
const SIGN_PREFIX = "/storage/v1/object/upload/sign/"

export type LoggedRequest = {
  method: string
  path: string
  /** `Upload-Offset` of a PATCH. */
  offset: number | null
  headers: http.IncomingHttpHeaders
  /** Body bytes the server actually received (PATCH/PUT). */
  bytes: number
}

/** What to do with a request: pass it through, fail it, or lose the response. */
export type Fault = "pass" | "fail-500" | "drop-response"

export type FakeStorage = {
  url: string
  /** Stored objects by `{bucket}/{key}`. */
  objects: Map<string, Buffer>
  requests: LoggedRequest[]
  /** Called per request before handling; return a fault to inject. */
  fault: (req: LoggedRequest, index: number) => Fault | Promise<Fault>
  /** Stop listening and cut every open connection, like a crashed server. */
  kill(): Promise<void>
  /** Listen again on the same port with the same stored state. */
  restart(): Promise<void>
  close(): Promise<void>
}

export async function startFakeStorage(): Promise<FakeStorage> {
  const directory = await mkdtemp(path.join(tmpdir(), "nabalens-tus-"))
  const objects = new Map<string, Buffer>()
  const requests: LoggedRequest[] = []
  // tus upload id -> "{bucket}/{key}" for finished uploads.
  const finishedUploads = new Map<string, string>()

  const tus = new Server({
    path: TUS_PATH,
    datastore: new FileStore({ directory }),
    onUploadCreate: async (_req, upload) => {
      const key = objectKey(upload.metadata)
      if (objects.has(key)) {
        throw { status_code: 409, body: "The resource already exists" }
      }
      return {}
    },
    onUploadFinish: async (_req, upload) => {
      const key = objectKey(upload.metadata)
      objects.set(key, await readFile(path.join(directory, upload.id)))
      finishedUploads.set(upload.id, key)
      return {}
    },
  })

  const storage: FakeStorage = {
    url: "",
    objects,
    requests,
    fault: () => "pass",
    kill: async () => {
      if (!server.listening) return
      const closed = new Promise<void>((resolve) =>
        server.close(() => resolve())
      )
      server.closeAllConnections()
      await closed
    },
    restart: async () => {
      await new Promise<void>((resolve) =>
        server.listen(port, "127.0.0.1", resolve)
      )
    },
    close: async () => {
      await storage.kill()
      await rm(directory, { recursive: true, force: true })
    },
  }

  const server = http.createServer((req, res) => {
    // A client that aborts mid-body makes reads reject; that's expected here.
    handle(req, res).catch(() => {
      if (!res.headersSent) res.destroy()
    })
  })

  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? "/", storage.url)
    const offsetHeader = req.headers["upload-offset"]
    const logged: LoggedRequest = {
      method: req.method ?? "GET",
      path: url.pathname,
      offset: offsetHeader ? Number(offsetHeader) : null,
      headers: req.headers,
      bytes: 0,
    }
    requests.push(logged)
    const fault = await storage.fault(logged, requests.length - 1)

    if (fault === "fail-500") {
      logged.bytes = (await readBody(req)).length
      res.writeHead(500).end("injected failure")
      return
    }

    let response: Response
    if (url.pathname.startsWith(SIGN_PREFIX)) {
      const body = await readBody(req)
      logged.bytes = body.length
      response = signedPut(url, req, body, objects)
    } else if (url.pathname.startsWith(TUS_PATH)) {
      const id = url.pathname.slice(TUS_PATH.length + 1)
      if (req.method === "HEAD" && finishedUploads.has(id)) {
        // Supabase forgets a TUS upload once the object exists.
        response = new Response(null, { status: 404 })
      } else {
        response = await tus.handleWeb(toWebRequest(url, req, logged))
      }
    } else {
      response = new Response("not found", { status: 404 })
    }

    if (fault === "drop-response") {
      // The work is done server-side but the client never hears back.
      req.socket.destroy()
      return
    }
    res.writeHead(response.status, Object.fromEntries(response.headers))
    res.end(Buffer.from(await response.arrayBuffer()))
  }

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  storage.url = `http://127.0.0.1:${port}`
  return storage
}

function objectKey(metadata: Record<string, string | null> | undefined) {
  return `${metadata?.bucketName}/${metadata?.objectName}`
}

function signedPut(
  url: URL,
  req: http.IncomingMessage,
  body: Buffer,
  objects: Map<string, Buffer>
): Response {
  if (req.method !== "PUT" || url.searchParams.get("token") !== "signed") {
    return Response.json({ error: "InvalidSignature" }, { status: 400 })
  }
  const key = decodeURIComponent(url.pathname.slice(SIGN_PREFIX.length))
  if (objects.has(key) && req.headers["x-upsert"] !== "true") {
    // Supabase's historical shape: HTTP 400 with a 409 statusCode in the body.
    return Response.json(
      {
        statusCode: "409",
        error: "Duplicate",
        message: "The resource already exists",
      },
      { status: 400 }
    )
  }
  objects.set(key, body)
  return Response.json({ Key: key }, { status: 200 })
}

function toWebRequest(
  url: URL,
  req: http.IncomingMessage,
  logged: LoggedRequest
): Request {
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(name, value)
  }
  const hasBody = req.method === "PATCH" || req.method === "POST"
  if (hasBody) req.on("data", (chunk: Buffer) => (logged.bytes += chunk.length))
  return new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
    // @ts-expect-error -- Node's fetch needs duplex for streaming bodies.
    duplex: "half",
  })
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}
