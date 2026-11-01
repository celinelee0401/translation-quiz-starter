import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { validateNewDraft } from '../lib/server/create-quiz-draft.ts';

void test('the bundled demo quiz passes the same checks as a teacher-created draft', async () => {
  const drafts = JSON.parse(await readFile(new URL('../examples/demo-quiz.json', import.meta.url), 'utf8')) as unknown[];
  for (const draft of drafts) {
    const valid = validateNewDraft(draft);
    const total = valid.questions.reduce((sum, q) => sum + q.meaning + q.grammar + 1, 0);
    // The semester importer only accepts quizzes worth exactly 100 points.
    assert.equal(total, 100);
  }
});
