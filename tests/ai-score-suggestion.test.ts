import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAiSuggestionInput, suggestAnswerWithAi } from '../lib/server/ai-score-suggestion.ts';
import type { DataConfig } from '../lib/server/config.ts';

const answerId = '123e4567-e89b-42d3-a456-426614174000';
const attemptId = '123e4567-e89b-42d3-a456-426614174001';
const questionId = '123e4567-e89b-42d3-a456-426614174002';
const updatedAt = '2026-09-29T02:00:00Z';
const config: DataConfig = {
  loginMode: 'pin',
  schoolYear: '115', sessionSecret: 'y'.repeat(32), secureCookies: true,
  supabaseUrl: 'https://db.example.test', supabaseSecretKey: 'test-service-key',
};

function ok(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}

void test('AI advice uses server-owned answer and rubric, omits student identity, and persists no final grade', async () => {
  let savedReview: unknown = null;
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.includes('translation_attempt_answers?') && init?.method === 'PATCH') {
      const saved = JSON.parse(String(init.body)) as Record<string, unknown>;
      assert.equal(Object.keys(saved).join(','), 'ai_review,provisional_score');
      assert.equal(saved.provisional_score, 10);
      savedReview = saved.ai_review;
      return ok([{ id: answerId }]);
    }
    if (url.includes('translation_attempt_answers?')) return ok([{ id: answerId, attempt_id: attemptId, question_id: questionId,
      raw_answer: "What's your first class?", final_score: null, ai_review: null, updated_at: updatedAt }]);
    if (url.includes('translation_attempts?')) return ok([{ id: attemptId, quiz_id: 'G8-DEMO-READING', quiz_version: 1, status: 'submitted' }]);
    if (url.includes('translation_questions?')) return ok([{ id: questionId, prompt_zh: '你的第一堂課是什麼？',
      segmented_answer: 'What is / your first class?', max_score: 10 }]);
    if (url.includes('translation_rubric_units?')) return ok([{ label: '語意', requirement: '天氣與地點', points: 5 }]);
    if (url === 'https://api.openai.com/v1/responses') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body.store, false);
      assert.equal(body.model, 'gpt-test');
      const prompt = String(body.input);
      assert.match(prompt, /What's your first class/);
      assert.doesNotMatch(prompt, /classCode|seatNumber|studentId|enrollment/);
      return ok({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text',
        text: JSON.stringify({ suggestedScore: 10, confidence: 0.8, reason: '語意完整，替代句型正確。' }) }] }] });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const suggestion = await suggestAnswerWithAi(config, { provider: 'openai', apiKey: 'mock-api-key', model: 'gpt-test' }, { answerId, updatedAt }, fetcher as typeof fetch);
  assert.equal(suggestion.suggestedScore, 10);
  assert.equal(suggestion.confidence, 0.8);
  assert.deepEqual(savedReview, suggestion);
});

void test('stale answer blocks AI call and database write', async () => {
  let count = 0;
  const fetcher = async (): Promise<Response> => {
    count++;
    return ok([{ id: answerId, attempt_id: attemptId, question_id: questionId,
      raw_answer: 'Hello', final_score: null, ai_review: null, updated_at: '2026-09-29T03:00:00Z' }]);
  };
  await assert.rejects(suggestAnswerWithAi(config, { provider: 'openai', apiKey: 'mock-api-key', model: 'gpt-test' }, { answerId, updatedAt }, fetcher as typeof fetch), /已變更/);
  assert.equal(count, 1);
});

void test('AI advice input accepts only an answer id and parseable timestamp', () => {
  assert.deepEqual(parseAiSuggestionInput({ answerId, updatedAt }), { answerId, updatedAt });
  assert.throws(() => parseAiSuggestionInput({ answerId: 'not-a-uuid', updatedAt }), /不正確/);
  assert.throws(() => parseAiSuggestionInput({ answerId, updatedAt: 'invalid' }), /不正確/);
});

void test('AI is off unless a provider and key are configured', async () => {
  const { getAiConfig } = await import('../lib/server/ai-provider.ts');
  const prior = { ...process.env };
  try {
    delete process.env.AI_PROVIDER; delete process.env.OPENAI_API_KEY; delete process.env.OPENAI_MODEL;
    assert.equal(getAiConfig(), null);
    process.env.OPENAI_API_KEY = 'sk-test';
    assert.equal(getAiConfig()?.provider, 'openai');
    process.env.AI_PROVIDER = 'none';
    assert.equal(getAiConfig(), null);
    process.env.AI_PROVIDER = 'openai'; process.env.OPENAI_MODEL = 'custom-model';
    assert.equal(getAiConfig()?.model, 'custom-model');
  } finally {
    process.env = prior;
  }
});
