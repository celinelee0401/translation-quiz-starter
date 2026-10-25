import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildSetupSql } from '../scripts/build-setup-sql.mjs';

void test('supabase/setup.sql is up to date with the migrations (run npm run build:sql)', async () => {
  const dir = new URL('../supabase/migrations', import.meta.url).pathname;
  const current = await readFile(new URL('../supabase/setup.sql', import.meta.url), 'utf8');
  assert.equal(current, buildSetupSql(dir));
});
