import assert from 'node:assert/strict';
import test from 'node:test';
import { loadStudentQuiz } from '../lib/server/student-quiz.ts';
import type { DataConfig } from '../lib/server/config.ts';

const config: DataConfig = {
  loginMode: 'pin',
  schoolYear: '115', sessionSecret: 'y'.repeat(32), secureCookies: true,
  supabaseUrl: 'https://database.example.test', supabaseSecretKey: 'test-service-key',
};

void test('student quiz payload contains only published title and ordered prompts', async () => {
  const paths: string[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = requestUrl(input);
    paths.push(path);
    assert.equal(new Headers(init?.headers).get('apikey'), 'test-service-key');
    assert.equal(init?.cache, 'no-store');
    if (path.includes('translation_quizzes?')) return response([{
      quiz_id: 'G8-DEMO-P3', quiz_version: 1, title: '左頁',
      score_mode: 'formal', grade_level: 8, status: 'published',
    }]);
    return response([
      { question_key: 'A1', prompt_zh: '第一句', display_order: 1 },
      { question_key: 'A2', prompt_zh: '第二句', display_order: 2 },
    ]);
  };
  const quiz = await loadStudentQuiz(config, 'G8-DEMO-P3', 1, 8, fetcher as typeof fetch);
  assert.deepEqual(quiz.questions, [{ id: 'A1', prompt: '第一句' }, { id: 'A2', prompt: '第二句' }]);
  assert.equal(quiz.scoreMode, 'formal');
  assert.ok(paths.every((path) => !/segmented_answer|hint|rubric|accepted_alternatives/.test(path)));
  assert.ok(!/第一句/.test(JSON.stringify(paths)));
});

void test('student quiz loader fails closed for drafts, wrong grades and missing questions', async () => {
  const quiz = { quiz_id: 'Q1', quiz_version: 1, title: 'Quiz', score_mode: 'formal', grade_level: 8, status: 'draft' };
  const rows = [{ question_key: 'A1', prompt_zh: '第一句', display_order: 1 }];
  const fetcher = (quizRows: unknown[], questionRows: unknown[]) =>
    (async (input: RequestInfo | URL): Promise<Response> => response(
      requestUrl(input).includes('translation_quizzes?') ? quizRows : questionRows,
    )) as typeof fetch;
  await assert.rejects(loadStudentQuiz(config, 'Q1', 1, 8, fetcher([quiz], rows)), /UNAVAILABLE/);
  await assert.rejects(loadStudentQuiz(config, 'Q1', 1, 9, fetcher([{ ...quiz, status: 'published' }], rows)), /UNAVAILABLE/);
  await assert.rejects(loadStudentQuiz(config, 'Q1', 1, 8, fetcher([{ ...quiz, status: 'published' }], [])), /UNAVAILABLE/);
});

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
