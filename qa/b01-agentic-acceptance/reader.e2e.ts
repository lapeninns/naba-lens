import { expect, test } from 'e2e';

import { PILOT_KEYS, readerCredential, target, world } from './fixture';

// The internal reader over real HTTP (GET /api/knowledge/v1/venues/{id}/answers)
// against the app on spare6, after the journey suite. It needs the app started
// with KNOWLEDGE_READER_ENABLED=true and the KNOWLEDGE_READER_CONSUMERS
// registry seed.ts wrote (README.md, "Reader"). Without that it is skipped,
// which the run summary reports as pending, never as a pass. Only the status,
// value, unavailable reason and confirmation fields are asserted; no response
// body is written anywhere.

type Answer = {
  key: string;
  status: string;
  value: { type: string; answer: string } | null;
  unavailable: { reason: string; detail: string } | null;
  provenance: { sourceKind: string; confirmation: { authority: string; selfConfirmed: boolean } | null } | null;
};

function read(venueId: string, keys: readonly string[], credential: string | null) {
  const query = new URLSearchParams({
    keys: keys.join(','),
    audience: 'internal',
    purpose: 'pilot_verification',
    schema: '1.0',
  });
  return fetch(`${target().app}/api/knowledge/v1/venues/${venueId}/answers?${query}`, {
    headers: credential ? { authorization: `Bearer ${credential}` } : {},
  });
}

async function answers(venueId: string, credential: string) {
  const res = await read(venueId, PILOT_KEYS, credential);
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('private, no-store');
  const body = (await res.json()) as { schema: string; venue: { id: string }; answers: Answer[] };
  expect(body.schema).toBe('1.0');
  expect(body.venue.id).toBe(venueId);
  return Object.fromEntries(body.answers.map((a) => [a.key, a]));
}

test('the internal reader returns the B01 outcomes over HTTP', async () => {
  const credential = readerCredential();
  test.skip(!credential || process.env.B01_READER_APP !== '1', 'pending: the app was not started with the seeded reader registry');
  const w = world();

  expect((await read(w.venueA.id, PILOT_KEYS, null)).status).toBe(401);

  const a = await answers(w.venueA.id, credential!);
  expect(a.guest_toilets).toMatchObject({
    status: 'available',
    value: { type: 'yes_no_na', answer: 'no' },
    unavailable: null,
    provenance: { sourceKind: 'staff_observation', confirmation: null },
  });
  expect(a.step_free_entrance).toMatchObject({
    status: 'available',
    value: { type: 'yes_no_na', answer: 'no' },
    provenance: { sourceKind: 'staff_observation', confirmation: { authority: 'venue_manager', selfConfirmed: false } },
  });
  expect(a.onsite_parking).toMatchObject({
    status: 'unavailable',
    value: null,
    unavailable: { reason: 'unknown', detail: 'unable_to_establish' },
  });
  expect(a.guest_wifi).toMatchObject({ status: 'unavailable', value: null });

  const b = await answers(w.venueB.id, credential!);
  expect(b.step_free_entrance).toMatchObject({
    status: 'available',
    value: { type: 'yes_no_na', answer: 'no' },
    provenance: { sourceKind: 'manager_observation', confirmation: { authority: 'venue_manager', selfConfirmed: true } },
  });
});
