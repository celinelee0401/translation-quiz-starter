import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adjustPublishedTarget, DraftTargetError, type AdjustInput } from '../lib/server/draft-targets.ts';
import type { DataConfig } from '../lib/server/config.ts';

const config = {
  supabaseUrl: 'https://database.example.test', supabaseSecretKey: 'service-secret', schoolYear: '115',
} as DataConfig;
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json' },
});
const requestUrl = (resource: RequestInfo | URL) =>
  typeof resource === 'string' ? resource : resource instanceof URL ? resource.href : resource.url;
const iso = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
const local = (minutes: number) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(Date.now() + minutes * 60_000)).replace(' ', 'T');

type Target = { id: string; opens_at: string; closes_at: string; feedback_at: string | null; dashboard_visible: boolean; attempt_limit: number };

function harness(target: Target, quizStatus = 'published') {
  const writes: Array<{ path: string; method: string; body: unknown }> = [];
  const fetcher = async (resource: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(requestUrl(resource));
    const path = decodeURIComponent(url.pathname + url.search);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined;
    if (body) writes.push({ path, method, body });
    if (path.includes('translation_quizzes?')) return response([{ status: quizStatus, grade_level: 8 }]);
    if (path.includes('translation_quiz_targets?') && method === 'GET') return response([target]);
    if (path.includes('translation_audit_log?') && method === 'POST') return response([{ id: writes.length }]);
    if (path.includes('translation_quiz_targets?') && method === 'PATCH') {
      assert.ok(path.includes(`id=eq.${target.id}`));
      assert.ok(path.includes(`closes_at=eq.${target.closes_at}`));
      assert.ok(path.includes(`attempt_limit=eq.${target.attempt_limit}`));
      return response([{ ...target, ...(body as Record<string, unknown>) }]);
    }
    throw new Error(`Unexpected ${method} ${path}`);
  };
  return { writes, fetcher: fetcher as typeof fetch };
}
const input = (extra: Partial<AdjustInput>): AdjustInput =>
  ({ quizId: 'G8-U2-DIALOGUE', quizVersion: 1, classCode: '802', action: 'end-now', ...extra });
const active = (): Target => ({ id: 't-802', opens_at: iso(-20), closes_at: iso(30), feedback_at: null, dashboard_visible: true, attempt_limit: 1 });
const upcoming = (): Target => ({ id: 't-802', opens_at: iso(60), closes_at: iso(120), feedback_at: null, dashboard_visible: true, attempt_limit: 1 });

void test('end-now closes an active class early with grace minutes, audit before and after', async () => {
  const { writes, fetcher } = harness(active());
  const saved = await adjustPublishedTarget(config, input({ action: 'end-now', graceMinutes: 5 }), 'teacher@example.test', fetcher);
  assert.deepEqual(writes.map(write => write.method), ['POST', 'PATCH', 'POST']);
  assert.deepEqual(Object.keys(writes[1].body as object), ['closes_at']);
  const closes = Date.parse(saved.closesAt);
  assert.ok(closes > Date.now() + 4 * 60_000 && closes < Date.now() + 6 * 60_000);
  assert.equal((writes[0].body as Array<{ action: string }>)[0].action, 'authorize-adjust-class-target');
  assert.equal((writes[2].body as Array<{ action: string }>)[0].action, 'adjust-class-target');
});

void test('ending early moves retained feedback that was tied to the old cutoff', async () => {
  const target = active();
  target.feedback_at = target.closes_at;
  const { writes, fetcher } = harness(target);
  await adjustPublishedTarget(config, input({ action: 'end-now' }), 'teacher@example.test', fetcher);
  const patch = writes[1].body as { closes_at: string; feedback_at: string };
  assert.equal(patch.feedback_at, patch.closes_at);
});

void test('open-now only applies before opening and keeps the cutoff', async () => {
  const { writes, fetcher } = harness(upcoming());
  await adjustPublishedTarget(config, input({ action: 'open-now' }), 'teacher@example.test', fetcher);
  assert.deepEqual(Object.keys(writes[1].body as object), ['opens_at']);
  await assert.rejects(adjustPublishedTarget(config, input({ action: 'open-now' }), 'teacher@example.test', harness(active()).fetcher),
    (error: unknown) => error instanceof DraftTargetError && error.status === 409);
});

void test('reschedule keeps the opening time of an active class and only moves the cutoff', async () => {
  const { writes, fetcher } = harness(active());
  await adjustPublishedTarget(config, input({ action: 'reschedule', opensAtLocal: local(5), closesAtLocal: local(90) }), 'teacher@example.test', fetcher);
  assert.deepEqual(Object.keys(writes[1].body as object), ['closes_at']);
  await assert.rejects(adjustPublishedTarget(config, input({ action: 'reschedule', closesAtLocal: local(-5) }), 'teacher@example.test', harness(active()).fetcher),
    DraftTargetError);
});

void test('attempt limit is 1 to 5 and never touches ended, draft or unpublished windows', async () => {
  const { writes, fetcher } = harness(active());
  const saved = await adjustPublishedTarget(config, input({ action: 'attempt-limit', attemptLimit: 3 }), 'teacher@example.test', fetcher);
  assert.equal(saved.attemptLimit, 3);
  assert.deepEqual(writes[1].body, { attempt_limit: 3 });
  for (const limit of [0, 6, 1.5]) {
    await assert.rejects(adjustPublishedTarget(config, input({ action: 'attempt-limit', attemptLimit: limit }), 'teacher@example.test', harness(active()).fetcher), DraftTargetError);
  }
  const ended = { ...active(), opens_at: iso(-90), closes_at: iso(-30) };
  const endedRun = harness(ended);
  await assert.rejects(adjustPublishedTarget(config, input({ action: 'attempt-limit', attemptLimit: 2 }), 'teacher@example.test', endedRun.fetcher), /補考/);
  assert.equal(endedRun.writes.length, 0);
  const draftRun = harness(active(), 'draft');
  await assert.rejects(adjustPublishedTarget(config, input({ action: 'end-now' }), 'teacher@example.test', draftRun.fetcher), DraftTargetError);
  assert.equal(draftRun.writes.length, 0);
  const hidden = harness({ ...active(), dashboard_visible: false });
  await assert.rejects(adjustPublishedTarget(config, input({ action: 'end-now' }), 'teacher@example.test', hidden.fetcher), DraftTargetError);
  assert.equal(hidden.writes.length, 0);
});
