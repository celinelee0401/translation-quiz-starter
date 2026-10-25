import assert from 'node:assert/strict';
import test from 'node:test';
import { suggestTranslationScore } from '../lib/grading.ts';
import { loadTeacherReview } from '../lib/server/teacher-review.ts';
import { saveTeacherReview, parseReviewInput } from '../lib/server/save-review.ts';
import type { TeacherQuiz } from '../lib/server/teacher-overview.ts';
import type { DataConfig } from '../lib/server/config.ts';

const config: DataConfig = {
  loginMode: 'pin',
  schoolYear: '115',
  sessionSecret: 'y'.repeat(32),
  secureCookies: true,
  supabaseUrl: 'https://database.example.test',
  supabaseSecretKey: 'test-service-key',
};

const quizzes: TeacherQuiz[] = [{
  quizId: 'G8-DEMO-P3', version: 1, title: '示範對話左頁', grade: 8,
  scoreMode: 'formal', feedbackPolicy: 'teacher-release', status: 'draft', targets: [],
  questions: [
    { id: 'question-1', key: 'Q1', prompt: '你昨天在哪裡？', answer: 'Where were you / yesterday?', hint: '', points: 10, rubric: [] },
    { id: 'question-2', key: 'Q2', prompt: '我七點半到學校。', answer: 'I got to school / at seven thirty.', hint: '', points: 10, rubric: [] },
  ],
}];

void test('exact textbook answer is a versioned suggestion, not a final grade', () => {
  assert.deepEqual(suggestTranslationScore('Where were you yesterday?', 'Where were you / yesterday?', 10), {
    kind: 'textbook-exact', suggestedScore: 10,
    reason: '與參考答案一致；僅建議滿分，正式成績尚未鎖定。',
    ruleVersion: 'literal-v1',
  });
  assert.equal(suggestTranslationScore('Where were you yesterday？', 'Where were you / yesterday?', 10).kind, 'textbook-exact');
});

void test('a plausible alternative, case error, and blank answer all stay for teacher review', () => {
  for (const answer of ['Where did you go yesterday?', 'where were you yesterday?', '']) {
    const result = suggestTranslationScore(answer, 'Where were you / yesterday?', 10);
    assert.equal(result.kind, 'teacher-review');
    assert.equal(result.suggestedScore, null);
  }
});

void test('teacher review joins only private submitted answers and preserves raw text', async () => {
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    assert.equal(init?.cache, 'no-store');
    assert.equal(new Headers(init?.headers).get('apikey'), 'test-service-key');
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('translation_attempts?')) return ok([{
      id: 'attempt-1', quiz_id: 'G8-DEMO-P3', quiz_version: 1,
      enrollment_id: 'enrollment-1', server_submit_time: '2026-09-20T09:00:00Z', status: 'submitted', final_score: null,
    }]);
    if (url.includes('translation_attempt_answers?')) return ok([
      { id: 'answer-1', attempt_id: 'attempt-1', question_id: 'question-1', raw_answer: 'Where were you yesterday?', final_score: null, updated_at: '2026-09-20T09:00:00Z' },
      { id: 'answer-2', attempt_id: 'attempt-1', question_id: 'question-2', raw_answer: 'I stayed near the sea.', final_score: null, updated_at: '2026-09-20T09:00:00Z' },
    ]);
    if (url.includes('enrollments?')) return ok([{ id: 'enrollment-1', class_code: '801', seat_number: 7 }]);
    if (url.includes('translation_review_queue?')) return ok([]);
    if (url.includes('translation_audit_log?')) return ok([]);
    throw new Error('Unexpected request');
  };
  const rows = await loadTeacherReview(config, quizzes, fetcher as typeof fetch);
  assert.equal(rows[0].classCode, '801');
  assert.equal(rows[0].seatNumber, 7);
  assert.equal(rows[0].answers[0].suggestion.suggestedScore, 10);
  assert.equal(rows[0].answers[1].rawAnswer, 'I stayed near the sea.');
  assert.equal(rows[0].answers[1].suggestion.suggestedScore, null);
});

void test('teacher review fails closed when answer set is incomplete', async () => {
  const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('translation_attempts?')) return ok([{
      id: 'attempt-1', quiz_id: 'G8-DEMO-P3', quiz_version: 1,
      enrollment_id: 'enrollment-1', server_submit_time: '2026-09-20T09:00:00Z', status: 'submitted', final_score: null,
    }]);
    if (url.includes('translation_attempt_answers?')) return ok([]);
    if (url.includes('enrollments?')) return ok([{ id: 'enrollment-1', class_code: '801', seat_number: 7 }]);
    if (url.includes('translation_review_queue?')) return ok([]);
    if (url.includes('translation_audit_log?')) return ok([]);
    throw new Error('Unexpected request');
  };
  await assert.rejects(loadTeacherReview(config, quizzes, fetcher as typeof fetch), /不一致/);
});

void test('review input rejects stale-looking identifiers and invalid fractional scores', () => {
  const valid = {
    answerId: '123e4567-e89b-42d3-a456-426614174000',
    updatedAt: '2026-09-20T09:00:00.123Z',
    score: 7.5,
    reason: '語意完整，文法合理',
  };
  assert.deepEqual(parseReviewInput(valid), valid);
  assert.throws(() => parseReviewInput({ ...valid, score: 7.555 }), /有效分數/);
  assert.throws(() => parseReviewInput({ ...valid, reason: '好' }), /有效分數/);
  assert.throws(() => parseReviewInput({ ...valid, answerId: 'wrong' }), /有效分數/);
});

void test('review write calls only the atomic RPC and checks its result', async () => {
  const input = {
    answerId: '123e4567-e89b-42d3-a456-426614174000',
    updatedAt: '2026-09-20T09:00:00Z',
    score: 8,
    reason: '語意正確，句型稍有差異',
  };
  const fetcher = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const address = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    assert.match(address, /rpc\/review_translation_answer$/);
    assert.equal(init?.method, 'POST');
    if (typeof init?.body !== 'string') throw new Error('Expected JSON body');
    const body = JSON.parse(init.body) as Record<string, unknown>;
    assert.equal(body.p_answer_id, input.answerId);
    assert.equal(body.p_expected_updated_at, input.updatedAt);
    assert.equal(body.p_teacher_email, 'teacher:translation-studio');
    return ok({
      answerId: input.answerId, attemptId: '123e4567-e89b-42d3-a456-426614174001',
      answerScore: 8, attemptStatus: 'review-pending', attemptFinalScore: null,
      reviewedAt: '2026-09-20T09:01:00Z',
    });
  };
  const result = await saveTeacherReview(config, input, 'teacher:translation-studio', fetcher as typeof fetch);
  assert.equal(result.answerScore, 8);
  assert.equal(result.attemptStatus, 'review-pending');
});

function ok(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}

void test('review overview groups submissions by quiz and class in opening order and counts unscored answers', async () => {
  const { loadReviewOverview } = await import('../lib/server/teacher-review.ts');
  const quiz = (quizId: string, opens: string) => ({ quizId, version: 1, title: quizId, grade: 8, scoreMode: 'formal', feedbackPolicy: 'teacher-release',
    status: 'published', questions: [], targets: [{ classCode: '801', opensAt: opens, closesAt: opens, dashboardVisible: true },
      { classCode: '802', opensAt: '2026-10-01T00:00:00Z', closesAt: opens, dashboardVisible: true }] });
  const quizzes = [quiz('LATE', '2026-10-05T00:00:00Z'), quiz('EARLY', '2026-10-02T00:00:00Z')];
  const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes('translation_attempts?')) return ok(url.includes('offset=0') ? [
      { id: 'a1', quiz_id: 'EARLY', quiz_version: 1, enrollment_id: 'e1', status: 'review-pending' },
      { id: 'a2', quiz_id: 'EARLY', quiz_version: 1, enrollment_id: 'e2', status: 'finalized' },
      { id: 'a3', quiz_id: 'LATE', quiz_version: 1, enrollment_id: 'e1', status: 'submitted' },
      { id: 'a4', quiz_id: 'EARLY', quiz_version: 1, enrollment_id: 'e3', status: 'submitted' },
    ] : []);
    if (url.includes('enrollments?')) return ok([{ id: 'e1', class_code: '801', seat_number: 1 },
      { id: 'e2', class_code: '801', seat_number: 2 }, { id: 'e3', class_code: '802', seat_number: 1 }]);
    if (url.includes('translation_attempt_answers?select=id,final_score')) return ok([{ id: 'x1', final_score: null }, { id: 'x2', final_score: 7 }]);
    if (url.includes('translation_attempt_answers?')) return ok(url.includes('offset=0') ? [
      { attempt_id: 'a1', raw_answer: 'x', ai_review: null }, { attempt_id: 'a1', raw_answer: 'y', ai_review: { confidence: 0.5 } },
      { attempt_id: 'a3', raw_answer: 'z', ai_review: null }, { attempt_id: 'a4', raw_answer: ' ', ai_review: null }] : []);
    if (url.includes('translation_review_queue?')) return ok(url.includes('offset=0') ? [{ attempt_id: 'a1', answer_id: 'x1' }, { attempt_id: 'a2', answer_id: 'x2' }] : []);
    if (url.includes('translation_audit_log?')) return ok(url.includes('offset=0') ? [{ entity_id: 'a2' }, { entity_id: 'a2' }, { entity_id: 'a1' }] : []);
    throw new Error(url);
  };
  const groups = await loadReviewOverview(config, quizzes as never, fetcher as typeof fetch);
  assert.deepEqual(groups.map(group => `${group.quizId}:${group.classCode}`), ['EARLY:802', 'LATE:802', 'EARLY:801', 'LATE:801'].filter(key => key !== 'LATE:802'));
  const early801 = groups.find(group => group.quizId === 'EARLY' && group.classCode === '801')!;
  assert.equal(early801.submitted, 2);
  assert.equal(early801.finalized, 1);
  // two unscored answers in a1, plus an appeal on the already finalized a2
  assert.equal(early801.pendingAnswers, 3);
  assert.deepEqual(early801.pendingAttemptIds, ['a1', 'a2']);
  assert.equal(early801.awaitingAi, 1);
  assert.equal(early801.aiAdopted, 3);
  assert.equal(early801.appealAnswers, 2);
});
