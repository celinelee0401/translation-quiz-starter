import assert from 'node:assert/strict';
import test from 'node:test';
import { getReleaseChecks } from '../lib/release-readiness.ts';
import type { TeacherQuiz } from '../lib/server/teacher-overview.ts';

const baseQuiz: TeacherQuiz = {
  quizId: 'U1-P1', version: 1, title: 'Unit 1', grade: 8,
  scoreMode: 'formal', feedbackPolicy: 'teacher-release', status: 'draft',
  questions: [{
    id: 'q1', key: 'Q1', prompt: '你在哪裡？', answer: 'Where / are you?', hint: '使用疑問句。', points: 10,
    rubric: [{ label: '語意', requirement: '詢問地點', points: 6 }, { label: '文法', requirement: '使用正確疑問句', points: 4 }],
  }],
  targets: [{ classCode: '801', opensAt: '2026-10-01T00:00:00Z', closesAt: '2026-10-02T00:00:00Z', dashboardVisible: false }],
};

void test('formal draft retains manual gates even when automated checks pass', () => {
  const checks = getReleaseChecks(baseQuiz, new Date('2026-09-20T00:00:00Z'));
  assert.equal(checks.filter((check) => check.state === 'action').length, 0);
  assert.deepEqual(checks.filter((check) => check.state === 'manual').map((check) => check.label), [
    '教師核定題目與配分', '教師核定替代表達與評分細則', '共用 PIN 與學生端實測',
  ]);
});

void test('question and point confirmation does not approve scoring details or student release', () => {
  const checks = getReleaseChecks({
    ...baseQuiz,
    contentApproval: { by: 'teacher@example.test', at: '2026-09-20T00:00:00Z' },
  }, new Date('2026-09-20T00:00:00Z'));
  assert.equal(checks.find((check) => check.label === '教師核定題目與配分')?.state, 'pass');
  assert.equal(checks.find((check) => check.label === '教師核定替代表達與評分細則')?.state, 'manual');
  assert.equal(checks.find((check) => check.label === '共用 PIN 與學生端實測')?.state, 'manual');
});

void test('rubric approval clears only the scoring-detail gate', () => {
  const checks = getReleaseChecks({
    ...baseQuiz,
    contentApproval: { by: 'teacher@example.test', at: '2026-09-20T00:00:00Z' },
    rubricApproval: {
      by: 'teacher@example.test',
      at: '2026-09-26T00:00:00Z',
      version: 'u1-formal-rubric-v1',
    },
  }, new Date('2026-09-20T00:00:00Z'));
  assert.equal(checks.find((check) => check.label === '教師核定替代表達與評分細則')?.state, 'pass');
  assert.equal(checks.find((check) => check.label === '共用 PIN 與學生端實測')?.state, 'manual');
});

void test('a versioned isolated student flow clears the shared PIN gate', () => {
  const checks = getReleaseChecks({
    ...baseQuiz,
    studentE2E: {
      by: 'qa-runner',
      at: '2026-09-26T09:00:00Z',
      version: 'student-e2e-v1',
    },
  }, new Date('2026-09-20T00:00:00Z'));
  assert.equal(checks.find((check) => check.label === '共用 PIN 與學生端實測')?.state, 'pass');
});

void test('missing or expired targets and unsafe formal feedback block preflight', () => {
  const checks = getReleaseChecks({ ...baseQuiz, targets: [], feedbackPolicy: 'class-closed' });
  assert.deepEqual(checks.filter((check) => check.state === 'action').map((check) => check.label), [
    '班級與開放時段', '正式成績回饋時機',
  ]);
  const expired = getReleaseChecks(baseQuiz, new Date('2026-10-03T00:00:00Z'));
  assert.equal(expired.find((check) => check.label === '班級與開放時段')?.state, 'action');
});

void test('rubric totals must match each question', () => {
  const quiz = structuredClone(baseQuiz);
  quiz.questions[0].rubric[0].points = 5;
  assert.equal(getReleaseChecks(quiz).find((check) => check.label === '逐題評分單位與總分')?.state, 'action');
});
