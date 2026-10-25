import assert from 'node:assert/strict';
import test from 'node:test';
import { isTeacherAuthenticated, loginTeacher, requireTeacher } from '../lib/server/teacher-auth.ts';

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

void test('teacher code is verified against shared hash, with an expiring HttpOnly session', async () => {
  const prior = { ...process.env };
  const previousFetch = globalThis.fetch;
  process.env.SCHOOL_YEAR = '115';
  process.env.TRANSLATION_SESSION_SECRET = 's'.repeat(32);
  process.env.SUPABASE_URL = 'https://database.example.test';
  process.env.SUPABASE_SECRET_KEY = 'service-key';
  const code = 'a-secure-teacher-code';
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveBits']);
  const hashBytes = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 }, key, 256);
  let changedAt = new Date(Date.now() - 10_000).toISOString();
  globalThis.fetch = async () => Response.json([{ access_code_hash: `v2.${base64url(salt)}.${base64url(new Uint8Array(hashBytes))}`, updated_at: changedAt }]);
  try {
    const request = new Request('https://translation.example.test/');
    await assert.rejects(loginTeacher(request, 'wrong-password'));
    assert.equal(await isTeacherAuthenticated(request), false);
    const cookie = await loginTeacher(request, code);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    const authorized = new Request('https://translation.example.test/', { headers: { cookie: cookie.split(';')[0] } });
    assert.equal(await isTeacherAuthenticated(authorized), true);
    assert.equal((await requireTeacher(authorized)).email, 'teacher:translation-studio');
    changedAt = new Date(Date.now() + 1_000).toISOString();
    assert.equal(await isTeacherAuthenticated(authorized), false);
  } finally {
    globalThis.fetch = previousFetch;
    process.env = prior;
  }
});
