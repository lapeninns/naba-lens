import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"

import {
  ANSWER_VALUES,
  AUDIENCES,
  LIMITS,
  PURPOSES,
  QUESTION_KEYS,
  SUPPORTED_SCHEMAS,
  UNAVAILABLE_DETAILS,
} from "@/app/api/knowledge/_reader/contract"
import { READER_ERROR_STATUS } from "@/app/api/knowledge/_reader/errors"
import { ANSWER_PARAMS } from "@/app/api/knowledge/_reader/request"

const sourceDir = "app/api/knowledge/v1"
const output = "docs/knowledge/openapi.json"
const meta = "/api/knowledge/v1/meta"
const answers = "/api/knowledge/v1/venues/{venueId}/answers"
const routeSpecs = { [meta]: "ReaderMeta", [answers]: "ReaderAnswers" }
const string = { type: "string" }
const integer = { type: "integer" }
const uuid = { ...string, format: "uuid" }
const time = { ...string, format: "date-time" }
const bool = { type: "boolean" }
const choices = (values: readonly string[]) => ({ ...string, enum: values })
const array = (items: object) => ({ type: "array", items })
const object = (properties: Record<string, object>) => ({
  type: "object",
  required: Object.keys(properties),
  properties,
})
const nullable = (schema: object) => ({ anyOf: [schema, { type: "null" }] })
const schema = choices(SUPPORTED_SCHEMAS)
const audience = choices(AUDIENCES)
const purpose = choices(PURPOSES)
const question = choices(QUESTION_KEYS)
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })
const body = (name: string) => ({ "application/json": { schema: ref(name) } })
const headers = {
  "X-Request-ID": { schema: uuid },
  "Cache-Control": { schema: string },
}

const querySchemas = {
  schema,
  audience,
  purpose,
  keys: {
    ...array(question),
    uniqueItems: true,
    minItems: 1,
    maxItems: LIMITS.maxKeys,
  },
}
const query = ANSWER_PARAMS.map((name) => ({
  in: "query",
  name,
  required: true,
  ...(name === "keys" ? { style: "form", explode: false } : {}),
  schema: querySchemas[name],
}))

const paths = Object.fromEntries(
  Object.entries(routeSpecs).map(([path, response]) => {
    const isAnswers = path === answers
    function operation(head: boolean) {
      const responseHeaders = isAnswers
        ? { ...headers, ETag: { schema: string } }
        : headers
      const errors = Object.entries(READER_ERROR_STATUS).filter(
        ([, status]) =>
          status !== 405 && (isAnswers || ![403, 404].includes(status))
      )
      const responses = Object.fromEntries(
        [...new Set(errors.map(([, status]) => status))].map((status) => [
          String(status),
          {
            description: errors
              .filter(([, code]) => code === status)
              .map(([code]) => code)
              .join(", "),
            headers,
            ...(!head ? { content: body("ReaderError") } : {}),
          },
        ])
      )
      return {
        summary: isAnswers ? "Read venue answers" : "Read the credential scope",
        parameters: isAnswers
          ? [
              { in: "path", name: "venueId", required: true, schema: uuid },
              ...query,
              { in: "header", name: "If-None-Match", schema: string },
            ]
          : [],
        responses: {
          "200": {
            description: "Success",
            headers: responseHeaders,
            ...(!head ? { content: body(response) } : {}),
          },
          ...(isAnswers
            ? {
                "304": {
                  description: "Snapshot unchanged",
                  headers: responseHeaders,
                },
              }
            : {}),
          ...responses,
        },
      }
    }
    return [path, { get: operation(false), head: operation(true) }]
  })
)

// Next exports handlers for rejected methods too so they get a JSON 405.
// Check that the filesystem endpoints and all explicit entry points match.
const implemented = readdirSync(sourceDir, {
  recursive: true,
  encoding: "utf8",
})
  .filter((file) => file.endsWith("/route.ts"))
  .map((file) => {
    const route = ts.createSourceFile(
      "route.ts",
      readFileSync(join(sourceDir, file), "utf8"),
      ts.ScriptTarget.Latest,
      true
    )
    const exports = route.statements.flatMap((statement) =>
      ts.isVariableStatement(statement) &&
      statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
      )
        ? statement.declarationList.declarations.map((declaration) =>
            declaration.name.getText(route)
          )
        : []
    )
    for (const name of [
      "GET",
      "HEAD",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ]) {
      if (!exports.includes(name))
        throw Error(`${file}: missing explicit ${name} handling`)
    }
    return `/api/knowledge/v1/${file.replace(/\/route\.ts$/, "").replace(/\[(\w+)\]/g, "{$1}")}`
  })
  .sort()
if (JSON.stringify(implemented) !== JSON.stringify(Object.keys(paths).sort()))
  throw Error("Reader API routes changed; update OpenAPI")

const document = {
  openapi: "3.1.0",
  info: {
    title: "Naba-Lens internal knowledge reader",
    version: SUPPORTED_SCHEMAS.at(-1),
  },
  security: [{ consumerCredential: [] }],
  paths,
  components: {
    securitySchemes: { consumerCredential: { type: "http", scheme: "bearer" } },
    schemas: {
      ReaderMeta: object({
        supportedSchemas: array(schema),
        consumer: object({
          id: string,
          venues: array(uuid),
          audiences: array(audience),
          purposes: array(purpose),
          questions: array(question),
          schemaMajors: array(integer),
        }),
      }),
      ReaderAnswers: object({
        schema,
        venue: object({ id: uuid }),
        audience,
        purpose,
        snapshot: object({ readAt: time, etag: string }),
        answers: array(ref("ReaderAnswer")),
      }),
      ReaderAnswer: object({
        key: question,
        questionVersion: nullable(integer),
        status: choices(["available", "unavailable"]),
        value: nullable(
          object({
            type: choices(["yes_no_na"]),
            answer: choices(ANSWER_VALUES),
          })
        ),
        summary: nullable(string),
        conditions: array(
          object({ kind: choices(["limitation", "reason"]), text: string })
        ),
        provenance: nullable(
          object({
            sourceKind: string,
            contributionId: uuid,
            idKind: choices(["contribution", "submission"]),
            confirmation: nullable(
              object({
                authority: choices(["venue_manager", "admin"]),
                selfConfirmed: bool,
                savedAt: time,
              })
            ),
            redactionProof: nullable(choices(["recorded", "not_recorded"])),
            evidence: object({ photos: integer, videos: integer }),
          })
        ),
        revision: nullable(integer),
        freshness: nullable(
          object({
            savedAt: time,
            observedAt: nullable(time),
            nextCheckDue: nullable(time),
            state: choices(["current", "due_soon", "unrated"]),
          })
        ),
        unavailable: nullable(
          object({
            reason: choices([
              ...Object.keys(UNAVAILABLE_DETAILS),
              "not_permitted",
              "unsupported_version",
            ]),
            detail: nullable(string),
          })
        ),
      }),
      ReaderError: object({
        error: {
          ...object({
            code: choices(Object.keys(READER_ERROR_STATUS)),
            message: string,
            requestId: uuid,
          }),
          properties: {
            code: choices(Object.keys(READER_ERROR_STATUS)),
            message: string,
            requestId: uuid,
            retryAfterSeconds: integer,
            supported: array(schema),
          },
        },
      }),
    },
  },
}
const text = JSON.stringify(document, null, 2) + "\n"
if (process.argv[2] === "--write") writeFileSync(output, text)
else if (readFileSync(output, "utf8") !== text)
  throw Error(
    "OpenAPI drift: run pnpm docs:api --write and review the contract"
  )
console.log(`Reader OpenAPI verified: ${implemented.length} routes`)
