// B03-a question registry (docs/knowledge/b03-design.md §3): the value
// validator against the fixtures the database validator also runs, the
// registry services' input checks, and the error mapping. Mocked RPC client.
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it, vi } from "vitest"

import * as knowledge from "@/lib/server/knowledge"
import { knowledgeRpcFailure } from "@/lib/server/knowledge/errors"
import { validateKnowledgeValue } from "@/lib/server/knowledge/values"
import type { MediaActor } from "@/lib/server/media/types"

vi.mock("server-only", () => ({}))

type Case = {
  name: string
  schema: string
  version: number
  headline: unknown
  detail: unknown
  expect:
    | { ok: true; detail: unknown }
    | { fields: { path: string; problem: string }[] }
    | { unknownSchema: true }
}

const { cases } = JSON.parse(
  readFileSync(
    join(process.cwd(), "tests/fixtures/knowledge/values.json"),
    "utf8"
  )
) as { cases: Case[] }

const NOW = new Date("2026-11-10T12:00:00Z")

describe("validateKnowledgeValue (shared fixtures)", () => {
  it.each(cases.map((c) => [c.name, c] as const))("%s", (_, c) => {
    const out = validateKnowledgeValue(
      c.schema,
      c.version,
      c.headline,
      c.detail,
      NOW
    )
    if ("unknownSchema" in c.expect)
      expect(out).toEqual({ ok: false, reason: "unknown_value_schema" })
    else if ("fields" in c.expect)
      expect(out).toEqual({
        ok: false,
        reason: "invalid_value",
        fields: c.expect.fields,
      })
    else
      expect(out).toEqual({
        ok: true,
        headline: c.headline,
        detail: c.expect.detail,
      })
  })
})

function actorWith(handlers: Record<string, (args: object) => object>) {
  const rpc = vi.fn(async (fn: string, args: object = {}) => {
    const handler = handlers[fn]
    if (!handler) throw new Error(`unexpected rpc ${fn}`)
    const out = handler(args) as { data?: unknown; error?: unknown }
    return { data: out.data ?? null, error: out.error ?? null }
  })
  const db = { rpc }
  return { actor: { db, service: db } as unknown as MediaActor, rpc }
}

describe("registry services", () => {
  it("reads one question, the latest unless a version is named", async () => {
    const question = { key: "darts", version: 1, materialFields: ["headline"] }
    const { actor, rpc } = actorWith({
      knowledge_question: () => ({ data: question }),
    })
    expect(
      await knowledge.getKnowledgeQuestion(actor, { key: "darts" })
    ).toEqual({
      ok: true,
      question,
    })
    await knowledge.getKnowledgeQuestion(actor, { key: "darts", version: 1 })
    expect(rpc.mock.calls.map((c) => c[1])).toEqual([
      { p_key: "darts", p_version: null },
      { p_key: "darts", p_version: 1 },
    ])
    for (const bad of [{ key: "Darts!" }, {}, null])
      expect(await knowledge.getKnowledgeQuestion(actor, bad)).toMatchObject({
        code: "not_found",
      })
    expect(
      await knowledge.getKnowledgeQuestion(actor, { key: "darts", version: 0 })
    ).toMatchObject({ code: "invalid_input" })
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it("lists the registry, optionally by lifecycle", async () => {
    const { actor, rpc } = actorWith({
      knowledge_registry: () => ({ data: { items: [] } }),
    })
    expect(await knowledge.listQuestionRegistry(actor, {})).toEqual({
      ok: true,
      questions: [],
    })
    await knowledge.listQuestionRegistry(actor, { lifecycle: ["supported"] })
    expect(rpc.mock.calls.map((c) => c[1])).toEqual([
      { p_lifecycle: null },
      { p_lifecycle: ["supported"] },
    ])
    for (const lifecycle of [[], ["gone"], "supported"])
      expect(
        await knowledge.listQuestionRegistry(actor, { lifecycle })
      ).toMatchObject({ code: "invalid_input" })
  })
})

describe("registry errors", () => {
  it("map to non-retryable 4xx codes", () => {
    expect(
      knowledgeRpcFailure(
        { code: "P0002", message: "knowledge_question_not_found" },
        "t"
      )
    ).toMatchObject({ code: "not_found", status: 404 })
    expect(
      knowledgeRpcFailure({ code: "42501", message: "not_active_admin" }, "t")
    ).toMatchObject({ code: "not_permitted", status: 403 })
    expect(
      knowledgeRpcFailure(
        {
          code: "22023",
          message: "invalid_value",
          details: JSON.stringify({
            fields: [
              { path: "headline", problem: "required" },
              { path: "detail.entrances", problem: "no_entrances_listed" },
            ],
          }),
        },
        "t"
      )
    ).toMatchObject({
      code: "invalid_input",
      status: 400,
      fieldErrors: {
        headline: expect.any(String),
        "detail.entrances": expect.stringContaining("entrances"),
      },
    })
    expect(
      knowledgeRpcFailure(
        { code: "22023", message: "unknown_value_schema" },
        "t"
      )
    ).toMatchObject({ code: "invalid_input", status: 400 })
  })
})
