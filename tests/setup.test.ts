import assert from 'node:assert/strict';
import test from 'node:test';

import { getSessionSecret } from '../lib/server/config.ts';
import { loadSetupChecks, setTeacherCode } from '../lib/server/setup.ts';

const env = {
  SCHOOL_YEAR: '115', SCHOOL_CLASSES: '701:7, 702:7', SCHOOL_NAME: '測試國中',
  SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_abcdefghijklmnopqrstuvwxyz',
  SETUP_CODE: 'my-setup-phrase',
};

function respond(map: Record<string, Response | (() => Response)>) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const hit = Object.entries(map).find(([part]) => url.includes(part));
    if (!hit) throw new Error(`Unexpected ${url}`);
    return typeof hit[1] === 'function' ? hit[1]() : hit[1].clone();
  }) as typeof fetch;
}

void test('setup checklist explains missing tables, wrong keys, and never echoes secrets', async () => {
  const missing = await loadSetupChecks(env, respond({ teacher_access_settings: new Response('{}', { status: 404 }) }));
  assert.equal(missing.find((c) => c.key === 'database')?.state, 'todo');
  assert.match(missing.find((c) => c.key === 'database')?.detail ?? '', /setup\.sql/);

  const wrongKey = await loadSetupChecks(env, respond({ teacher_access_settings: new Response('{}', { status: 401 }) }));
  assert.match(wrongKey.find((c) => c.key === 'database')?.detail ?? '', /secret key/);

  const ready = await loadSetupChecks(env, respond({
    teacher_access_settings: Response.json([{ updated_at: '2026-10-25T00:00:00Z' }]),
    enrollments: Response.json([]),
  }));
  assert.equal(ready.find((c) => c.key === 'teacher-code')?.state, 'ok');
  assert.equal(ready.find((c) => c.key === 'roster')?.state, 'todo');
  assert.match(ready.find((c) => c.key === 'school')?.detail ?? '', /701（7 年級）/);
  const text = JSON.stringify(ready);
  assert.ok(!text.includes(env.SUPABASE_SECRET_KEY) && !text.includes(env.SETUP_CODE));

  const noDb = await loadSetupChecks({ SCHOOL_YEAR: '115' }, respond({}));
  assert.equal(noDb.find((c) => c.key === 'database')?.state, 'todo');
  assert.equal(noDb.find((c) => c.key === 'setup-code')?.state, 'todo');
});

void test('values copied from the old example file count as not configured', async () => {
  const sample = { ...env, SUPABASE_SECRET_KEY: 'sb_secret_replace_me', SETUP_CODE: 'replace-with-your-own-phrase' };
  const checks = await loadSetupChecks(sample, respond({}));
  assert.equal(checks.find((c) => c.key === 'database')?.state, 'error');
  assert.match(checks.find((c) => c.key === 'database')?.detail ?? '', /SUPABASE_SECRET_KEY 還是範本的示範文字/);
  assert.equal(checks.find((c) => c.key === 'setup-code')?.state, 'error');
  await assert.rejects(setTeacherCode({ setupCode: 'replace-with-your-own-phrase', teacherCode: 'teacher-code-1' }, sample, respond({})),
    /示範文字/);
});

void test('teacher code can only be set with the deployment setup code', async () => {
  const prior = { ...process.env };
  Object.assign(process.env, env);
  let saved = null as unknown;
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('teacher_access_settings')) saved = JSON.parse(String(init?.body));
    return new Response(null, { status: 201 });
  }) as typeof fetch;
  try {
    await assert.rejects(setTeacherCode({ setupCode: 'wrong-phrase', teacherCode: 'teacher-code-1' }, env, fetcher), /設定碼不正確/);
    assert.equal(saved, null);
    await assert.rejects(setTeacherCode({ setupCode: env.SETUP_CODE, teacherCode: 'short' }, env, fetcher), /8–64/);
    await setTeacherCode({ setupCode: env.SETUP_CODE, teacherCode: 'teacher-code-1' }, env, fetcher);
    const row = (saved as unknown as Array<{ id: boolean; access_code_hash: string }>)[0];
    assert.equal(row.id, true);
    assert.match(row.access_code_hash, /^v2\.[\w-]+\.[\w-]+$/);
    assert.ok(!row.access_code_hash.includes('teacher-code-1'));
    await assert.rejects(setTeacherCode({ setupCode: 'x', teacherCode: 'teacher-code-1' }, { ...env, SETUP_CODE: '' }, fetcher), /SETUP_CODE/);
  } finally {
    process.env = prior;
  }
});

void test('session secret falls back to a key derived from the Supabase secret key', () => {
  assert.equal(getSessionSecret({ TRANSLATION_SESSION_SECRET: 'short' }), null);
  assert.equal(getSessionSecret({ TRANSLATION_SESSION_SECRET: 'x'.repeat(32) }), 'x'.repeat(32));
  assert.match(getSessionSecret({ SUPABASE_SECRET_KEY: 'sb_secret_abcdefghijklmnop' }) ?? '', /^translation-session-from-supabase-v1:/);
  assert.equal(getSessionSecret({}), null);
});
