import assert from 'node:assert/strict';
import { test } from 'node:test';
import { feedbackReleased, loadStudentResult, releaseFeedback } from '../lib/server/feedback.ts';
import { gradesToCsv } from '../lib/server/grade-export.ts';
import { enableLiveFeedback, isWithinClassWindow } from '../lib/server/live-feedback.ts';

const config = { supabaseUrl: 'https://example.supabase.co', supabaseSecretKey: 'secret', schoolYear: '115' } as const;
const response = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });

void test('formal feedback stays hidden until teacher release', async () => {
  const target = { id: 'target-1', class_code: '802', closes_at: '2026-01-01T00:00:00Z', feedback_at: null };
  const queries: string[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); queries.push(url);
    if (init?.method === 'POST') return new Response(null, { status: 201 });
    if (url.includes('translation_quizzes?')) return response([{ title: 'U1', status: 'published', feedback_policy: 'teacher-release' }]);
    if (url.includes('translation_quiz_targets?')) return response([target]);
    if (url.includes('translation_attempts?') && url.includes('status=in.(submitted,review-pending)')) return response([]);
    if (url.includes('translation_attempts?') && url.includes('status=in.(')) return response([{ id: 'attempt-1', target_id: 'target-1', status: 'finalized', final_score: 80, server_submit_time: '2026-01-01T00:00:00Z' }]);
    if (url.includes('translation_attempts?')) return response([]);
    if (url.includes('translation_audit_log?')) return response([]);
    throw new Error(url);
  };
  const session = { studentId: 'student-1', enrollmentId: 'enrollment-1', schoolYear: '115', classCode: '802' };
  const result = await loadStudentResult(config as never, session as never, 'G8-U1', 1, fetcher as typeof fetch);
  assert.equal(result?.status, 'pending');
  assert.ok(queries.every(url => !url.includes('translation_questions?') && !url.includes('translation_attempt_answers?')));
  assert.equal(await feedbackReleased(config as never, 'G8-U1', 1, { title: 'U1', status: 'published', feedback_policy: 'teacher-release' }, [target], target.id, fetcher as typeof fetch), false);
  await releaseFeedback(config as never, 'G8-U1', 1, 'teacher', fetcher as typeof fetch);
  assert.ok(queries.some(url => url.endsWith('/translation_audit_log')));
});

void test('grade CSV is Excel-compatible and blocks formula injection', () => {
  const csv = gradesToCsv([{ schoolYear: '115', classCode: '802', seatNumber: 1, quizId: 'G8-U1',
    quizTitle: '=unsafe', quizVersion: 1, finalScore: 87, maxScore: 100, submittedAt: '2026-09-29T00:00:00Z', attemptId: 'uuid' }]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"\'=unsafe"'));
  assert.ok(csv.includes('"87","100"'));
});

void test('live feedback belongs to one class, follows server time, and marks unreviewed scores provisional', async () => {
  const target = { id: 'target-802', class_code: '802', opens_at: new Date(Date.now() - 60_000).toISOString(),
    closes_at: new Date(Date.now() + 60_000).toISOString(), feedback_at: null };
  const paths: string[] = [];
  const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input); paths.push(url);
    if (url.includes('translation_quizzes?')) return response([{ title: 'U1', status: 'published', rubric_version: 'other', feedback_policy: 'teacher-release' }]);
    if (url.includes('translation_quiz_targets?')) return response([target]);
    if (url.includes('translation_attempts?')) return response([{ id: 'attempt-1', target_id: target.id,
      status: 'submitted', final_score: null, server_submit_time: new Date().toISOString() }]);
    if (url.includes('action=eq.enable-live-feedback')) return response([{ id: 1 }]);
    if (url.includes('translation_attempt_answers?')) return response([{ id: 'answer-1', question_id: 'q1', raw_answer: 'How are you?', final_score: null }]);
    if (url.includes('translation_questions?')) return response([{ id: 'q1', question_key: 'Q1', prompt_zh: '你好嗎？',
      segmented_answer: 'How / are you?', hint: '注意問號。', max_score: 10, display_order: 1 }]);
    if (url.includes('translation_audit_log?')) return response([]);
    throw new Error(url);
  };
  const session = { studentId: 'student-1', enrollmentId: 'enrollment-1', schoolYear: '115', classCode: '802' };
  const result = await loadStudentResult(config as never, session as never, 'G8-U1', 1, fetcher as typeof fetch);
  assert.equal(result?.status, 'provisional');
  assert.equal(result?.score, 10);
  assert.equal(result?.details?.[0].scoreState, 'suggested');
  assert.equal(result?.endsAt, target.closes_at);
  target.closes_at = new Date(Date.now() - 1000).toISOString();
  const before = paths.length;
  const expired = await loadStudentResult(config as never, session as never, 'G8-U1', 1, fetcher as typeof fetch);
  assert.equal(expired?.status, 'expired');
  assert.ok(paths.slice(before).every(path => !path.includes('translation_questions?')));
  const otherClass = await loadStudentResult(config as never, { ...session, classCode: '801' } as never, 'G8-U1', 1, fetcher as typeof fetch);
  assert.equal(otherClass, null);
  assert.equal(isWithinClassWindow({ opens_at: target.opens_at, closes_at: target.closes_at }), false);
});

void test('published formal quiz automatically shows AI provisional advice only inside its class window', async () => {
  const target = { id: 'target-802', class_code: '802', opens_at: new Date(Date.now() - 60_000).toISOString(),
    closes_at: new Date(Date.now() + 60_000).toISOString(), feedback_at: null };
  const paths: string[] = [];
  const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input); paths.push(url);
    if (url.includes('translation_quizzes?')) return response([{ title: 'U1', status: 'published', score_mode: 'formal',
      rubric_version: 'other', feedback_policy: 'teacher-release' }]);
    if (url.includes('translation_quiz_targets?')) return response([target]);
    if (url.includes('translation_attempts?')) return response([{ id: 'attempt-1', target_id: target.id,
      status: 'submitted', final_score: null, server_submit_time: new Date().toISOString() }]);
    if (url.includes('translation_attempt_answers?')) return response([{ id: 'answer-1', question_id: 'q1',
      raw_answer: "What's your first class?", final_score: null,
      ai_review: { suggestedScore: 9, confidence: 0.91, reason: '語意正確，使用合理替代句型。' } }]);
    if (url.includes('translation_questions?')) return response([{ id: 'q1', question_key: 'Q1', prompt_zh: '你的第一堂課是什麼？',
      segmented_answer: 'What is / your first class?', hint: '注意過去式。', max_score: 10, display_order: 1 }]);
    if (url.includes('translation_audit_log?')) return response([]);
    throw new Error(url);
  };
  const session = { studentId: 'student-1', enrollmentId: 'enrollment-1', schoolYear: '115', classCode: '802' };
  const shown = await loadStudentResult(config as never, session as never, 'G8-U1', 1, fetcher as typeof fetch);
  assert.equal(shown?.status, 'provisional');
  assert.equal(shown?.score, 9);
  assert.ok(!paths.some(path => path.includes('action=eq.enable-live-feedback')));
  target.closes_at = new Date(Date.now() - 1000).toISOString();
  const expired = await loadStudentResult(config as never, session as never, 'G8-U1', 1, fetcher as typeof fetch);
  assert.equal(expired?.status, 'expired');
  assert.ok(!('details' in (expired ?? {})));
});

void test('teacher can enable only the selected published class before its deadline', async () => {
  let writes = 0;
  const target = { id: 'target-801', quiz_id: 'G8-U1', quiz_version: 1, school_year: '115', class_code: '801',
    opens_at: new Date(Date.now() + 60_000).toISOString(), closes_at: new Date(Date.now() + 120_000).toISOString(), dashboard_visible: true };
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') { writes++; assert.equal(JSON.parse(String(init.body)).entity_id, target.id); return new Response(null, { status: 201 }); }
    if (url.includes('translation_quizzes?')) return response([{ status: 'published', score_mode: 'formal', feedback_policy: 'teacher-release' }]);
    if (url.includes('translation_quiz_targets?')) return response([target]);
    if (url.includes('translation_audit_log?')) return response([]);
    throw new Error(url);
  };
  await enableLiveFeedback(config as never, 'G8-U1', 1, '801', 'teacher', fetcher as typeof fetch);
  assert.equal(writes, 1);
  target.closes_at = new Date(Date.now() - 1).toISOString();
  await assert.rejects(enableLiveFeedback(config as never, 'G8-U1', 1, '801', 'teacher', fetcher as typeof fetch), /已截止/);
  assert.equal(writes, 1);
  assert.equal(isWithinClassWindow({ opens_at: '2026-09-29T00:00:00Z', closes_at: '2026-09-29T01:00:00Z' }, new Date('2026-09-29T01:00:00Z')), false);
});

void test('old submitted students cannot view an answer key during a reopened makeup window', async () => {
  const target = { id: 'target-802', class_code: '802',
    opens_at: new Date(Date.now() - 60_000).toISOString(),
    closes_at: new Date(Date.now() + 60_000).toISOString(), feedback_at: null };
  const paths: string[] = [];
  const fetcher = async (resource: RequestInfo | URL): Promise<Response> => {
    const url = typeof resource === 'string' ? resource : resource instanceof URL ? resource.href : resource.url;
    paths.push(url);
    if (url.includes('translation_quizzes?')) return response([{ title: 'U1', status: 'published', feedback_policy: 'teacher-release' }]);
    if (url.includes('translation_quiz_targets?')) return response([target]);
    if (url.includes('translation_attempts?')) return response([{ id: 'prior-attempt', target_id: target.id,
      status: 'finalized', final_score: 90, server_submit_time: new Date(Date.now() - 3600_000).toISOString() }]);
    if (url.includes('action=eq.enable-live-feedback')) return response([{ id: 1 }]);
    throw new Error(`Answer data should stay hidden: ${url}`);
  };
  const session = { studentId: 'student-1', enrollmentId: 'enrollment-1', schoolYear: '115', classCode: '802' };
  const result = await loadStudentResult(config as never, session as never, 'G8-U1', 1, fetcher as typeof fetch);
  assert.equal(result?.status, 'expired');
  assert.ok(paths.every(path => !path.includes('translation_attempt_answers?') && !path.includes('translation_questions?')));
});

void test('scheduled class feedback remains hidden during makeup and persists after its cutoff', async () => {
  const target = { id: 'target-801', class_code: '801',
    opens_at: new Date(Date.now() - 60_000).toISOString(),
    closes_at: new Date(Date.now() + 60_000).toISOString(),
    feedback_at: new Date(Date.now() + 60_000).toISOString() };
  const seen: string[] = [];
  const fetcher = async (resource: RequestInfo | URL): Promise<Response> => {
    const url = typeof resource === 'string' ? resource : resource instanceof URL ? resource.href : resource.url;
    seen.push(url);
    if (url.includes('translation_quizzes?')) return response([{ title: 'Reading p.11', status: 'published',
      score_mode: 'formal', rubric_version: 'other', feedback_policy: 'teacher-release' }]);
    if (url.includes('translation_quiz_targets?')) return response([target]);
    if (url.includes('translation_attempts?')) return response([{ id: 'prior-attempt', target_id: target.id,
      status: 'submitted', final_score: null, server_submit_time: new Date(Date.now() - 3600_000).toISOString() }]);
    if (url.includes('translation_attempt_answers?')) return response([{ id: 'answer-1', question_id: 'q1',
      raw_answer: "What's your first class?", final_score: null,
      ai_review: { suggestedScore: 9, confidence: 0.91, reason: '合理替代句型。' } }]);
    if (url.includes('translation_questions?')) return response([{ id: 'q1', question_key: 'Q1', prompt_zh: '你的第一堂課是什麼？',
      segmented_answer: 'What is / your first class?', hint: '注意過去式。', max_score: 10, display_order: 1 }]);
    if (url.includes('translation_audit_log?')) return response([]);
    throw new Error(url);
  };
  const session = { studentId: 'student-1', enrollmentId: 'enrollment-1', schoolYear: '115', classCode: '801' };
  const hidden = await loadStudentResult(config as never, session as never, 'G8-DEMO-READING-P11', 1, fetcher as typeof fetch);
  assert.equal(hidden?.status, 'expired');
  assert.equal(hidden?.availableAt, target.feedback_at);
  assert.ok(!seen.some(path => path.includes('translation_questions?')));
  target.closes_at = new Date(Date.now() - 1000).toISOString();
  target.feedback_at = target.closes_at;
  const shown = await loadStudentResult(config as never, session as never, 'G8-DEMO-READING-P11', 1, fetcher as typeof fetch);
  assert.equal(shown?.status, 'provisional');
  assert.equal(shown?.score, 9);
  assert.equal(shown?.endsAt, null);
  assert.equal(shown?.appealAllowed, true);
  assert.equal(shown?.details?.[0].textbookAnswer, 'What is your first class?');
});

test('column export lists every seat up to the highest seat and leaves missing scores blank', async () => {
  const { gradesToColumnCsv } = await import('../lib/server/grade-export.ts');
  const base = { schoolYear: '115', classCode: '801', quizId: 'Q', quizTitle: 'Q', quizVersion: 1,
    attemptId: 'a', submittedAt: '2026-10-02T00:00:00Z', maxScore: 100 };
  const csv = gradesToColumnCsv([{ ...base, seatNumber: 1, finalScore: 90 }, { ...base, seatNumber: 4, finalScore: 75.5 }]);
  assert.equal(csv, '﻿座號,分數\r\n1,90\r\n2,\r\n3,\r\n4,75.5\r\n');
});

test('AI HTTP errors map to messages that tell the teacher what to fix', async () => {
  const { aiHttpErrorMessage } = await import('../lib/server/ai-score-suggestion.ts');
  assert.match(aiHttpErrorMessage(401), /金鑰/);
  assert.match(aiHttpErrorMessage(404), /模型/);
  assert.match(aiHttpErrorMessage(429), /額度/);
  assert.match(aiHttpErrorMessage(503), /OpenAI/);
});
