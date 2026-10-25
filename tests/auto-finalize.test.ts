import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AI_AUTO_MARK, autoFinalizeAttempt, decideAutoFinalize, loadAutoFinalizeSetting, parseThreshold,
  requestMissingAiReviews } from '../lib/server/auto-finalize.ts';
import { summarizeCalibration } from '../lib/server/calibration.ts';
import { saveTeacherReview } from '../lib/server/save-review.ts';

const config = { supabaseUrl: 'https://example.supabase.co', supabaseSecretKey: 'secret', schoolYear: '115' } as never;
const facts = { rawAnswer: 'I was at home.', finalScore: null, openAppeal: false, maxScore: 10,
  ruleScore: null, ruleReason: '', aiScore: 8, aiConfidence: 0.93, aiReason: '語意正確，漏了句點。' };

void test('threshold is clamped to a safe range', () => {
  assert.equal(parseThreshold('0.9'), 0.9);
  assert.equal(parseThreshold(0.2), 0.8);
  assert.equal(parseThreshold(5), 0.99);
  assert.equal(parseThreshold('abc'), 0.8);
});

void test('AI score is adopted only at or above the threshold and carries the audit mark', () => {
  const adopted = decideAutoFinalize(facts, 0.9);
  assert.equal(adopted?.score, 8);
  assert.equal(adopted?.source, 'ai');
  assert.ok(adopted?.reason.startsWith(AI_AUTO_MARK));
  assert.equal(decideAutoFinalize({ ...facts, aiConfidence: 0.89 }, 0.9), null);
  assert.equal(decideAutoFinalize({ ...facts, aiConfidence: 0.9 }, 0.9)?.score, 8);
});

void test('appeals, blank answers, finalized answers and impossible scores always go to the teacher', () => {
  assert.equal(decideAutoFinalize({ ...facts, openAppeal: true }, 0.8), null);
  assert.equal(decideAutoFinalize({ ...facts, rawAnswer: '   ' }, 0.8), null);
  assert.equal(decideAutoFinalize({ ...facts, finalScore: 5 }, 0.8), null);
  assert.equal(decideAutoFinalize({ ...facts, aiScore: 11 }, 0.8), null);
  assert.equal(decideAutoFinalize({ ...facts, aiScore: 7.555 }, 0.8), null);
});

void test('a fixed rule result is adopted without asking the AI', () => {
  const decision = decideAutoFinalize({ ...facts, ruleScore: 10, ruleReason: '與參考答案完全相同。', aiScore: null, aiConfidence: null }, 0.9);
  assert.equal(decision?.source, 'rule');
  assert.equal(decision?.score, 10);
});

void test('manual review records the teacher session actor in the database call', async () => {
  let body: Record<string, unknown> = {};
  const fetcher = async (_url: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ answerId: 'a', attemptId: 'b', answerScore: 5, attemptStatus: 'review-pending',
      attemptFinalScore: null, reviewedAt: '2026-10-03T00:00:00Z' }), { status: 200 });
  };
  await saveTeacherReview(config, { answerId: '11111111-1111-4111-8111-111111111111', updatedAt: '2026-10-03T00:00:00Z', score: 5, reason: '測試理由' },
    'teacher:translation-studio', fetcher as typeof fetch);
  assert.equal(body.p_teacher_email, 'teacher:translation-studio');
});

void test('settings default to on and read the latest switch', async () => {
  const off = async () => new Response('[]', { status: 200 });
  assert.deepEqual(await loadAutoFinalizeSetting(config, 'Q', 1, off as typeof fetch), { enabled: true, threshold: 0.8 });
  const on = async () => new Response(JSON.stringify([{ id: 9, action: 'enable-ai-auto-finalize', entity_id: 'Q:1', after_data: { threshold: 0.85 } }]), { status: 200 });
  assert.deepEqual(await loadAutoFinalizeSetting(config, 'Q', 1, on as typeof fetch), { enabled: true, threshold: 0.85 });
});

function attemptFetcher(answers: unknown[], appeals: unknown[] = []) {
  const reviewCalls: Array<Record<string, unknown>> = [];
  let markerBody = '';
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const ok = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
    if (url.includes('/rpc/review_translation_answer')) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      reviewCalls.push(body);
      return ok({ answerId: body.p_answer_id, attemptId: 'att', answerScore: body.p_score, attemptStatus: 'review-pending',
        attemptFinalScore: null, reviewedAt: '2026-10-03T00:00:00Z' });
    }
    if (init?.method === 'POST' && url.endsWith('/translation_audit_log')) { markerBody = String(init.body); return new Response(null, { status: 201 }); }
    if (url.includes('translation_attempts?')) return ok([{ id: 'att', quiz_id: 'Q', quiz_version: 1, status: 'submitted' }]);
    if (url.includes('translation_quizzes?')) return ok([{ rubric_version: 'other' }]);
    if (url.includes('translation_attempt_answers?')) return ok(answers);
    if (url.includes('translation_questions?')) return ok([
      { id: 'q1', question_key: 'Q1', segmented_answer: 'I was / at home.', max_score: 10 },
      { id: 'q2', question_key: 'Q2', segmented_answer: 'She is / a nurse.', max_score: 10 },
      { id: 'q3', question_key: 'Q3', segmented_answer: 'We / like cats.', max_score: 10 }]);
    if (url.includes('translation_review_queue?')) return ok(appeals);
    throw new Error(url);
  };
  return { fetcher: fetcher as typeof fetch, reviewCalls, marker: () => markerBody };
}

void test('auto-finalize writes exact matches and confident AI scores, and leaves the rest', async () => {
  const ai = (score: number, confidence: number) => ({ suggestedScore: score, confidence, reason: '理由說明', model: 'm', version: 'v', createdAt: 'x' });
  const { fetcher, reviewCalls, marker } = attemptFetcher([
    { id: 'a1', question_id: 'q1', raw_answer: 'I was at home.', final_score: null, ai_review: null, updated_at: 't1' },
    { id: 'a2', question_id: 'q2', raw_answer: 'She a nurse', final_score: null, ai_review: ai(6, 0.95), updated_at: 't2' },
    { id: 'a3', question_id: 'q3', raw_answer: 'We likes cat', final_score: null, ai_review: ai(5, 0.6), updated_at: 't3' },
  ]);
  const outcome = await autoFinalizeAttempt(config, 'att', 0.9, fetcher);
  assert.deepEqual(outcome, { adopted: 2, skipped: 1, failed: 0 });
  assert.deepEqual(reviewCalls.map(call => call.p_answer_id), ['a1', 'a2']);
  assert.ok(reviewCalls.every(call => call.p_teacher_email === 'system:auto-finalize' && String(call.p_reason).startsWith(AI_AUTO_MARK)));
  assert.equal(JSON.parse(marker()).length, 2);
});

void test('an open student appeal blocks automatic adoption', async () => {
  const { fetcher, reviewCalls } = attemptFetcher([
    { id: 'a1', question_id: 'q1', raw_answer: 'I was at home.', final_score: null, ai_review: null, updated_at: 't1' },
  ], [{ answer_id: 'a1' }]);
  assert.deepEqual(await autoFinalizeAttempt(config, 'att', 0.9, fetcher), { adopted: 0, skipped: 1, failed: 0 });
  assert.equal(reviewCalls.length, 0);
});

void test('the AI is asked only about answers no rule can score', async () => {
  const { fetcher } = attemptFetcher([
    { id: 'a1', question_id: 'q1', raw_answer: 'I was at home.', final_score: null, ai_review: null, updated_at: 't1' },
    { id: 'a2', question_id: 'q2', raw_answer: 'She a nurse', final_score: null, ai_review: null, updated_at: 't2' },
    { id: 'a3', question_id: 'q3', raw_answer: '', final_score: null, ai_review: null, updated_at: 't3' },
  ]);
  const asked: string[] = [];
  const errors = await requestMissingAiReviews(config, 'att', async input => {
    asked.push(input.answerId); throw new Error('AI 金鑰無效');
  }, fetcher);
  assert.deepEqual(asked, ['a2']);
  assert.deepEqual(errors, ['AI 金鑰無效']);
});

void test('calibration compares only scores the teacher entered herself', () => {
  const buckets = summarizeCalibration([
    { finalScore: 8, aiScore: 8, confidence: 0.96, adoptedAutomatically: false },
    { finalScore: 6, aiScore: 8, confidence: 0.97, adoptedAutomatically: false },
    { finalScore: 8, aiScore: 8, confidence: 0.96, adoptedAutomatically: true },
    { finalScore: null, aiScore: 5, confidence: 0.7, adoptedAutomatically: false },
  ]);
  assert.deepEqual(buckets[0], { label: '95% 以上', total: 3, teacherChecked: 2, teacherAgreed: 1 });
  assert.deepEqual(buckets[4], { label: '80% 以下', total: 1, teacherChecked: 0, teacherAgreed: 0 });
});

void test('a short rate limit is retried but a missing quota is not', async () => {
  const { withAiRetry } = await import('../lib/server/auto-finalize.ts');
  let calls = 0;
  await assert.rejects(withAiRetry(async () => { calls++; throw new Error('AI 額度不足（insufficient_quota）。'); }), /額度不足/);
  assert.equal(calls, 1);
});

void test('a teacher can switch a quiz off', async () => {
  const offRow = async () => new Response(JSON.stringify([{ id: 9, action: 'disable-ai-auto-finalize', entity_id: 'Q:1', after_data: { threshold: 0.9 } }]), { status: 200 });
  assert.equal((await loadAutoFinalizeSetting(config, 'Q', 1, offRow as typeof fetch)).enabled, false);
});
