import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateQuestionPoints, generateQuizQuestions, parseEnglishLines } from '../lib/server/generate-quiz-questions.ts';

void test('English-only input preserves textbook wording and rejects full-width punctuation', () => {
  assert.deepEqual(parseEnglishLines("That's too bad!\nI got to school / at seven thirty."), ["That's too bad!", 'I got to school / at seven thirty.']);
  assert.throws(() => parseEnglishLines('That is too bad！'), /半形/);
  assert.throws(() => parseEnglishLines(''), /1～20/);
});

void test('AI draft points total 100, keep short phrase modest, and reserve one writing point', () => {
  const answers = [
    'Mia, what time did you get to school this morning?',
    'I got to school at seven thirty with my brother.',
    'What is your first class?',
    'My first class is math, but I forgot to bring my textbook.',
    "That's too bad!",
  ];
  const suggestions = answers.map((_, index) => ({ chinesePrompt: `第${index + 1}題`, hint: '注意句型與標點。',
    importance: index === 4 ? 1 : 3, grammarFocus: 4 }));
  const questions = allocateQuestionPoints(answers, suggestions);
  assert.equal(questions.reduce((sum, q) => sum + q.meaning + q.grammar + 1, 0), 100);
  assert.equal(questions[4].meaning + questions[4].grammar + 1 <= 10, true);
  assert.ok(questions.every(q => q.meaning >= 1 && q.grammar >= 0 && q.answer === answers[questions.indexOf(q)]));
});

void test('AI authoring sends only English source and returns an editable unpublished proposal', async () => {
  const answers = ["That's too bad!", 'What time did you get to school?'];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    assert.equal(String(input), 'https://api.openai.com/v1/responses');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(body.store, false);
    assert.deepEqual(JSON.parse(String(body.input)), { englishAnswers: answers });
    return new Response(JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'output_text',
      text: JSON.stringify({ questions: [
        { chinesePrompt: '怎麼會？', hint: '這是口語疑問句，注意問號。', importance: 1, grammarFocus: 1 },
        { chinesePrompt: '你昨天在哪裡？', hint: '詢問過去地點時，留意 were。', importance: 4, grammarFocus: 4 },
      ] }),
    }] }] }), { status: 200 });
  };
  const questions = await generateQuizQuestions(answers, { provider: 'openai', apiKey: 'mock-key', model: 'gpt-test' }, fetcher as typeof fetch);
  assert.equal(questions[0].prompt, '怎麼會？');
  assert.equal(questions.reduce((sum, q) => sum + q.meaning + q.grammar + 1, 0), 100);
});
