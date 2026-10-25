import assert from 'node:assert/strict';
import test from 'node:test';

import { fromSchoolLocal, toSchoolLocal } from '../lib/school-time.ts';

void test('school local time round-trips in the configured time zone', () => {
  const date = fromSchoolLocal('2026-10-25T08:30');
  assert.equal(date?.toISOString(), '2026-10-25T00:30:00.000Z');
  assert.equal(toSchoolLocal(date!), '2026-10-25T08:30');
  assert.equal(fromSchoolLocal('2026-02-30T08:00'), null);
});
