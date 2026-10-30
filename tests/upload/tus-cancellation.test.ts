import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { DefaultHttpStack } from "tus-js-client"

import { createUploader, toQueueUploader } from "../../lib/upload"
import { createFakeBackend } from "./helpers/fake-backend"
import { startFakeStorage, type FakeStorage } from "./helpers/fake-storage"
import { blobFileReader, MemoryUrlStorage } from "./helpers/node-adapters"
import { createQueueItemDriver } from "./helpers/ui-queue-contract"

let storage: FakeStorage
let backend: ReturnType<typeof createFakeBackend>

beforeEach(async () => {
  storage = await startFakeStorage()
  backend = createFakeBackend(storage)
})

afterEach(async () => {
  await storage.close()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function queue(
  getAccessToken: () => Promise<string | null>,
  sends: string[] = []
) {
  const httpStack = new DefaultHttpStack({})
  const createRequest = httpStack.createRequest.bind(httpStack)
  httpStack.createRequest = (method, url) => {
    const request = createRequest(method, url)
    const send = request.send.bind(request)
    request.send = (body) => {
      sends.push(method)
      return send(body)
    }
    return request
  }
  const upload = createUploader({
    reserve: backend.reserve,
    finalise: backend.finalise,
    supabaseUrl: storage.url,
    getAccessToken,
    limits: {
      maxPhotoBytes: 20 * 1024 * 1024,
      maxVideoBytes: 200 * 1024 * 1024,
    },
    chunkSize: 64 * 1024,
    retryDelays: [],
    tusAdapters: {
      fileReader: blobFileReader,
      urlStorage: new MemoryUrlStorage(),
      httpStack,
    },
  })
  return createQueueItemDriver(
    toQueueUploader(upload, { newKey: () => "cancelled-token-refresh" }),
    new File([new Uint8Array(128 * 1024)], "clip.mp4", {
      type: "video/mp4",
    })
  )
}

describe("TUS cancellation during auth refresh", () => {
  it.each(["token", "expired", "error"] as const)(
    "releases the queue immediately and ignores a late initial auth %s",
    async (outcome) => {
      const started = deferred<void>()
      const token = deferred<string | null>()
      let calls = 0
      const item = queue(async () => {
        if (++calls === 1) {
          started.resolve()
          return token.promise
        }
        return "user-jwt"
      })

      const first = item.run()
      await started.promise
      item.cancel()
      // Auth is still pending: cancellation must release the adapter's in-use
      // key before a retry, rather than waiting for getSession to finish.
      await first
      expect(item.status).toBe("cancelled")
      expect(storage.requests).toHaveLength(0)
      expect(backend.calls.finalise).toHaveLength(0)

      await item.run()
      expect(item.status).toBe("done")
      expect(backend.assets.size).toBe(1)
      expect(backend.calls.finalise).toHaveLength(1)
      const requestCount = storage.requests.length
      if (outcome === "error") token.reject(new Error("Auth refresh failed"))
      else token.resolve(outcome === "token" ? "late-jwt" : null)
      // Observe all callbacks attached to the abandoned auth refresh.
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(storage.requests).toHaveLength(requestCount)
      expect(backend.calls.finalise).toHaveLength(1)
    }
  )

  it("does not send a TUS request after cancellation during its token refresh", async () => {
    const started = deferred<void>()
    const token = deferred<string | null>()
    const sends: string[] = []
    let calls = 0
    const item = queue(async () => {
      if (++calls === 2) {
        started.resolve()
        return token.promise
      }
      return "user-jwt"
    }, sends)

    const first = item.run()
    await started.promise
    item.cancel()
    await first
    expect(item.status).toBe("cancelled")
    expect(sends).toHaveLength(0)
    expect(storage.requests).toHaveLength(0)
    expect(backend.calls.finalise).toHaveLength(0)

    await item.run()
    expect(item.status).toBe("done")
    const requestCount = storage.requests.length
    const sendCount = sends.length
    token.resolve("late-jwt")
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(sends).toHaveLength(sendCount)
    expect(storage.requests).toHaveLength(requestCount)
    expect(backend.calls.finalise).toHaveLength(1)
  })

  it("retains an auth refresh failure when the transfer was not cancelled", async () => {
    let fail = true
    const item = queue(async () => {
      if (fail) throw new Error("Auth refresh failed")
      return "user-jwt"
    })

    await item.run()
    expect(item.status).toBe("failed")
    expect(item.error).toBe("Auth refresh failed")
    expect(storage.requests).toHaveLength(0)
    expect(backend.calls.finalise).toHaveLength(0)

    fail = false
    await item.run()
    expect(item.status).toBe("done")
    expect(backend.assets.size).toBe(1)
    expect(backend.calls.finalise).toHaveLength(1)
  })
})
