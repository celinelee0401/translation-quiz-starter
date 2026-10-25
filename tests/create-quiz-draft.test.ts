import assert from 'node:assert/strict';
import test from 'node:test';
import { createQuizDraft, validateNewDraft } from '../lib/server/create-quiz-draft.ts';
import { genericRubricFingerprint } from '../lib/generic-rubric-approval.ts';
import type { DataConfig } from '../lib/server/config.ts';

const config: DataConfig = {
  loginMode: 'pin',
  schoolYear: '115', sessionSecret: 'y'.repeat(32), secureCookies: true,
  supabaseUrl: 'https://database.example.test', supabaseSecretKey: 'test-service-key',
};
const input = { title: 'G8 Unit 2 Reading p.23', unit: 'Unit 2 Reading p.23',
  grade: 8, scoreMode: 'formal', questions: [{ prompt: '你昨天在哪裡？',
    answer: 'Where / were you / yesterday?', hint: '注意過去式。', meaning: 5, grammar: 4 }] };

void test('new quiz input rejects incomplete and full-width English answer punctuation', () => {
  assert.equal(validateNewDraft(input).questions.length, 1);
  assert.throws(() => validateNewDraft({ ...input, questions: [{ ...input.questions[0], answer: 'Where were you？' }] }), /半形/);
  assert.throws(() => validateNewDraft({ ...input, questions: [{ ...input.questions[0], meaning: -1 }] }), /配分/);
  assert.throws(() => validateNewDraft({ ...input, questions: [] }), /1～50/);
});

void test('new quiz creates an unpublished teacher-review draft with all rubric units', async () => {
  const calls: Array<{ path: string; body: unknown }> = [];
  const fetcher = async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = url instanceof Request ? url.url : url.toString();
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '');
    calls.push({ path, body });
    if (path.includes('translation_quizzes')) return new Response(JSON.stringify([{ quiz_id: body[0].quiz_id }]));
    if (path.includes('translation_questions')) return new Response(JSON.stringify([{ id: 'q1', question_key: 'Q1' }]));
    if (path.includes('translation_rubric_units')) return new Response(JSON.stringify([{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }]));
    return new Response(JSON.stringify([{ id: 1 }]));
  };
  const id = await createQuizDraft(config, validateNewDraft(input), 'teacher@example.test', fetcher as typeof fetch);
  assert.match(id, /^CUSTOM-G8-[A-F0-9]{32}$/);
  assert.equal((calls[0].body as Array<{ status: string; feedback_policy: string }>)[0].status, 'draft');
  assert.equal((calls[0].body as Array<{ status: string; feedback_policy: string }>)[0].feedback_policy, 'teacher-release');
  const rubric = calls[2].body as Array<{ points: number; machine_rule: { requiresTeacherReview: boolean } }>;
  assert.deepEqual(rubric.map(row => row.points), [5, 4, 1]);
  assert.ok(rubric.every(row => row.machine_rule.requiresTeacherReview));
});

void test('rubric approval snapshot changes when teacher scoring changes', () => {
  const quiz = { quizId: 'CUSTOM-G8-ABC', version: 1,
    questions: [{ key: 'Q1', answer: 'Where were you?', points: 10,
      rubric: [{ label: '語意', requirement: '詢問過去位置', points: 5 }] }] };
  const first = genericRubricFingerprint(quiz);
  assert.notEqual(first, genericRubricFingerprint({ ...quiz, questions: [{ ...quiz.questions[0],
    rubric: [{ ...quiz.questions[0].rubric[0], points: 4 }] }] }));
});
