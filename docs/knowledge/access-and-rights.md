# Knowledge access, rights and confirmation rules

Status: B00-04 draft for review. Owner: WS1 knowledge domain, with WS0
(product), WS4 (assets) and WS6 (verification). Source baseline: `f8c49430`.

Every rule marked **owner to confirm** is a default taken from the
programme's recommended decisions (plan §2). It applies until the named owner
changes it. Named people for each authority are external dependency X4 and
remain open.

## 1. Audiences

| Audience                     | Who                                                                                                                       | How identified                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Staff                        | An active `staff` account whose current venue is the slot's venue                                                         | Re-read from `profiles` on every call (`private.active_staff_venue_id`)                                                                  |
| Manager                      | The venue's effective manager: a manager account with an open grant, or a staff account with a transitional grant         | `private.can_manage_venue`, re-checked on every call                                                                                     |
| Admin                        | An active admin                                                                                                           | `private.is_active_admin`                                                                                                                |
| Internal reader (`internal`) | A server-side program operated by Lapen Inns, with a service credential scoped to venues, questions, audience and purpose | WS5 registry (`internal-reader-api.md` §2). Operator: **owner to confirm (X4)**; until then the coordinator issues the pilot credential. |
| Public (`public`)            | Guests, websites, search and AI agents                                                                                    | **No access in B01.** Reserved for B06.                                                                                                  |

A deactivated account, or one whose role or venue changed, loses the access it
held through that role or venue at once. That is existing behaviour, and B01
keeps it (exception: own contribution history, §5).

## 2. What each audience may see and do (B01 working-list slots)

| Capability                                            | Staff                                                                                                  | Manager         | Admin           | Internal reader                           | Public |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------- | --------------- | ----------------------------------------- | ------ |
| Send a finding, Unknown or change report              | Yes, own venue                                                                                         | Yes, own venue  | Yes             | No                                        | No     |
| See slot status and value                             | Yes, own venue                                                                                         | Yes             | Yes             | Yes, through the resolver allowlist       | No     |
| Current answer's finding, limitations and reason text | Yes, except `guest_wifi`                                                                               | Yes             | Yes             | Yes, except `guest_wifi`                  | No     |
| Who answered, confirmed or reopened (names)           | Own contributions; the assignee's first name; the name of whoever answered a question assigned to them | Yes             | Yes             | No. Roles only (`venue_manager`, `admin`) | No     |
| Wi-Fi test notes (test spot, date, speeds)            | Own submission only, while at the venue                                                                | Yes             | Yes             | No                                        | Never  |
| Wi-Fi password or join QR content                     | Never collected                                                                                        | Never collected | Never collected | Never                                     | Never  |
| Evidence media (thumbnails, previews, video)          | Own uploads; others' only as today's gate allows (submitter while at the venue)                        | Yes             | Yes             | Counts only                               | No     |
| Confirm, decline, revoke, reaffirm                    | No                                                                                                     | Yes, own venue  | Yes             | No                                        | No     |
| Decline a change report, or reopen                    | No                                                                                                     | Yes, own venue  | Yes             | No                                        | No     |
| Enable or disable a venue's working list              | No                                                                                                     | No              | Yes             | No                                        | No     |
| Change confirmation rules                             | Migration only, after owner approval                                                                   |                 |                 |                                           |        |
| Own contribution history                              | Yes, including after a transfer (§5)                                                                   | Yes             | Yes             | No                                        | No     |

Staff knowledge views show other people's pending findings as a count,
without names. The two exceptions are the assignee's first name, so people can
coordinate, and the name of whoever answered a question assigned to the
reader, so the assignee knows why it closed. **Owner to confirm.** The new
unassigned access is wider than today's, so it starts narrow.

## 3. Internal audience allowlist per key

The resolver's reader entry point returns only these fields, and the reader
applies the same allowlist again (`internal-reader-api.md` §5.1 and §7).

| Field                                                               | `onsite_parking` | `step_free_entrance` | `guest_toilets` | `guest_wifi` |
| ------------------------------------------------------------------- | ---------------- | -------------------- | --------------- | ------------ |
| Status, reason and detail                                           | Yes              | Yes                  | Yes             | Yes          |
| Value (`yes`, `no`, `not_applicable`)                               | Yes              | Yes                  | Yes             | Yes          |
| Question version, answer revision                                   | Yes              | Yes                  | Yes             | Yes          |
| Finding as `summary`                                                | Yes              | Yes                  | Yes             | **No**       |
| Limitations and reason as `conditions`                              | Yes              | Yes                  | Yes             | **No**       |
| Source basis (staff, venue manager or admin; null before B01)       | Yes              | Yes                  | Yes             | Yes          |
| Contribution ID (opaque)                                            | Yes              | Yes                  | Yes             | Yes          |
| Confirmation authority role, self-confirmed flag, saved time        | Yes              | Yes                  | Yes             | Yes          |
| Evidence counts (photos, videos available)                          | Yes              | Yes                  | Yes             | Yes          |
| Redaction proof (`recorded`, `not_recorded`)                        | —                | —                    | —               | Yes          |
| `savedAt`, `observedAt` (always null in B01), `nextCheckDue` (null) | Yes              | Yes                  | Yes             | Yes          |
| Wi-Fi test notes                                                    | —                | —                    | —               | **No**       |
| Names, user IDs, notes, asset IDs, URLs, idempotency keys           | No               | No                   | No              | No           |

`guest_wifi` free text is excluded because staff could type the password into
it. This follows `REDACTION_CONFIRM_KEYS` in `lib/amenities/contract.ts`:
any key added there is excluded the same way.

## 4. Wi-Fi details

- NabaLens never collects the guest Wi-Fi password or the join QR content.
  The capture brief requires both to be covered in photos and video.
- From B01, new `guest_wifi` submissions store the redaction tick in a new
  `amenity_submissions.redaction_confirmed` column, and contributions store
  it in `knowledge_contributions.redaction_confirmed`. Existing rows have no
  stored proof. The resolver reports them as `not_recorded`, and no backfill
  may assume the tick was given.
- A `guest_wifi` answer without recorded proof may never be used for any
  audience whose rules require publishable content. For `internal` it returns
  value and counts only (§3), whether or not proof is recorded.
- Wi-Fi test notes stay visible to the submitter (while at the venue), the
  venue's manager and admins, as today. They are never in reader output.
- If a later decision wants the password itself available to an internal
  audience, that needs: a new stored field with its own access rules, a named
  audience, an opt-in reader field, a new schema minor and review. It can never
  be public.

`guest_wifi` is sensitive **data**, not a sensitive **claim**: whether guest
Wi-Fi exists is directly observable, so its value needs no confirmation (§6).
The sensitivity is handled by the redaction proof, text exclusion and
test-note rules above.

## 5. Contributions after a transfer

Today a transferred person loses read access to their old-venue submissions
(`private.amenity_can_read` requires active staff at the venue).

**Default (owner to confirm):** an active person keeps **read-only** access to
their own contributions after a venue transfer or role change. That covers
the answer they gave, their own text, the save time and the outcome
(adopted, awaiting confirmation, declined, superseded, reopened). It
excludes:

- evidence media (the existing media gate stays venue-bound);
- Wi-Fi test notes;
- the old venue's current answer and other people's work;
- any write.

A deactivated account keeps nothing. This is served by a new own-history read
(`knowledge_my_contributions`), not by widening `amenity_can_read`.

Reasons: B01-06 and B08 need people to see what they contributed and why their
recognition changed, and their own words carry no new venue exposure. The menu
rule that lets old-venue assets be labelled after a transfer is a write and is
not copied.

## 6. Confirmation rules

Plan default: straightforward evidence-backed observations complete
automatically. Policies, sensitive claims and conflicts need a person with
authority.

| Key                                             | Claim type                       | Confirmation required                                                | Who may confirm  | Self-confirmation                                                        | Reason                                                                                                                                                 |
| ----------------------------------------------- | -------------------------------- | -------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `onsite_parking`                                | Observation                      | None                                                                 | —                | —                                                                        | Directly observable with photo evidence. Charges and restrictions are staff text, internal only; they need authority before any public use (B03, B06). |
| `step_free_entrance`                            | Sensitive accessibility claim    | **Venue manager**                                                    | Manager or admin | Allowed, recorded as self-confirmed                                      | Guests rely on it for physical access. An entrance video supports, but does not certify, the claim (plan B03-02).                                      |
| `guest_toilets`                                 | Observation                      | None                                                                 | —                | —                                                                        | Directly observable.                                                                                                                                   |
| `guest_wifi`                                    | Observation (sensitive data, §4) | None                                                                 | —                | —                                                                        | Availability is observable. Sensitivity is about data, not the claim.                                                                                  |
| `dogs_inside`, `dogs_outside` (fixture only)    | Policy                           | **Venue manager**                                                    | Manager or admin | Allowed: a manager's own statement of house policy is the authority      | A photo never establishes a policy (`venue_amenity_facts` comment; catalogue brief "have the duty lead confirm").                                      |
| `sports_screen` (disputed-service fixture only) | Observation with conflict        | None for a single finding; **manager or admin** resolves any dispute | Manager or admin | n/a                                                                      | Tests conflict handling: a current answer plus a contradicting change report.                                                                          |
| Any key, any conflict                           | Conflict                         | Manager or admin resolves                                            | Manager or admin | A manager may resolve a dispute about their own answer, recorded as self | Plan §2: conflicts need defined authority.                                                                                                             |

All of these are **owner to confirm**. `step_free_entrance` deliberately
differs from WS5's interim assumption that none of the four core keys needs
confirmation. Its reason: it is the one sensitive claim on the working list,
and it exercises confirmation on a real pilot key rather than only on
fixtures.

Rules that apply to every confirmation:

- Staff accounts never confirm. A staff account with a transitional manager
  grant confirms as a manager.
- A confirmation binds to one assertion ID and the check revision shown.
  If either has changed, it is refused as stale.
- Self-confirmation is a confirmation by the assertion's author. It is allowed
  only where the rule says so, and is always recorded and exposed
  (`self_confirmed`).
- A confirmation stays valid after the confirming person loses their grant or
  leaves. The decision records the authority basis at the time.
- Legacy `venue_amenity_facts.confirmed_at`, task completion and automatic
  completion never count as a confirmation.

## 7. Automatic completion of unassigned findings

**Default (owner to confirm):** a staff member's finding on an unassigned,
unanswered (or reopened) working-list slot whose rule needs no confirmation
completes automatically. It becomes the current answer and is credited under
the existing rule, exactly like an assigned finding. Everything else that is
spontaneous is a proposal and earns no credit until adopted (B01 design §3,
§4). The alternative, making every spontaneous finding a proposal, is one
rule flag (`unassigned_auto_complete`) and needs no code change.

## 8. Public-use rule

Nothing is public in B01. From B06, a field may reach the `public` audience
only when all of these hold:

1. The slot is `available` through the resolver.
2. The question's rule version lists the field as publishable.
3. A use grant for that destination and field is in force (B05-02, B06-01),
   granted by the public-use granter. **Granter: admin by default, owner to
   confirm (X4).**
4. Media appears only as an approved derivative under its own grant (B05-03).
5. For `guest_wifi` (and any `REDACTION_CONFIRM_KEYS` key), the current
   submission has redaction proof recorded as given.
6. Staff-written text appears only as a reviewed field approved for public
   use.

Never public: credentials of any kind, staff personal data and attribution,
internal notes and reasons, Wi-Fi test notes, original files, asset IDs and
URLs, unreviewed staff text.

## 9. Retention and sensitive data

| Data                                          | Sensitivity                                | Retention default (owner to confirm; B05 sets policy)                                         |
| --------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Submissions, contributions, decisions, events | Staff attribution (internal)               | Kept while the venue exists; append-only.                                                     |
| Staff free text                               | May contain personal or operational detail | As above. Never public unless reviewed.                                                       |
| Wi-Fi test notes                              | Internal operational                       | Kept with the submission; access as §4.                                                       |
| Evidence media                                | May show guests, staff or credentials      | Existing media lifecycle and archive. Deleting an asset changes eligibility (B01 design §10). |
| Reader request logs                           | Consumer and venue IDs, no content         | 90 days. **Owner to confirm.**                                                                |

## 10. Freshness policy for the pilot keys

**No expiry in B01** for `onsite_parking`, `step_free_entrance`,
`guest_toilets` and `guest_wifi`. **Owner to confirm.**

- `nextCheckDue` is null and the freshness state is `unrated`.
- An answer becomes unavailable only through reopen, evidence loss or
  withdrawal, dispute, revocation, or a working-list change.
- B03-05 adds per-claim, read-time expiry and recheck work.
- `observedAt` is always null in B01: no observation time is collected, and
  none is inferred.
