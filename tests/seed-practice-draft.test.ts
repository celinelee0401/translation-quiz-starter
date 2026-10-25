import assert from 'node:assert/strict';
import test from 'node:test';

import { seedPracticeDraft, DraftSeedError } from '../lib/server/seed-practice-draft.ts';
import type { DataConfig } from '../lib/server/config.ts';

const config: DataConfig = {
  loginMode: 'pin',
  schoolYear: '115',
  sessionSecret: 'y'.repeat(32),
  secureCookies: true,
  supabaseUrl: 'https://database.example.test',
  supabaseSecretKey: 'test-service-key',
};

void test('seed saves five questions and 17 rubric units as an unpublished practice draft', async () => {
  const requests: Array<{ url: string; method: string; body?: unknown }> = [];
  const questionRows = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'].map((question_key, index) => ({
    id: `00000000-0000-4000-8000-00000000000${index + 1}`,
    question_key,
  }));
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : input.toString();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    requests.push({ url, method: init?.method ?? 'GET', body });
    if (url.includes('/translation_quizzes?')) return response([]);
    if (url.endsWith('/translation_quizzes')) return response(body);
    if (url.includes('/translation_questions?select=')) return response(questionRows);
    if (url.includes('/translation_rubric_units?select=')) {
      return response(Array.from({ length: 17 }, (_, index) => ({ id: String(index) })));
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await seedPracticeDraft(config, fetcher as typeof fetch);
  assert.deepEqual(result, { result: 'created', questions: 5, rubricUnits: 17 });
  const quiz = requests.find((item) => item.url.endsWith('/translation_quizzes'))?.body as Array<Record<string, unknown>>;
  assert.equal(quiz[0].status, 'draft');
  assert.equal(quiz[0].score_mode, 'practice');
  assert.equal(quiz[0].published_at, null);
  const questions = requests.find((item) => item.url.includes('/translation_questions?select='))?.body as Array<Record<string, unknown>>;
  assert.deepEqual(questions.map((item) => item.max_score), [20, 20, 20, 20, 10]);
  const rubrics = requests.find((item) => item.url.includes('/translation_rubric_units?select='))?.body as Array<Record<string, unknown>>;
  assert.equal(rubrics.length, 17);
  const oralPattern = rubrics.find((item) => item.label === '口語說法');
  assert.ok(oralPattern);
  assert.deepEqual(
    (oralPattern.machine_rule as Record<string, unknown>).partialCreditAnswers,
    [{ answer: 'Oh no!', score: 5, reason: '語氣正確，但未使用目標說法 That\'s too bad。' }],
  );
  assert.ok(requests.every((item) => !item.url.includes('translation_quiz_targets')));
});

void test('seed does not overwrite an incomplete existing draft', async () => {
  const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.includes('/translation_quizzes?')) {
      return response([{ quiz_id: 'G8-DEMO-SCHOOL-DAY-01', quiz_version: 1, status: 'draft' }]);
    }
    if (url.includes('/translation_questions?')) return response([]);
    throw new Error('Unexpected write');
  };
  await assert.rejects(
    seedPracticeDraft(config, fetcher as typeof fetch),
    (error: unknown) => error instanceof DraftSeedError && error.status === 409,
  );
});

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
