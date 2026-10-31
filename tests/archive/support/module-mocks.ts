import { afterEach, beforeEach } from "vitest"

import { PROJECT_REF, createWorld, type World } from "./world"

/**
 * Module replacements for the archive's environment-bound dependencies (R2
 * client, hosted-only config, Supabase storage download). Use from a test file:
 *
 *   vi.mock("@/lib/server/archive/config", async () => (await import("../support/module-mocks")).configMock)
 *   vi.mock("@/lib/server/archive/index", async () => (await import("../support/module-mocks")).indexMock)
 *   vi.mock("@/lib/server/archive/object-store", async () => (await import("../support/module-mocks")).objectStoreMock)
 *
 * and set `mocked.world` in `beforeEach`.
 */
export const mocked: { world: World | null; archiveDisabled: boolean } = {
  world: null,
  archiveDisabled: false,
}

/** Fresh world, installed clock and module mocks for every test in the file. */
export function setupWorld(options?: Parameters<typeof createWorld>[0]) {
  const ctx = {} as { world: World }
  beforeEach(() => {
    ctx.world = createWorld(options)
    ctx.world.clock.install()
    mocked.world = ctx.world
    mocked.archiveDisabled = false
  })
  afterEach(() => {
    ctx.world.clock.uninstall()
    mocked.world = null
  })
  return ctx
}

function world() {
  if (!mocked.world) throw new Error("module mocks used without a world")
  return mocked.world
}

export const configMock = {
  readArchiveConfig: () =>
    mocked.archiveDisabled
      ? null
      : {
          sourceUrl: "http://127.0.0.1:64221",
          sourceProjectRef: PROJECT_REF,
          sourceServiceKey: "fixture",
          accountId: "0".repeat(32),
          bucket: "fixture-bucket",
          accessKeyId: "fixture",
          secretAccessKey: "fixture",
        },
}

export const indexMock = {
  ensureMediaOriginalArchived: async (
    _service: unknown,
    assetId: string,
    _validated?: unknown,
    signal?: AbortSignal
  ) => world().archiveAsset(assetId, signal),
  ensureArchiveBeforeRemoval: async () => undefined,
}

export const objectStoreMock = {
  createArchiveStore: (_config: unknown, signal?: AbortSignal) =>
    world().bucket.store(signal),
  prepareOriginal: async () => {
    throw new Error("prepareOriginal is not available under the fake store")
  },
}
