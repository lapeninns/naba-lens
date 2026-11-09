# Internal reader API, v1 contract

Status: draft contract for B01-05, written in B00-03. Owner: WS5 (consumers).
The knowledge domain model, the current-answer projection, the audience rules
and the question registry belong to WS1 (`docs/knowledge/**`). Where this
contract depends on a WS1 rule, it says so and names the safe behaviour until
that rule is approved.

The reader lets an authorised server-side consumer ask NabaLens for the
current answer to named venue questions. Each answer comes back with its
conditions, provenance, revision and freshness, or with an explicit reason the
answer is unavailable. It is read-only. It never changes contributions,
confirmations, targets or publication state.

## 1. Scope of v1

| Item           | v1                                                                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Venues         | The pilot venue only (The Old Crown), by venue ID. Other venues are enabled per credential later, without a contract change. |
| Questions      | The B01 working list: `onsite_parking`, `step_free_entrance`, `guest_toilets`, `guest_wifi`.                                 |
| Value types    | `yes`, `no`, `not_applicable` and Unknown, as defined by WS1.                                                                |
| Audiences      | `internal` only. `public` is reserved for the B06 public-safe projection.                                                    |
| Consumers      | Server-side programs operated by Lapen Inns. No browser, guest or third-party access.                                        |
| Delivery model | Pull. The consumer asks; NabaLens answers from a consistent snapshot. Push delivery and outboxes are B06.                    |

Out of scope for v1: writes, search across venues, menus and trading data
(B04), assets and media URLs (B05), the public projection and publication
revisions (B06), and NabaPresence intake (B07).

## 2. Authentication

### Decision

v1 uses a **server-side service credential per consumer**, sent as a bearer
token. It does not accept NabaLens browser sessions, and it adds no
internal-reader role to `app_role`.

### Why

- The consumers are programs (internal tooling, later the website's server,
  the MCP adapter and NabaPresence), not people. A program holding a person's
  session would need that person's refresh token, which expires, carries their
  staff permissions, and ties consumer access to one employee's account.
- A new `app_role` value reaches every exhaustive role check (home routing,
  layout gates, RLS helpers, admin account types). That is a schema change for
  every screen, owned by WS1 and the integration owner, to serve a non-human
  caller. A credential touches only `app/api/knowledge/**` and its helpers.
- A credential carries exactly the scope the consumer needs (venues,
  audiences, purposes, questions, schema major) and can be revoked or rotated
  without touching any staff account. This is the model B06 already requires
  ("service authentication, revocation"; "keep secret/service credentials
  server-side").
- It is reversible: unsetting the reader configuration disables the endpoint
  completely, and nothing else in the app depends on it.

An admin who wants to inspect what a consumer would receive uses the app's
existing screens. A signed-in preview inside the admin area can be added later
and must return the same response shape; it is not part of v1.

### Credential format and handling

- Format: `nlr_<consumerId>_<secret>`. `consumerId` is a short registry ID
  (`[a-z0-9-]{3,40}`). `secret` is at least 32 random bytes, base64url.
- Sent only as `Authorization: Bearer <credential>` over HTTPS. A credential in
  the query string, a cookie or a body is refused (`401 unauthenticated`), and
  never logged.
- NabaLens stores only the SHA-256 digest of each credential and compares
  digests in constant time, as the existing internal routes do.
- Each consumer may hold two active credentials at once, so rotation needs no
  downtime. Each credential has an expiry date; the default lifetime is 90 days.
- Session cookies on the request are ignored. A request with a valid session
  and no bearer credential is `401 unauthenticated`.
- No CORS headers are sent. The reader is server-to-server only.

### Consumer registry

Each consumer has one registry entry:

| Field          | Meaning                                                                     |
| -------------- | --------------------------------------------------------------------------- |
| `id`           | The `consumerId` in the credential.                                         |
| `credentials`  | Up to two SHA-256 digests, each with an expiry time.                        |
| `venues`       | Venue IDs this consumer may read. Never a name or slug.                     |
| `audiences`    | Audiences this consumer may request.                                        |
| `purposes`     | Purposes this consumer may declare.                                         |
| `questions`    | Question keys this consumer may read, or the audience's full permitted set. |
| `schemaMajors` | API major versions this consumer may use (`[1]` in v1).                     |
| `disabled`     | When true, every credential of this consumer is refused at once.            |

**v1 storage (reversible default):** the registry is server-side configuration
(an environment value holding digests and scopes, never plain credentials),
plus a global switch that disables the reader. Revocation takes effect at the
next deployment of configuration. This needs no schema change for a pilot with
one or two consumers.

**Before B06 public use:** the registry moves to a database table owned by WS1
(or a WS5-proposed migration reviewed by WS1), so that revocation takes effect
on the next request. The credential format and the wire contract do not
change.

## 3. Request

### Endpoints

| Method and path                                  | Purpose                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `GET /api/knowledge/v1/venues/{venueId}/answers` | Current answers for up to 20 questions at one venue.                                              |
| `GET /api/knowledge/v1/meta`                     | What this credential may read: venues, audiences, purposes, questions, supported schema versions. |

Every other method on these paths is `405 method_not_allowed`. Paths are
public to the proxy (they are not under `/staff`, `/manager` or `/admin`), so
the proxy never redirects a reader request to sign-in.

### Parameters for `answers`

| Parameter       | Where  | Required | Rules                                                                                                                                                                    |
| --------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `venueId`       | path   | yes      | A venue UUID. Names and slugs are never accepted, so a similar name cannot select another venue.                                                                         |
| `keys`          | query  | yes      | Comma-separated question keys, each matching `^[a-z0-9_]{1,40}$`. 1 to 20 distinct keys. Duplicates are an error. Order in the response follows this list.               |
| `audience`      | query  | yes      | One audience the credential holds. v1 accepts `internal`.                                                                                                                |
| `purpose`       | query  | yes      | One purpose the credential holds. v1 purposes: `operations_lookup` (an internal tool answering a guest or staff question) and `pilot_verification` (programme readback). |
| `schema`        | query  | yes      | The response schema the consumer understands, `MAJOR.MINOR`, for example `1.0`. The major must equal the path major.                                                     |
| `If-None-Match` | header | no       | An earlier `ETag`. When nothing in the requested answers changed, the reader answers `304` with no body.                                                                 |

Unknown query parameters are an error (`400 invalid_request`), so a typo can
never widen or silently change a query. The whole URL is limited to 2,048
bytes. There is no request body.

Purposes and audiences are both checked against the credential. The audience
decides which fields may appear (section 7). The purpose is recorded with every
read and must be one the consumer was registered for; it does not widen
fields.

### Example

```http
GET /api/knowledge/v1/venues/0f8f6b2e-1111-4111-8111-111111111111/answers?keys=step_free_entrance,guest_wifi&audience=internal&purpose=operations_lookup&schema=1.0
Authorization: Bearer nlr_ops-desk_<secret>
```

## 4. Response

A successful request returns `200` with `Content-Type: application/json`,
`Cache-Control: private, no-store`, an `ETag` for the snapshot, and an
`X-Request-Id`.

```json
{
  "schema": "1.0",
  "venue": { "id": "0f8f6b2e-1111-4111-8111-111111111111" },
  "audience": "internal",
  "purpose": "operations_lookup",
  "snapshot": {
    "readAt": "2026-11-20T10:15:02.120Z",
    "etag": "\"k1-3f9a…\""
  },
  "answers": [
    {
      "key": "step_free_entrance",
      "questionVersion": 1,
      "status": "available",
      "value": { "type": "yes_no_na", "answer": "yes" },
      "summary": "Level entrance through the car park door.",
      "conditions": [
        { "kind": "limitation", "text": "The front door has one step." }
      ],
      "provenance": {
        "sourceKind": "staff_observation",
        "contributionId": "6c1e…",
        "confirmation": null,
        "evidence": { "photos": 2, "videos": 0 }
      },
      "revision": 4,
      "freshness": {
        "savedAt": "2026-11-18T14:02:11Z",
        "observedAt": null,
        "nextCheckDue": null,
        "state": "unrated"
      },
      "unavailable": null
    },
    {
      "key": "guest_wifi",
      "questionVersion": 1,
      "status": "unavailable",
      "value": null,
      "summary": null,
      "conditions": [],
      "provenance": null,
      "revision": 2,
      "freshness": null,
      "unavailable": { "reason": "stale", "detail": "recheck_requested" }
    }
  ]
}
```

### Answer fields

| Field             | Meaning                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `key`             | The question key, as requested.                                                                                                                                                                                                                                                                                                                                                                         |
| `questionVersion` | The question definition version the answer was given under (today `amenity_submissions.template_version`).                                                                                                                                                                                                                                                                                              |
| `status`          | `available` or `unavailable`. Nothing else.                                                                                                                                                                                                                                                                                                                                                             |
| `value`           | Present only when available. v1 type `yes_no_na` with `answer` one of `yes`, `no`, `not_applicable`. Unknown is never a value; it is an unavailable reason (below), so a consumer cannot mistake it for No.                                                                                                                                                                                             |
| `summary`         | The finding text of the selected contribution, when the audience allows staff-written text for this question (section 7). Otherwise `null`.                                                                                                                                                                                                                                                             |
| `conditions`      | Limitations and reasons that qualify the answer, each `{ kind, text }` with `kind` one of `limitation` or `reason`. Empty when none, or when the audience does not allow staff-written text for this question. B03 adds structured conditions as new `kind` values.                                                                                                                                     |
| `provenance`      | Where the answer came from, with no staff personal data: `sourceKind` (`staff_observation`, `manager_observation`, `legacy_fact`, later `external_source`), the opaque `contributionId`, `confirmation` (`null`, or `{ authority, savedAt }`, where `authority` is a role such as `venue_manager`, never a person, and `savedAt` is when the confirmation was saved, section 5.4), and evidence counts. |
| `revision`        | The answer revision for this venue and question. It only ever increases, including when an answer becomes unavailable. A consumer holding a higher revision must never replace it with a lower one.                                                                                                                                                                                                     |
| `freshness`       | `savedAt` (when the answer was saved in NabaLens; not an observation time), `observedAt` (only an explicitly recorded observation time, otherwise `null`; never filled from a save time), `nextCheckDue` (or `null` until a freshness policy exists), and `state`: `current`, `due_soon` or `unrated` (no policy yet). Section 5.4 defines these times. Expired answers are never `available`.          |
| `unavailable`     | `null` when available; otherwise `{ reason, detail }`.                                                                                                                                                                                                                                                                                                                                                  |

Provenance never contains user IDs, names, emails, avatars, job titles,
assignee details, manager notes, Wi-Fi test notes, file names, storage paths,
media URLs or asset IDs. Evidence is counted, not linked. Linked derivatives
arrive with use grants in B05 and B06.

### Unavailable reasons

An unavailable answer has no `value`, `summary` or `conditions`, so a consumer
cannot present a stale or unconfirmed answer as current. It keeps `key`,
`questionVersion` (when known) and `revision`, so a newer unavailable state
supersedes an older available one.

| Reason                | Meaning                                                                                              | `detail` values (v1)                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `unknown`             | No answer is established.                                                                            | `not_checked`, `unable_to_establish`, `not_enabled`              |
| `not_confirmed`       | A contribution exists, but the confirmation this question requires is pending or was declined.       | `pending`, `declined`                                            |
| `stale`               | The answer expired at read time, or a recheck was requested.                                         | `expired`, `recheck_requested`, `evidence_lost`                  |
| `disputed`            | Supported sources conflict and no resolution has been made.                                          | `conflict`                                                       |
| `withdrawn`           | The answer, its confirmation or its evidence was withdrawn.                                          | `answer_withdrawn`, `confirmation_revoked`, `evidence_withdrawn` |
| `not_permitted`       | The credential, audience or purpose may not read this question. Nothing about its state is revealed. | none                                                             |
| `unsupported_version` | The answer uses a question version or value type newer than the declared `schema` can represent.     | none                                                             |
| `venue_not_found`     | Used only as the request-level error below; never inside `answers`.                                  | none                                                             |

When several reasons apply, the first in this order wins: `not_permitted`,
`unsupported_version`, `withdrawn`, `disputed`, `stale`, `not_confirmed`,
`unknown`. `not_permitted` comes first so that a refused question reveals
nothing else, not even its revision (its `revision` is `null`).

Consumers must treat an unrecognised `reason` or `detail` as unavailable. New
reasons may be added within v1.

## 5. Source of answers

### 5.1 One resolver

There is exactly one resolver for current answers. WS1 owns it, names it, and
defines how it combines `venue_amenity_checks`, `amenity_submissions`, legacy
`venue_amenity_facts` and any new contribution or confirmation records. The
reader calls that resolver and nothing else.

- The reader never reads `venue_amenity_checks.answer`,
  `venue_amenity_checks.progress`, `amenity_submissions` or
  `venue_amenity_facts` directly, not even as a fallback.
- Until the resolver exists, the reader is not enabled. There is no interim
  query over the amenity tables.
- The resolver returns one result per venue and question, already reduced to
  the states in section 4, with its revision, from one snapshot.
- The resolver returns only columns the reader may expose. The reader then
  applies the audience allowlist (section 7) again when it builds the response.
  It never adds a field the resolver did not return, and it drops any field the
  allowlist does not name.

### 5.2 Existing app reads are not reused

The reader has its own allowlisted read path. It never calls the RPCs and
server helpers that serve the app's screens: they are built for signed-in
staff and managers and return more than a consumer may see.

In particular, it never calls `amenity_check_submissions`. That function
returns Wi-Fi test notes (`internal_metadata`) to the venue's manager and to the
submitter. It also returns the free-text `finding` and `limitations`, the
submitter's ID and their display name to every reader of the check. The same
rule covers the `lib/server/amenities` reads and views (including `wifiFrom`
and the check detail loaders) and any other screen-facing query.

### 5.3 Existing guest_wifi evidence is not publishable

The capture form asks staff to confirm that the Wi-Fi password and join QR
code are covered (`p_redaction_confirmed`), but the database never stored that
confirmation. No existing `guest_wifi` submission can prove its evidence was
redacted.

- Every `guest_wifi` answer saved before redaction proof is stored is **not
  publishable**. For the `public` audience, and for any audience whose rules
  require publishable content, the reader returns it as `not_permitted`.
- For the `internal` audience, v1 returns only the value (`yes`, `no`,
  `not_applicable`) and evidence counts: no staff-written text, no Wi-Fi test
  notes and no evidence links. This applies to every `guest_wifi` answer
  (section 7).
- A `guest_wifi` answer can become publishable only after WS1 stores redaction
  proof with new submissions, the resolver reports that proof, and the
  public-use rules approve the field. Old submissions never become publishable
  through a backfill that assumes the tick was given.

### 5.4 Save times are not observation times

`answered_at` on a check, `created_at` on a submission and `confirmed_at` on a
legacy fact record when a person saved something in NabaLens. None of them is
the time anyone looked at the venue. The reader names them for what they are:

| Reader field                      | Source today (through the resolver)                                                                                       | Meaning                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `freshness.savedAt`               | The selected contribution's save time (`amenity_submissions.created_at`, which `venue_amenity_checks.answered_at` copies) | When the answer was saved.                                           |
| `provenance.confirmation.savedAt` | The confirmation's save time (for a legacy fact, `venue_amenity_facts.confirmed_at`)                                      | When the confirmation was saved.                                     |
| `freshness.observedAt`            | Only an explicitly recorded observation time                                                                              | When the venue was observed. `null` today for every existing record. |

- `observedAt` is never filled from a save time, a migration time or a Wi-Fi
  test date.
- Consumers must not present `savedAt` as "observed on" or "checked on".
  Suitable wording is "saved in NabaLens on".
- A freshness policy (B03-05) may use `savedAt` to decide when a recheck is
  due. It reports that as `nextCheckDue`, never as an observation.

### 5.5 Expected resolver output for today's data

WS1 owns this mapping. It is listed so the reader's tests have expected
results; the reader does not compute it.

| Today                                                     | Reader result                                                                                               |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| No `venue_amenity_checks` row, or the check is `archived` | `unknown` / `not_enabled`                                                                                   |
| `answer = 'to_check'`, progress `needs_capture`           | `unknown` / `not_checked`                                                                                   |
| B01-03 Unknown outcome                                    | `unknown` / `unable_to_establish`                                                                           |
| Progress `complete` with a current submission             | `available`, unless WS1 marks the question as needing confirmation and none exists (`not_confirmed`)        |
| Progress `needs_recheck` after a reopen                   | `stale` / `recheck_requested`                                                                               |
| Progress `needs_recheck` after `evidence_lost`            | `stale` / `evidence_lost`                                                                                   |
| Legacy `venue_amenity_facts` rows                         | Used by the resolver only through WS1's explicit legacy mapping (B03-06). Until then they change no answer. |

`revision` is the resolver's answer revision. Until WS1 defines it, the
expected value is `venue_amenity_checks.revision`, which rises on every
submission, reopen and archive.

## 6. Errors

Request-level failures return a JSON error body and no `answers`:

```json
{
  "error": {
    "code": "rate_limited",
    "message": "Too many requests for this consumer. Try again later.",
    "requestId": "c0a8…",
    "retryAfterSeconds": 12
  }
}
```

| HTTP | `code`                | When                                                                                                                                                            |
| ---- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400  | `invalid_request`     | Missing, malformed, duplicated or unknown parameters; too many keys; a key that is not in the question registry.                                                |
| 400  | `unsupported_version` | The `schema` major differs from the path, or the minor is newer than the server supports. The body lists `supported` versions.                                  |
| 401  | `unauthenticated`     | No credential, a malformed, unknown, expired or revoked credential, or a disabled consumer. Sent with `WWW-Authenticate: Bearer`. The message never says which. |
| 403  | `forbidden`           | A valid credential that does not hold the requested audience or purpose.                                                                                        |
| 404  | `venue_not_found`     | The venue ID does not exist, is inactive, has no knowledge enabled, or is outside the credential's venues. These are deliberately indistinguishable.            |
| 405  | `method_not_allowed`  | Any method other than `GET` or `HEAD`.                                                                                                                          |
| 414  | `request_too_large`   | The URL is over 2,048 bytes.                                                                                                                                    |
| 429  | `rate_limited`        | Over the consumer's rate or concurrency bound. Sent with `Retry-After`.                                                                                         |
| 503  | `reader_unavailable`  | The reader is switched off, or its data source did not answer within the time bound. Sent with `Retry-After` when a retry may help.                             |
| 500  | `internal_error`      | Anything else. The message is generic; details stay in server logs under the request ID.                                                                        |

Errors are never cached (`Cache-Control: private, no-store`). Error messages
never echo credentials, parameter values, venue names or data.

Question-level problems are not errors: a permitted request for a question with
no usable answer returns `200` with that answer unavailable.

## 7. Privacy allowlist

The reader builds every response from an explicit allowlist per audience and
question. Fields are added to output only when listed. It never serialises a
database row, and it never selects excluded columns in the first place.

### Never in v1 output, for any audience

- Credentials of any kind: Wi-Fi passwords or network keys, join QR content,
  door codes, alarm codes, booking or admin logins.
- Staff personal data: user IDs, names, emails, avatars, job titles, work
  focus, venue history, assignment, and who submitted, confirmed or reopened.
- Internal operational notes: check `notes`, reopen and recheck reasons,
  event `reason` and `detail`.
- Wi-Fi test notes (`amenity_submissions.internal_metadata`: test spot, test
  date, speeds). Today only the submitter, the venue's manager and admins may
  see them.
- Private originals, asset IDs, storage paths, signed URLs and file names.
- Idempotency keys and raw event history.
- Anything from the app's screen-facing reads, such as
  `amenity_check_submissions` (section 5.2).

### The Wi-Fi password

NabaLens does not store the guest Wi-Fi password today. The capture rule for
`guest_wifi` requires staff to cover the password and join QR code, and a check
can be reopened for `credentials_visible`. v1 therefore has no field that could
carry it. Existing `guest_wifi` evidence has no stored redaction proof, so those
answers are not publishable (section 5.3).

The password never appears in v1 output. It could be added only if WS1's
approved audience rules (B00-04) name an internal audience that may receive it.
That would also need a new stored field with its own access rules, a new
schema minor, a separate field that consumers must opt into, and a review. It
can never be part of the `public` audience.

### Staff-written text

`summary` and `conditions` are staff-written and unreviewed. For the
`internal` audience they are returned for `onsite_parking`,
`step_free_entrance` and `guest_toilets`. For `guest_wifi`, and for any
question WS1 marks as credential-sensitive (today `REDACTION_CONFIRM_KEYS`),
they are always omitted, because free text could contain the password.
The `public` audience will receive no staff-written text unless WS1's
public-use rules approve a reviewed field for it.

Until WS1's audience rules are approved, the reader applies exactly this
allowlist and nothing wider.

### Logs

Each request logs the request ID, consumer ID, audience, purpose, venue ID,
requested keys, status code, the revision returned per key, and the duration.
Logs never contain the credential, its digest, response content or
staff-written text. Retention follows the B00-04 retention rules.

## 8. Bounds

| Bound                            | v1 value                                                                                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Venues per request               | 1                                                                                                                                            |
| Keys per request                 | 1 to 20                                                                                                                                      |
| URL length                       | 2,048 bytes                                                                                                                                  |
| Request body                     | None accepted                                                                                                                                |
| Staff-written text per answer    | `summary` up to 2,000 characters; in v1 at most 2 conditions (`limitation` up to 2,000 and `reason` up to 500 characters), the stored limits |
| Response size                    | At most 1 MiB, which the limits above guarantee even when every character is escaped in JSON; a four-key pilot read is a few KiB             |
| Rate per consumer                | 60 requests per minute, bursts of 10                                                                                                         |
| Concurrent requests per consumer | 4                                                                                                                                            |
| Server time bound                | 5 seconds, then `503 reader_unavailable`                                                                                                     |

The guarantee is the behaviour (`429` with `Retry-After`), not the counter's
implementation. The pilot may enforce rates per server instance; a shared
limiter is required before B06 opens the reader to the website or MCP.

## 9. Consistency and caching

- All answers in one response come from one database snapshot, so two keys
  never mix states from different moments.
- Freshness is evaluated at read time. A late or missed scheduler run can never
  keep an expired answer `available`.
- `ETag` is a digest of the venue, audience, schema and each answer's key,
  status, reason and revision. `If-None-Match` returns `304` when it matches.
- `Cache-Control: private, no-store` on every response. Shared caches never
  hold internal answers.
- `revision` never decreases for a venue and question, including after
  corrections, withdrawals or data repair. A consumer that already holds a
  higher revision keeps it.

## 10. Versioning

- The path carries the major version (`/v1/`). The `schema` parameter carries
  the minor version the consumer understands.
- Within v1, changes are additive: new optional fields, new `reason` and
  `detail` values, new `conditions` kinds and new `sourceKind` values. Consumers
  must ignore unknown fields and treat unknown reasons as unavailable.
- A new value type (for example B03 structured schedules) is served only to
  consumers that declare a schema minor that includes it. Older consumers get
  `unsupported_version` for that answer, never a misread value.
- A breaking change gets a new major path. Both majors run in parallel until
  every registered consumer has moved; the registry records which majors each
  consumer uses.
- `meta` lists the supported `schema` versions so consumers can check before
  they read.

## 11. Compatibility with the public projection and the website snapshot (B06)

The v1 reader is the base that B06 hardens. These rules keep the step
additive:

- **One answer shape.** The public projection reuses this answer object with a
  narrower allowlist under the `public` audience. It is computed on the server
  for that audience. It is never produced by a consumer filtering internal
  output.
- **Revisions and tombstones.** B06 publication revisions are built from the
  answer `revision` defined here. Because an unavailable answer keeps its rising
  revision, a withdrawal is itself a revision. A delayed older publish cannot
  replace it, and the website can store it as a tombstone.
- **Snapshot validity.** The website keeps an approved snapshot only within a
  validity period. An expired snapshot is not a confident current answer, and
  fallback never restores content that a later revision withdrew. The reader's
  read-time freshness and `nextCheckDue` give the website what it needs to set
  that period.
- **Website consumer.** The Old Crown website would read with its own
  credential, scoped to the Old Crown venue ID only, audience `public`, purpose
  `website_publication`. The venue ID crosswalk comes from WS1's B00-03
  identity work; the website's name-based identity note is never used to pick a
  venue.
- **Agent surfaces.** The website's `agent-data.ts` is the single source for its
  JSON API, MCP tools and `llms.txt` (`AGENT_API_VERSION` `1.0.0`). B06-04 adds
  knowledge-backed fields there, additively, as camelCase JSON like the
  existing `venue.json` keys. An unavailable answer maps to explicit wording
  such as "not confirmed" rather than a guess.
- **Caching.** The website's own JSON is publicly cached (`venue.json` and
  `hours.json` use `s-maxage=300`). That caching applies to the website's
  approved snapshot, never to this reader, which stays `private, no-store`.
  The proposed five-minute withdrawal objective is measured at the website in
  B06.
- **Registry.** B06-01's consumer registry extends section 2's registry with
  allowed question families, the authoritative source per website field, and
  delivery settings. The credential format does not change.

## 12. Verification required for B01-05

These map to plan verification families V01, V02, V11 and V12. All are
deterministic tests unless stated.

- **Credentials (V01, V12):** missing, malformed, wrong, expired, revoked
  and disabled-consumer credentials each get the same `401`; a credential in
  the query string is refused; a valid session cookie without a bearer is `401`;
  a credential lacking the audience or purpose gets `403`.
- **Venue isolation (V02):** an unknown venue ID, an inactive venue, a venue
  outside the credential and a venue with a similar name all get the same
  `404 venue_not_found`; the same question at two venues returns each venue's
  own answer.
- **Bounds (V12):** 0 keys, 21 keys, duplicate keys, a malformed key, an
  unknown parameter, an over-long URL and a POST each get the documented error;
  rate and concurrency limits return `429` with `Retry-After`.
- **States (V12):** available, each `unknown` detail, `not_confirmed`, `stale`
  (reopen, evidence lost, read-time expiry with a stopped scheduler), `disputed`,
  `withdrawn`, `not_permitted` (revision hidden) and `unsupported_version`
  each return exactly the documented shape. Revision never decreases across
  submit, reopen and resubmit. One response is one snapshot.
- **Privacy (V11):** for every fixture state, the serialised response contains
  exactly the allowlisted fields. Negative assertions over the whole body cover
  seeded staff names, emails and user IDs, check notes, reopen reasons, Wi-Fi
  test notes, a planted password-like string in `guest_wifi` free text, asset
  IDs and storage paths. Logs are checked for the credential and for response
  content.
- **Single source (V11, V12):** the reader's data access goes through the
  resolver only. A static test fails if `app/api/knowledge/**` or its helpers
  reference `amenity_check_submissions`, `venue_amenity_facts`,
  `venue_amenity_checks` or `amenity_submissions` directly.
- **Wi-Fi redaction (V11):** an existing `guest_wifi` answer is `not_permitted`
  for any audience that requires publishable content, and returns only the
  value and evidence counts for `internal`.
- **Timestamps (V12):** fixtures with different save, confirmation and
  migration times return them only under `savedAt` and
  `confirmation.savedAt`; `observedAt` stays `null` unless an observation time
  was recorded.
- **Versions (V12):** `schema=2.0` on `/v1/`, a future minor and a question
  version newer than the declared schema.
- **Fixture journey (B01 step 6 to 9):** after a confirmation, reopen, conflict
  or evidence withdrawal in the fixture journey, the next read shows the new
  state and a higher revision.

A real internal read against the pilot venue (B01 exit gate) is separate live
evidence. It needs the coordinator's authorisation for the production
credential, and it is recorded apart from these tests.

## 13. Open points for WS1 and the owner

These are needed before B01-05 is implemented. The reader applies the safe
default shown until each is resolved.

| Point                                                                                                                 | Safe default until resolved                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The single resolver (WS1): its name, columns, revision and snapshot guarantee, including how it combines legacy facts | None. The reader is not enabled until the resolver exists; it never falls back to reading the amenity tables (section 5.1).                                         |
| Which v1 questions need confirmation before they are `available`                                                      | None of the four core keys require it in v1, matching today's "valid evidence completes the check" rule. Dog policy and similar policy questions stay fixture-only. |
| Redaction proof stored with new `guest_wifi` submissions (WS1)                                                        | Every existing `guest_wifi` answer is not publishable (section 5.3).                                                                                                |
| Audience rules (B00-04): audiences, staff-written text, Wi-Fi details                                                 | One audience, `internal`, with the allowlist in section 7.                                                                                                          |
| Freshness policy per question                                                                                         | No expiry (`unrated`); only reopen and evidence loss make an answer `stale`.                                                                                        |
| Named internal reader operator who holds and rotates credentials (X4)                                                 | The coordinator issues the pilot credential; no production credential is created without authorisation.                                                             |
