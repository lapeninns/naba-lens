# RB-xx: {situation}

Copy this file to `RB-xx.md` for a full runbook. The index (`README.md`) is generated from `lib/ops/runbooks.ts`; change the entry there too, so the two agree. Plan §19 requires every field below.

| Field                         | Content                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trigger                       | The metric IDs and thresholds that lead here, or the incident that starts it                                                                            |
| Operator role                 | One owner role (OPS, PO, VM, COORD, WS1 to WS6, B09). The named person is in the owner's own record                                                     |
| First checks                  | What to read before changing anything. Never ask for media, sign-in links or secrets in a ticket                                                        |
| Steps                         | Recovery steps. Never weaken validation, bypass RLS or Storage policies, mark an unvalidated asset ready, or delete rows without their object lifecycle |
| Narrowest switch              | The smallest scope that stops harm: venue, question family, consumer, destination or job. Withdrawals keep running                                      |
| Data implications             | What the steps change, and what they never change                                                                                                       |
| Pending delivery              | What happens to revisions waiting for a consumer                                                                                                        |
| Readback that proves recovery | The observation that shows the system recovered                                                                                                         |

## Drill

- Environment: an owned isolated stack only, never production or a shared database.
- Start from the trigger state, follow the steps, end with the readback passing.
- Record under `evidence/b10-02/RB-xx/`: the stack, the source revision, the fixture, the UTC time, each step's outcome and the readback.
- A drill that cannot run (it needs a batch, a provider or a device) is outstanding with its dependency, never passed.
