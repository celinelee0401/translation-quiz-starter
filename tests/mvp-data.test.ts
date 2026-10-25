import assert from 'node:assert/strict';
import test from 'node:test';

import { quizMeta, quizQuestions } from '../lib/mvp-data.ts';
import { classCodesForQuizId, publicQuizQuestions } from '../lib/public-quiz-data.ts';

function questionMaxScore(question: (typeof quizQuestions)[number]): number {
  return question.rubric.reduce((total, unit) => total + unit.points, 0);
}

void test('the confirmed practice quiz totals 90 points', () => {
  const total = quizQuestions.reduce(
    (score, question) => score + questionMaxScore(question),
    0,
  );

  assert.equal(total, 90);
  assert.equal(quizMeta.maxScore, total);
  assert.equal(quizMeta.rubricVersion, 'rubric-v2');
});

void test('Q5 is capped at 10 points and rewards the target phrase', () => {
  const question = quizQuestions.find((item) => item.id === 'Q5');
  assert.ok(question);
  assert.equal(questionMaxScore(question), 10);
  assert.equal(question.rubric[0]?.points, 8);
  assert.equal(question.rubric[1]?.points, 2);

  const whyAlternative = question.scoredAlternatives?.find(
    (item) => item.answer === 'Oh no!',
  );
  assert.equal(whyAlternative?.score, 5);
});

void test('student-facing question data contains prompts only', () => {
  assert.deepEqual(
    quizQuestions.map(({ id, prompt }) => ({ id, prompt })),
    publicQuizQuestions,
  );
  assert.ok(publicQuizQuestions.every((question) =>
    !('segmentedAnswer' in question) &&
    !('rubric' in question) &&
    !('acceptedAlternatives' in question),
  ));
});

void test('student class choices follow school.config.ts grades', () => {
  assert.deepEqual(classCodesForQuizId('CUSTOM-G9-44386A4B866A4E68B36CC5229196628B'), ['901', '902']);
  assert.deepEqual(classCodesForQuizId('G8-DEMO'), ['801', '802']);
  assert.deepEqual(classCodesForQuizId('CUSTOM-G7-EXAMPLE'), ['801', '802', '901', '902']);
  assert.deepEqual(classCodesForQuizId('OTHER-QUIZ'), ['801', '802', '901', '902']);
});
