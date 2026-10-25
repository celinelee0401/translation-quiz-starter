import { suggestTranslationScore, type MatchSuggestion } from '../grading.ts';
import type { DataConfig } from './config.ts';
import { AI_AUTO_MARK } from './auto-finalize.ts';
import type { TeacherQuiz } from './teacher-overview.ts';

type AttemptRow = {
  id: string;
  quiz_id: string;
  quiz_version: number;
  enrollment_id: string;
  server_submit_time: string;
  status: 'submitted' | 'review-pending' | 'finalized';
  final_score: number | null;
};
type AnswerRow = {
  id: string;
  attempt_id: string;
  question_id: string;
  raw_answer: string;
  final_score: number | null;
  ai_review: AiScoreSuggestion | null;
  updated_at: string;
};
export type AiScoreSuggestion = {
  model: string;
  version: string;
  suggestedScore: number;
  confidence: number;
  reason: string;
  studentFeedback?: string;
  createdAt: string;
};
type EnrollmentRow = {
  id: string;
  class_code: string;
  seat_number: number;
};
type AuditRow = {
  entity_id: string;
  occurred_at: string;
  actor_id: string;
  before_data: { answerId?: string; previousScore?: number | null } | null;
  after_data: { answerId?: string; score?: number; reason?: string; note?: string } | null;
};
type QueueRow = { answer_id: string; reason: string; status: string };

export type TeacherReviewAttempt = {
  id: string;
  quizTitle: string;
  quizId: string;
  scoreMode: TeacherQuiz['scoreMode'];
  classCode: string;
  seatNumber: number;
  submittedAt: string;
  status: AttemptRow['status'];
  finalScore: number | null;
  answers: Array<{
    id: string;
    questionKey: string;
    prompt: string;
    textbookAnswer: string;
    rubric: TeacherQuiz['questions'][number]['rubric'];
    rawAnswer: string;
    maxScore: number;
    finalScore: number | null;
    aiReview: AiScoreSuggestion | null;
    openAppeal: boolean;
    appealNotes: string[];
    lowConfidence: boolean;
    autoAdopted: boolean;
    updatedAt: string;
    history: Array<{
      occurredAt: string;
      teacher: string;
      previousScore: number | null;
      score: number;
      reason: string;
    }>;
    suggestion: MatchSuggestion;
  }>;
};

export async function loadTeacherReview(
  config: DataConfig,
  quizzes: TeacherQuiz[],
  fetcher: typeof fetch = fetch,
  offset = 0,
  onlyAttemptIds?: string[],
  unfinalizedOnly = false,
): Promise<TeacherReviewAttempt[]> {
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000) throw new Error('覆核頁碼不正確。');
  if (onlyAttemptIds && (onlyAttemptIds.length > 50 || onlyAttemptIds.some(id => !/^[0-9a-f-]{36}$/i.test(id)))) {
    throw new Error('覆核資料查詢條件不正確。');
  }
  if (onlyAttemptIds && !onlyAttemptIds.length) return [];
  const attempts = await readRows<AttemptRow[]>(
    config,
    onlyAttemptIds
      ? `translation_attempts?select=id,quiz_id,quiz_version,enrollment_id,server_submit_time,status,final_score&id=in.(${onlyAttemptIds.join(',')})&limit=50`
      : `translation_attempts?select=id,quiz_id,quiz_version,enrollment_id,server_submit_time,status,final_score&status=in.(${unfinalizedOnly ? 'submitted,review-pending' : 'submitted,review-pending,finalized'})&order=server_submit_time.desc&limit=50&offset=${offset}`,
    fetcher,
  );
  if (!attempts.length) return [];

  const ids = attempts.map((attempt) => attempt.id);
  const enrollmentIds = [...new Set(attempts.map((attempt) => attempt.enrollment_id))];
  const [answers, enrollments, audit, appeals, queue] = await Promise.all([
    readPages<AnswerRow>(
      config,
      `translation_attempt_answers?select=id,attempt_id,question_id,raw_answer,final_score,ai_review,updated_at&attempt_id=in.(${ids.join(',')})`,
      fetcher,
      5000,
    ),
    readRows<EnrollmentRow[]>(
      config,
      `enrollments?select=id,class_code,seat_number&id=in.(${enrollmentIds.join(',')})&limit=51`,
      fetcher,
    ),
    readPages<AuditRow>(
      config,
      `translation_audit_log?select=entity_id,occurred_at,actor_id,before_data,after_data&entity_type=eq.translation-attempt&action=eq.teacher-review-answer&entity_id=in.(${ids.join(',')})&order=occurred_at.desc`,
      fetcher,
      10000,
    ),
    readPages<AuditRow>(config,
      `translation_audit_log?select=entity_id,occurred_at,actor_id,before_data,after_data&entity_type=eq.translation-attempt&action=eq.student-translation-appeal&entity_id=in.(${ids.join(',')})&order=occurred_at.desc`,
      fetcher, 10000),
    readPages<QueueRow>(config,
      `translation_review_queue?select=answer_id,reason,status&attempt_id=in.(${ids.join(',')})&status=eq.open`,
      fetcher, 5000),
  ]);
  if (answers.length > 5000 || enrollments.length < enrollmentIds.length || audit.length > 10000 || appeals.length > 10000 || queue.length > 5000) {
    throw new Error('覆核資料不完整，請勿依此畫面評分。');
  }

  const enrollmentById = new Map(enrollments.map((row) => [row.id, row]));
  const quizByKey = new Map(quizzes.map((quiz) => [`${quiz.quizId}:${quiz.version}`, quiz]));
  return attempts.map((attempt) => {
    const quiz = quizByKey.get(`${attempt.quiz_id}:${attempt.quiz_version}`);
    const enrollment = enrollmentById.get(attempt.enrollment_id);
    if (!quiz || !enrollment) throw new Error('覆核資料不完整，請勿依此畫面評分。');
    const questionById = new Map(quiz.questions.map((question) => [question.id, question]));
    const matchingAnswers = answers.filter((answer) => answer.attempt_id === attempt.id);
    if (matchingAnswers.length !== quiz.questions.length) {
      throw new Error('作答題數與測驗版本不一致，請勿依此畫面評分。');
    }
    return {
      id: attempt.id,
      quizTitle: quiz.title,
      quizId: quiz.quizId,
      scoreMode: quiz.scoreMode,
      classCode: enrollment.class_code,
      seatNumber: enrollment.seat_number,
      submittedAt: attempt.server_submit_time,
      status: attempt.status,
      finalScore: attempt.final_score,
      answers: matchingAnswers.map((answer) => {
        const question = questionById.get(answer.question_id);
        if (!question) throw new Error('題目版本不一致，請勿依此畫面評分。');
        return {
          id: answer.id,
          questionKey: question.key,
          prompt: question.prompt,
          textbookAnswer: question.answer,
          rubric: question.rubric,
          rawAnswer: answer.raw_answer,
          maxScore: question.points,
          finalScore: answer.final_score,
          aiReview: answer.ai_review,
          openAppeal: queue.some(item => item.answer_id === answer.id && item.reason === 'student-appeal'),
          lowConfidence: queue.some(item => item.answer_id === answer.id && item.reason === 'low-confidence') ||
            Boolean(answer.ai_review && answer.ai_review.confidence < 0.8),
          appealNotes: appeals.filter(event => event.entity_id === attempt.id && event.after_data?.answerId === answer.id)
            .map(event => event.after_data?.note ?? '').filter(Boolean),
          autoAdopted: Boolean(audit.find(event => event.entity_id === attempt.id && event.after_data?.answerId === answer.id)
            ?.after_data?.reason?.startsWith(AI_AUTO_MARK)),
          updatedAt: answer.updated_at,
          history: audit
            .filter((event) => event.entity_id === attempt.id && event.after_data?.answerId === answer.id)
            .map((event) => ({
              occurredAt: event.occurred_at,
              teacher: event.actor_id,
              previousScore: event.before_data?.previousScore ?? null,
              score: Number(event.after_data?.score),
              reason: event.after_data?.reason ?? '',
            })),
          suggestion: suggestTranslationScore(answer.raw_answer, question.answer, question.points, {
            questionKey: question.key,
            approvedRubricVersion: quiz.rubricApproval?.version,
          }),
        };
      }),
    };
  });
}

async function readPages<T>(config: DataConfig, path: string, fetcher: typeof fetch, maxRows: number): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset <= maxRows; offset += 500) {
    const batch = await readRows<T[]>(config, `${path}&limit=500&offset=${offset}`, fetcher);
    rows.push(...batch);
    if (batch.length < 500) return rows;
  }
  throw new Error('覆核資料超過目前頁面容量。');
}

async function readRows<T>(config: DataConfig, path: string, fetcher: typeof fetch): Promise<T> {
  const response = await fetcher(`${config.supabaseUrl}/rest/v1/${path}`, {
    headers: {
      apikey: config.supabaseSecretKey,
      authorization: `Bearer ${config.supabaseSecretKey}`,
      accept: 'application/json',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`覆核資料讀取失敗（HTTP ${response.status}）。`);
  return await response.json() as T;
}

export type ReviewGroup = {
  quizId: string;
  version: number;
  title: string;
  grade: number;
  classCode: string;
  opensAt: string;
  submitted: number;
  finalized: number;
  pendingAnswers: number;
  /** Unscored, non-blank answers the AI has not looked at yet. */
  awaitingAi: number;
  /** Answers finalized by automatic adoption. */
  aiAdopted: number;
  /** Unscored answers a student asked the teacher to look at again. */
  appealAnswers: number;
  attemptIds: string[];
  pendingAttemptIds: string[];
};

/**
 * One row per quiz × class that has submissions, in the order the classes
 * were opened, with how many answers still need the teacher.
 */
export async function loadReviewOverview(config: DataConfig, quizzes: TeacherQuiz[],
  fetcher: typeof fetch = fetch): Promise<ReviewGroup[]> {
  const attempts = await readPages<{ id: string; quiz_id: string; quiz_version: number; enrollment_id: string; status: string }>(config,
    'translation_attempts?select=id,quiz_id,quiz_version,enrollment_id,status&status=in.(submitted,review-pending,finalized)&order=id.asc',
    fetcher, 20000);
  if (!attempts.length) return [];
  const enrollmentIds = [...new Set(attempts.map(attempt => attempt.enrollment_id))];
  const classByEnrollment = new Map<string, string>();
  for (let index = 0; index < enrollmentIds.length; index += 150) {
    const rows = await readRows<EnrollmentRow[]>(config,
      `enrollments?select=id,class_code,seat_number&id=in.(${enrollmentIds.slice(index, index + 150).join(',')})&limit=151`, fetcher);
    for (const row of rows) classByEnrollment.set(row.id, row.class_code);
  }
  const pendingIds = attempts.filter(attempt => attempt.status !== 'finalized').map(attempt => attempt.id);
  const unscoredByAttempt = new Map<string, number>();
  const awaitingByAttempt = new Map<string, number>();
  for (let index = 0; index < pendingIds.length; index += 100) {
    const rows = await readPages<{ attempt_id: string; raw_answer: string; ai_review: unknown }>(config,
      `translation_attempt_answers?select=attempt_id,raw_answer,ai_review&attempt_id=in.(${pendingIds.slice(index, index + 100).join(',')})&final_score=is.null&order=id.asc`,
      fetcher, 5000);
    for (const row of rows) {
      unscoredByAttempt.set(row.attempt_id, (unscoredByAttempt.get(row.attempt_id) ?? 0) + 1);
      if (!row.ai_review && row.raw_answer.trim()) awaitingByAttempt.set(row.attempt_id, (awaitingByAttempt.get(row.attempt_id) ?? 0) + 1);
    }
  }
  // Open appeals are few, so read them all. An appeal can also be on an answer
  // that was already finalized (for example by automatic adoption).
  const appeals = await readPages<{ attempt_id: string; answer_id: string }>(config,
    'translation_review_queue?select=attempt_id,answer_id&reason=eq.student-appeal&status=eq.open&order=id.asc', fetcher, 5000);
  const appealsByAttempt = new Map<string, number>();
  const scoredAppealsByAttempt = new Map<string, number>();
  const appealAnswerIds = [...new Set(appeals.map(row => row.answer_id))];
  const scoredAppealIds = new Set<string>();
  for (let index = 0; index < appealAnswerIds.length; index += 100) {
    const rows = await readRows<Array<{ id: string; final_score: number | null }>>(config,
      `translation_attempt_answers?select=id,final_score&id=in.(${appealAnswerIds.slice(index, index + 100).join(',')})&limit=101`, fetcher);
    for (const row of rows) if (row.final_score !== null) scoredAppealIds.add(row.id);
  }
  for (const row of appeals) {
    appealsByAttempt.set(row.attempt_id, (appealsByAttempt.get(row.attempt_id) ?? 0) + 1);
    if (scoredAppealIds.has(row.answer_id)) scoredAppealsByAttempt.set(row.attempt_id, (scoredAppealsByAttempt.get(row.attempt_id) ?? 0) + 1);
  }
  const adoptedByAttempt = new Map<string, number>();
  const markers = await readPages<{ entity_id: string }>(config,
    'translation_audit_log?select=entity_id&entity_type=eq.translation-attempt&action=eq.ai-auto-finalize&order=id.asc', fetcher, 50000);
  for (const row of markers) adoptedByAttempt.set(row.entity_id, (adoptedByAttempt.get(row.entity_id) ?? 0) + 1);
  const groups = new Map<string, ReviewGroup>();
  for (const attempt of attempts) {
    const quiz = quizzes.find(item => item.quizId === attempt.quiz_id && item.version === attempt.quiz_version);
    const classCode = classByEnrollment.get(attempt.enrollment_id);
    if (!quiz || !classCode) continue;
    const key = `${quiz.quizId}:${quiz.version}:${classCode}`;
    const group = groups.get(key) ?? {
      quizId: quiz.quizId, version: quiz.version, title: quiz.title, grade: quiz.grade, classCode,
      opensAt: quiz.targets.find(target => target.classCode === classCode)?.opensAt ?? '',
      submitted: 0, finalized: 0, pendingAnswers: 0, awaitingAi: 0, aiAdopted: 0, appealAnswers: 0, attemptIds: [], pendingAttemptIds: [],
    };
    group.submitted++;
    group.attemptIds.push(attempt.id);
    group.aiAdopted += adoptedByAttempt.get(attempt.id) ?? 0;
    if (attempt.status === 'finalized') group.finalized++;
    else {
      group.pendingAnswers += unscoredByAttempt.get(attempt.id) ?? 0;
      group.awaitingAi += awaitingByAttempt.get(attempt.id) ?? 0;
    }
    group.appealAnswers += appealsByAttempt.get(attempt.id) ?? 0;
    // An appeal on an already scored answer still needs the teacher.
    group.pendingAnswers += scoredAppealsByAttempt.get(attempt.id) ?? 0;
    if (attempt.status !== 'finalized' || appealsByAttempt.has(attempt.id)) group.pendingAttemptIds.push(attempt.id);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) =>
    (Date.parse(a.opensAt) || 0) - (Date.parse(b.opensAt) || 0) || a.classCode.localeCompare(b.classCode));
}
