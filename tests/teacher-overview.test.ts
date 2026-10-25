import assert from 'node:assert/strict';
import test from 'node:test';

import { loadTeacherOverview } from '../lib/server/teacher-overview.ts';
import { quizContentFingerprint } from '../lib/quiz-content-approval.ts';
import { studentE2EAuditAction, studentE2EAuditEntity, studentE2EContractVersion } from '../lib/student-e2e-contract.ts';
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

void test('teacher overview keeps class targets with the matching quiz version', async () => {
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    assert.equal(init?.cache, 'no-store');
    assert.equal(new Headers(init?.headers).get('apikey'), 'test-service-key');
    const url = input instanceof Request ? input.url : input.toString();
    if (url.includes('translation_quizzes?')) {
      return response([
        { quiz_id: 'U1', quiz_version: 1, title: 'U1 練習', grade_level: 8, score_mode: 'practice', feedback_policy: 'immediate', status: 'draft' },
        { quiz_id: 'U1', quiz_version: 2, title: 'U1 正式', grade_level: 8, score_mode: 'formal', feedback_policy: 'teacher-release', status: 'draft' },
      ]);
    }
    if (url.includes('translation_quiz_targets?')) {
      return response([
        { quiz_id: 'U1', quiz_version: 1, class_code: '801', opens_at: '2026-09-19T00:00:00Z', closes_at: '2026-09-20T00:00:00Z', dashboard_visible: false },
        { quiz_id: 'U1', quiz_version: 2, class_code: '802', opens_at: '2026-09-21T00:00:00Z', closes_at: '2026-09-22T00:00:00Z', dashboard_visible: false },
      ]);
    }
    if (url.includes('translation_questions?')) return response([]);
    if (url.includes('translation_rubric_units?')) return response([]);
    if (url.includes('translation_audit_log?')) return response([]);
    throw new Error('Unexpected request');
  };
  const result = await loadTeacherOverview(config, fetcher as typeof fetch);
  assert.deepEqual(result.map((quiz) => quiz.targets.map((target) => target.classCode)), [['801'], ['802']]);
  assert.equal(result[1].scoreMode, 'formal');
  assert.equal(result[1].feedbackPolicy, 'teacher-release');
});

void test('teacher overview does not show an incomplete list as complete', async () => {
  const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
    if ((input instanceof Request ? input.url : input.toString()).includes('translation_quizzes?')) {
      return response(Array.from({ length: 100 }, (_, index) => ({
        quiz_id: `Q${index}`, quiz_version: 1, title: 'Quiz', grade_level: 8,
        score_mode: 'practice', status: 'draft',
      })));
    }
    return response([]);
  };
  await assert.rejects(loadTeacherOverview(config, fetcher as typeof fetch), /頁面容量/);
});

void test('teacher confirmation is valid only for the exact approved questions and points', async () => {
  const expected = {
    quizId: 'G8-DEMO-READING-P11', version: 1,
    questions: [{ key: 'Q1', prompt: '你昨天在哪裡？', answer: 'Where / were you?', points: 10 }],
  };
  const fingerprint = quizContentFingerprint(expected as Parameters<typeof quizContentFingerprint>[0]);
  async function overview(points: number) {
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.includes('translation_quizzes?')) return response([{
        quiz_id: expected.quizId, quiz_version: 1, title: 'Reading', grade_level: 8,
        score_mode: 'formal', feedback_policy: 'teacher-release', status: 'draft',
      }]);
      if (url.includes('translation_questions?')) return response([{
        id: 'q1', quiz_id: expected.quizId, quiz_version: 1, question_key: 'Q1',
        display_order: 1, prompt_zh: expected.questions[0].prompt,
        segmented_answer: expected.questions[0].answer, hint: '提示', max_score: points,
      }]);
      if (url.includes('translation_audit_log?')) return response([{
        entity_id: `${expected.quizId}:1`, actor_id: 'teacher@example.test',
        occurred_at: '2026-09-20T00:00:00Z', after_data: { content_fingerprint: fingerprint },
      }]);
      return response([]);
    };
    return (await loadTeacherOverview(config, fetcher as typeof fetch))[0];
  }
  assert.equal((await overview(10)).contentApproval?.by, 'teacher@example.test');
  assert.equal((await overview(11)).contentApproval, undefined);
});

void test('student E2E status appears only for the current passing contract', async () => {
  async function overview(version: string, passed: boolean) {
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.includes('translation_quizzes?')) return response([{
        quiz_id: 'Q1', quiz_version: 1, title: 'Quiz', grade_level: 8,
        score_mode: 'formal', feedback_policy: 'teacher-release', status: 'draft',
      }]);
      if (url.includes(`action=eq.${studentE2EAuditAction}`)) return response([{
        entity_id: studentE2EAuditEntity, actor_id: 'qa-runner', occurred_at: '2026-09-26T09:00:00Z',
        after_data: { e2e_version: version, passed },
      }]);
      return response([]);
    };
    return (await loadTeacherOverview(config, fetcher as typeof fetch))[0];
  }
  assert.equal((await overview(studentE2EContractVersion, true)).studentE2E?.version, studentE2EContractVersion);
  assert.equal((await overview('old-contract', true)).studentE2E, undefined);
  assert.equal((await overview(studentE2EContractVersion, false)).studentE2E, undefined);
});

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
