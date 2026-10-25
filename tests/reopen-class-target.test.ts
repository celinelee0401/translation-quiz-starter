import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DraftTargetError, reopenPublishedTarget } from '../lib/server/draft-targets.ts';
import type { DataConfig } from '../lib/server/config.ts';

const config = {
  supabaseUrl: 'https://database.example.test', supabaseSecretKey: 'service-secret', schoolYear: '115',
} as DataConfig;
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json' },
});
const requestUrl = (resource: RequestInfo | URL) =>
  typeof resource === 'string' ? resource : resource instanceof URL ? resource.href : resource.url;
const futureLocal = (minutes: number) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(Date.now() + minutes * 60_000)).replace(' ', 'T');
const input = () => ({ quizId: 'G8-DEMO-P3', quizVersion: 1, classCode: '802',
  opensAtLocal: futureLocal(10), closesAtLocal: futureLocal(40) });

void test('reopening only one finished class preserves the target and attempt limit, with audit', async () => {
  const old = { id: '802-target', opens_at: '2026-09-29T02:05:00+00:00',
    closes_at: '2026-09-29T03:21:00+00:00', feedback_at: null,
    dashboard_visible: true, attempt_limit: 1 };
  const writes: Array<{ path: string; method: string; body: unknown }> = [];
  const fetcher = async (resource: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(requestUrl(resource));
    const path = url.pathname + url.search;
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined;
    if (body) writes.push({ path, method, body });
    if (path.includes('translation_quizzes?')) return response([{ status: 'published', grade_level: 8, score_mode: 'formal', feedback_policy: 'teacher-release' }]);
    if (path.includes('translation_quiz_targets?') && method === 'GET') return response([old]);
    if (path.includes('translation_audit_log?') && method === 'GET') return response([]);
    if (path.includes('translation_audit_log?') && method === 'POST') return response([{ id: writes.length }]);
    if (path.includes('translation_quiz_targets?') && method === 'PATCH') {
      assert.ok(path.includes('class_code=eq.802'));
      assert.ok(path.includes('id=eq.802-target'));
      assert.ok(path.includes('closes_at=eq.'));
      assert.deepEqual(Object.keys(body ?? {}).sort(), ['closes_at', 'opens_at']);
      return response([{ id: old.id, ...(body as Record<string, unknown>) }]);
    }
    throw new Error(`Unexpected ${method} ${path}`);
  };
  const saved = await reopenPublishedTarget(config, input(), 'teacher@example.test', fetcher as typeof fetch);
  assert.equal(saved.classCode, '802');
  assert.deepEqual(writes.map(item => item.method), ['POST', 'PATCH', 'POST']);
  assert.equal((writes[0].body as Array<{ action: string }>)[0].action, 'authorize-reopen-class-target');
  assert.equal((writes[2].body as Array<{ action: string }>)[0].action, 'reopen-class-target');
  assert.equal((writes[2].body as Array<{ before_data: { closes_at: string } }>)[0].before_data.closes_at, old.closes_at);
});

void test('one class can schedule retained feedback only from its new cutoff', async () => {
  const old = { id: '801-target', opens_at: '2026-09-29T02:05:00Z', closes_at: '2026-09-29T03:21:00Z',
    feedback_at: null, dashboard_visible: true, attempt_limit: 1 };
  const patches: Array<Record<string, string>> = [];
  const fetcher = async (resource: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = requestUrl(resource);
    if (path.includes('translation_quizzes?')) return response([{ status: 'published', grade_level: 8, score_mode: 'formal', feedback_policy: 'teacher-release' }]);
    if (path.includes('translation_quiz_targets?') && init?.method === 'PATCH') {
      const patched = JSON.parse(String(init.body)) as Record<string, string>;
      patches.push(patched);
      return response([{ id: old.id, ...patched }]);
    }
    if (path.includes('translation_quiz_targets?')) return response([old]);
    if (path.includes('translation_audit_log?') && init?.method === 'POST') return response([{ id: 1 }]);
    if (path.includes('translation_audit_log?')) return response([]);
    throw new Error(path);
  };
  const next = { ...input(), classCode: '801', retainFeedbackAfterClose: true };
  await reopenPublishedTarget(config, next, 'teacher@example.test', fetcher as typeof fetch);
  assert.equal(patches[0]?.feedback_at, patches[0]?.closes_at);
});

void test('active class window and permanently released feedback cannot be reopened', async () => {
  let writes = 0;
  const old = { id: '802-target', opens_at: new Date(Date.now() - 60_000).toISOString(),
    closes_at: new Date(Date.now() + 60_000).toISOString(), feedback_at: null,
    dashboard_visible: true, attempt_limit: 1 };
  const fetcher = async (resource: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (init?.body) writes++;
    const path = requestUrl(resource);
    if (path.includes('translation_quizzes?')) return response([{ status: 'published', grade_level: 8, score_mode: 'formal', feedback_policy: 'teacher-release' }]);
    if (path.includes('translation_quiz_targets?')) return response([old]);
    if (path.includes('translation_audit_log?')) return response([{ id: 1 }]);
    throw new Error(path);
  };
  await assert.rejects(reopenPublishedTarget(config, input(), 'teacher', fetcher as typeof fetch), DraftTargetError);
  assert.equal(writes, 0);
  old.closes_at = new Date(Date.now() - 60_000).toISOString();
  await assert.rejects(reopenPublishedTarget(config, input(), 'teacher', fetcher as typeof fetch), /永久發布/);
  assert.equal(writes, 0);
});

void test('conditional update conflict cannot claim that a makeup window was saved', async () => {
  const old = { id: '802-target', opens_at: '2026-09-29T02:05:00Z',
    closes_at: '2026-09-29T03:21:00Z', feedback_at: null,
    dashboard_visible: true, attempt_limit: 1 };
  const fetcher = async (resource: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = requestUrl(resource);
    if (path.includes('translation_quizzes?')) return response([{ status: 'published', grade_level: 8, score_mode: 'formal', feedback_policy: 'teacher-release' }]);
    if (path.includes('translation_quiz_targets?') && init?.method === 'PATCH') return response([]);
    if (path.includes('translation_quiz_targets?')) return response([old]);
    if (path.includes('translation_audit_log?') && init?.method === 'POST') return response([{ id: 1 }]);
    if (path.includes('translation_audit_log?')) return response([]);
    throw new Error(path);
  };
  await assert.rejects(reopenPublishedTarget(config, input(), 'teacher', fetcher as typeof fetch),
    (error: unknown) => error instanceof DraftTargetError && error.status === 409);
});
