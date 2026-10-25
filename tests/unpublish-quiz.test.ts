import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unpublishQuiz, UnpublishError } from '../lib/server/unpublish-quiz.ts';
import type { DataConfig } from '../lib/server/config.ts';

const config = {
  supabaseUrl: 'https://database.example.test', supabaseSecretKey: 'service-secret', schoolYear: '115',
} as DataConfig;
const response = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
const requestUrl = (resource: RequestInfo | URL) =>
  typeof resource === 'string' ? resource : resource instanceof URL ? resource.href : resource.url;

function harness({ status = 'published', attempts = [[], []] as unknown[][], visible = true } = {}) {
  const writes: Array<{ path: string; method: string; body: unknown }> = [];
  let attemptReads = 0;
  const targets = [{ id: 't801', class_code: '801', dashboard_visible: visible }, { id: 't802', class_code: '802', dashboard_visible: visible }];
  const fetcher = async (resource: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = decodeURIComponent(requestUrl(resource));
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined;
    if (method !== 'GET') writes.push({ path, method, body });
    if (path.includes('translation_quizzes?') && method === 'GET') return response([{ status, published_at: '2026-10-05T00:00:00Z' }]);
    if (path.includes('translation_quiz_targets?') && method === 'GET') return response(targets);
    if (path.includes('translation_attempts?')) return response(attempts[Math.min(attemptReads++, attempts.length - 1)]);
    if (path.includes('translation_audit_log?')) return response([{ id: writes.length }]);
    if (path.includes('translation_quizzes?') && method === 'PATCH') return response([{ quiz_id: 'Q' }]);
    if (path.includes('translation_quiz_targets?') && method === 'PATCH') return response(targets.map(({ id }) => ({ id })));
    throw new Error(`Unexpected ${method} ${path}`);
  };
  return { writes, fetcher: fetcher as typeof fetch };
}

void test('unpublish returns a quiz with no attempts to draft, hides all classes, and audits both ends', async () => {
  const { writes, fetcher } = harness();
  const result = await unpublishQuiz(config, 'G8-U2-DIALOGUE', 1, 'teacher@example.test', fetcher);
  assert.deepEqual(result.classes, ['801', '802']);
  assert.deepEqual(writes.map(write => `${write.method} ${write.path.split('?')[0].split('/').pop()}`), [
    'POST translation_audit_log', 'PATCH translation_quizzes', 'PATCH translation_quiz_targets', 'POST translation_audit_log']);
  assert.deepEqual(writes[1].body, { status: 'draft', published_at: null });
  assert.ok(writes[1].path.includes('status=eq.published'));
  assert.deepEqual(writes[2].body, { dashboard_visible: false });
  assert.equal((writes[0].body as Array<{ action: string }>)[0].action, 'unpublish-quiz-authorized');
  assert.equal((writes[3].body as Array<{ action: string }>)[0].action, 'unpublish-quiz-complete');
});

void test('unpublish refuses once any student has started and writes nothing', async () => {
  const { writes, fetcher } = harness({ attempts: [[{ id: 'a1' }]] });
  await assert.rejects(unpublishQuiz(config, 'G8-U2-DIALOGUE', 1, 'teacher@example.test', fetcher), /立即結束/);
  assert.equal(writes.length, 0);
  await assert.rejects(unpublishQuiz(config, 'G8-U2-DIALOGUE', 1, 'teacher@example.test', harness({ status: 'draft', visible: false }).fetcher), UnpublishError);
});

void test('a student starting during the switch restores the publish instead of hiding classes', async () => {
  const { writes, fetcher } = harness({ attempts: [[], [{ id: 'late' }]] });
  await assert.rejects(unpublishQuiz(config, 'G8-U2-DIALOGUE', 1, 'teacher@example.test', fetcher), /恢復發布/);
  assert.deepEqual(writes.map(write => write.method), ['POST', 'PATCH', 'PATCH']);
  assert.deepEqual(writes[2].body, { status: 'published', published_at: '2026-10-05T00:00:00Z' });
  assert.ok(!writes.some(write => write.path.includes('translation_quiz_targets')));
});

void test('a half-finished undo (draft with visible classes) can be completed', async () => {
  const { writes, fetcher } = harness({ status: 'draft' });
  await unpublishQuiz(config, 'G8-U2-DIALOGUE', 1, 'teacher@example.test', fetcher);
  assert.ok(!writes.some(write => write.path.includes('translation_quizzes')));
  assert.ok(writes.some(write => write.path.includes('translation_quiz_targets') && write.method === 'PATCH'));
});
