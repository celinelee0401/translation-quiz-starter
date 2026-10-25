import assert from 'node:assert/strict';
import test from 'node:test';
import { canArchiveQuiz, quizGroup } from '../lib/quiz-management.ts';
import { changeQuizArchive } from '../lib/server/archive-quiz.ts';
import type { TeacherQuiz } from '../lib/server/teacher-overview.ts';
import type { DataConfig } from '../lib/server/config.ts';

const now = Date.parse('2026-10-01T00:00:00Z');
const base: TeacherQuiz = {
  quizId: 'G8-U1-TEST', version: 1, title: '測試', grade: 8,
  scoreMode: 'formal', feedbackPolicy: 'teacher-release', status: 'published',
  questions: [], targets: [{ classCode: '802', opensAt: '2026-09-29T00:00:00Z',
    closesAt: '2026-09-29T01:00:00Z', dashboardVisible: true }],
};
const config: DataConfig = {
  loginMode: 'pin',
  schoolYear: '115', sessionSecret: 'y'.repeat(32), secureCookies: true,
  supabaseUrl: 'https://database.example.test', supabaseSecretKey: 'test-service-key',
};
function response(data: unknown) { return new Response(JSON.stringify(data), { status: 200 }); }

void test('teacher list groups ended windows and only archives ended or draft quizzes', () => {
  assert.equal(quizGroup(base, now), 'ended');
  assert.equal(canArchiveQuiz(base, now), true);
  const active = { ...base, targets: [{ ...base.targets[0], closesAt: '2026-10-02T00:00:00Z' }] };
  assert.equal(quizGroup(active, now), 'active');
  assert.equal(canArchiveQuiz(active, now), false);
  assert.equal(canArchiveQuiz({ ...base, status: 'draft' }, now), true);
  assert.equal(quizGroup({ ...base, status: 'archived' }, now), 'archived');
});

void test('archive updates only status and writes audit; never deletes records', async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (!init?.method) {
      if (url.includes('translation_quizzes?')) return response([{
        quiz_id: base.quizId, quiz_version: 1, title: base.title, grade_level: 8,
        score_mode: 'formal', feedback_policy: 'teacher-release', status: 'published',
      }]);
      if (url.includes('translation_quiz_targets?')) return response([{
        quiz_id: base.quizId, quiz_version: 1, class_code: '802',
        opens_at: base.targets[0].opensAt, closes_at: base.targets[0].closesAt,
        dashboard_visible: true,
      }]);
      return response([]);
    }
    calls.push({ url, method: init.method, body: JSON.parse(typeof init.body === 'string' ? init.body : '') });
    return response([{ id: 1, status: 'archived' }]);
  };
  await changeQuizArchive(config, base.quizId, 1, 'archive', 'teacher@example.test', fetcher as typeof fetch);
  assert.deepEqual(calls.map(call => call.method), ['POST', 'PATCH']);
  assert.deepEqual(calls[1].body, { status: 'archived' });
  assert.ok(calls[1].url.includes('status=eq.published'));
  assert.ok(!calls.some(call => call.method === 'DELETE'));
});

void test('search treats Unit 2, unit2, 第二課 and U2 as the same unit, case and width insensitive', async () => {
  const { quizMatchesQuery, compareQuizTitles } = await import('../lib/quiz-management.ts');
  const quiz = { quizId: 'CUSTOM-G8-0123456789ABCDEF', title: 'G8 U2 Dialogue｜左頁 p.21', unitLabel: 'G8 U2 Dialogue p.21' };
  for (const query of ['Unit 2', 'unit2', 'UNIT 2 dialogue', '第二課', '第2課', 'u2', 'Ｕ２', 'U2 對話', '八年級 U2', 'p.21', '']) {
    assert.equal(quizMatchesQuery(quiz, query), true, query);
  }
  for (const query of ['Unit 3', 'U2 Reading', 'G9', '對話 p.22', '0', '12']) {
    assert.equal(quizMatchesQuery(quiz, query), false, query);
  }
  assert.equal(quizMatchesQuery(quiz, 'custom-g8-0123'), true);
  const titles = ['G8 U10 Reading', 'G8 U2 Reading｜p.103', 'G8 U2 Reading｜p.21'].map(title => ({ title }));
  assert.deepEqual(titles.sort(compareQuizTitles).map(item => item.title),
    ['G8 U2 Reading｜p.21', 'G8 U2 Reading｜p.103', 'G8 U10 Reading']);
});

void test('drafts report the first unmet release check, or null when ready to publish', async () => {
  const { draftNextStep, targetPhase } = await import('../lib/quiz-management.ts');
  const draft: TeacherQuiz = { ...base, status: 'draft', targets: [] };
  assert.equal(draftNextStep(draft, new Date(now)), '題目與學習提示');
  assert.equal(draftNextStep(base, new Date(now)), null);
  const window = { opensAt: '2026-10-01T00:00:00Z', closesAt: '2026-10-01T01:00:00Z' };
  assert.equal(targetPhase(window, now - 1), 'upcoming');
  assert.equal(targetPhase(window, now), 'active');
  assert.equal(targetPhase(window, Date.parse(window.closesAt)), 'ended');
});
