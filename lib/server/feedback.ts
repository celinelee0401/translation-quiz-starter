import type { DataConfig } from './config.ts';
import type { StudentSession } from './session.ts';
import { suggestTranslationScore } from '../grading.ts';
import { isLiveFeedbackEnabled, isWithinClassWindow } from './live-feedback.ts';
import { AI_AUTO_MARK } from './auto-finalize.ts';

type Quiz = { title: string; status: string; score_mode?: string; rubric_version?: string; feedback_policy: 'immediate' | 'class-closed' | 'all-closed' | 'teacher-release' };
type Target = { id: string; class_code: string; opens_at?: string; closes_at: string; feedback_at: string | null };
type Attempt = { id: string; target_id: string; status: string; final_score: number | null; server_submit_time: string };
type Answer = { id: string; question_id: string; raw_answer: string; final_score: number | null; ai_review?: { suggestedScore?: number; confidence?: number; reason?: string; studentFeedback?: string; version?: string } | null; updated_at?: string };
type Question = { id: string; question_key: string; prompt_zh: string; segmented_answer: string; hint: string; max_score: number; display_order: number };
type Audit = { after_data: { answerId?: string; reason?: string } | null };

const key = (quizId: string, version: number) => `quiz_id=eq.${encodeURIComponent(quizId)}&quiz_version=eq.${version}`;

export async function feedbackReleased(config: DataConfig, quizId: string, version: number,
  quiz: Quiz, targets: Target[], studentTargetId: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const now = Date.now();
  if (quiz.feedback_policy === 'immediate') return true;
  if (quiz.feedback_policy === 'class-closed') {
    const target = targets.find(item => item.id === studentTargetId);
    return Boolean(target && now >= Date.parse(target.feedback_at ?? target.closes_at));
  }
  if (!targets.length || targets.some(target => now < Date.parse(target.feedback_at ?? target.closes_at))) return false;
  if (quiz.feedback_policy === 'all-closed') return true;
  const releases = await read<Array<{ id: number }>>(config,
    `translation_audit_log?select=id&entity_type=eq.translation_quiz&entity_id=eq.${encodeURIComponent(`${quizId}:${version}`)}&action=eq.release-translation-feedback&limit=1`, fetcher);
  return releases.length === 1;
}

export async function loadStudentResult(config: DataConfig, session: StudentSession,
  quizId: string, version: number, fetcher: typeof fetch = fetch) {
  const [quizzes, targets, attempts] = await Promise.all([
    read<Quiz[]>(config, `translation_quizzes?select=title,status,score_mode,rubric_version,feedback_policy&${key(quizId, version)}&limit=2`, fetcher),
    read<Target[]>(config, `translation_quiz_targets?select=id,class_code,opens_at,closes_at,feedback_at&${key(quizId, version)}&school_year=eq.${session.schoolYear}&limit=100`, fetcher),
    read<Attempt[]>(config, `translation_attempts?select=id,target_id,status,final_score,server_submit_time&${key(quizId, version)}&student_id=eq.${session.studentId}&enrollment_id=eq.${session.enrollmentId}&status=in.(submitted,review-pending,finalized)&order=server_submit_time.desc&limit=2`, fetcher),
  ]);
  if (quizzes.length !== 1 || !attempts.length) return null;
  const quiz = quizzes[0];
  const attempt = attempts[0];
  const target = targets.find(item => item.id === attempt.target_id && item.class_code === session.classCode);
  if (!target) return null;
  const classWindowFeedback = quiz.feedback_policy === 'immediate' ||
    (quiz.score_mode === 'formal' && quiz.feedback_policy === 'teacher-release');
  const liveEnabled = classWindowFeedback || await isLiveFeedbackEnabled(config, target.id, fetcher);
  const postCloseRelease = () => Boolean(quiz.score_mode === 'formal' &&
    quiz.feedback_policy === 'teacher-release' && target.feedback_at &&
    Date.now() >= Date.parse(target.closes_at) && Date.now() >= Date.parse(target.feedback_at));
  // A reopened class target must not expose an earlier student's answer key
  // while a makeup student is taking the same formal paper.
  const fromEarlierWindow = Boolean(target.opens_at &&
    Date.parse(attempt.server_submit_time) < Date.parse(target.opens_at));
  const liveVisible = () => Boolean(liveEnabled && !fromEarlierWindow && target.opens_at &&
    isWithinClassWindow({ opens_at: target.opens_at, closes_at: target.closes_at }));
  if (liveEnabled && !liveVisible() && !postCloseRelease()) {
    return { status: 'expired' as const, title: quiz.title, submittedAt: attempt.server_submit_time,
      availableAt: target.feedback_at };
  }
  const finalized = attempt.status === 'finalized' && attempt.final_score !== null;
  const released = liveVisible() || postCloseRelease() ||
    (finalized && await feedbackReleased(config, quizId, version, quiz, targets, target.id, fetcher));
  if (!released) return { status: 'pending' as const, title: quiz.title, submittedAt: attempt.server_submit_time };
  const [answers, questions, audits] = await Promise.all([
    read<Answer[]>(config, `translation_attempt_answers?select=id,question_id,raw_answer,final_score,ai_review,updated_at&attempt_id=eq.${attempt.id}&limit=101`, fetcher),
    read<Question[]>(config, `translation_questions?select=id,question_key,prompt_zh,segmented_answer,hint,max_score,display_order&${key(quizId, version)}&order=display_order.asc&limit=101`, fetcher),
    read<Audit[]>(config, `translation_audit_log?select=after_data&entity_type=eq.translation-attempt&entity_id=eq.${attempt.id}&action=eq.teacher-review-answer&order=occurred_at.desc&limit=1001`, fetcher),
  ]);
  if (!questions.length || questions.length !== answers.length ||
      (finalized && answers.some(answer => answer.final_score === null)) || audits.length > 1000)
    throw new Error('RESULT_INCOMPLETE');
  const byQuestion = new Map(answers.map(answer => [answer.question_id, answer]));
  const details = questions.map(question => {
    const answer = byQuestion.get(question.id);
    if (!answer) throw new Error('RESULT_INCOMPLETE');
    const teacherReason = audits.find(event => event.after_data?.answerId === answer.id)?.after_data?.reason;
    const suggestion = suggestTranslationScore(answer.raw_answer, question.segmented_answer, Number(question.max_score), {
      questionKey: question.question_key,
    });
    const aiScore = answer.ai_review && typeof answer.ai_review.suggestedScore === 'number' &&
      Number.isFinite(answer.ai_review.suggestedScore) && answer.ai_review.suggestedScore >= 0 &&
      answer.ai_review.suggestedScore <= Number(question.max_score) ? answer.ai_review.suggestedScore : null;
    const teacherScored = answer.final_score !== null;
    const score = teacherScored ? Number(answer.final_score) : suggestion.suggestedScore ?? aiScore;
    const needsStudy = score === null || score < Number(question.max_score);
    const reason = suggestion.suggestedScore !== null ? suggestion.reason : answer.ai_review?.reason || '此句需要進一步判讀。';
    const aiFinal = teacherScored && Boolean(teacherReason?.startsWith(AI_AUTO_MARK));
    const feedbackText = typeof answer.ai_review?.studentFeedback === 'string' && answer.ai_review.studentFeedback.trim()
      ? answer.ai_review.studentFeedback.trim() : null;
    return { answerId: answer.id, updatedAt: answer.updated_at, questionKey: question.question_key, prompt: question.prompt_zh,
      rawAnswer: answer.raw_answer, score, maxScore: Number(question.max_score),
      scoreState: teacherScored ? 'final' as const : score === null ? 'pending' as const : 'suggested' as const,
      aiFinal,
      explanation: aiFinal ? (feedbackText ?? (needsStudy ? `${reason} ${question.hint}` : null))
        : needsStudy ? (teacherScored ? teacherReason || question.hint : `${feedbackText ?? reason} ${question.hint}`)
          : (teacherScored ? null : feedbackText),
      textbookAnswer: question.segmented_answer.replace(/\s*\/\s*/g, ' ') };
  });
  const provisionalScore = details.every(item => item.score !== null)
    ? details.reduce((sum, item) => sum + Number(item.score), 0) : null;
  const knownScore = details.reduce((sum, item) => sum + Number(item.score ?? 0), 0);
  const pendingMaxScore = details.reduce((sum, item) => sum + (item.score === null ? item.maxScore : 0), 0);
  const pendingCount = details.filter(item => item.score === null).length;
  // A request may begin just before the deadline and finish after it.
  // Recheck immediately before returning any answer or hint to the student.
  if (liveEnabled && !liveVisible() && !postCloseRelease()) {
    return { status: 'expired' as const, title: quiz.title, submittedAt: attempt.server_submit_time,
      availableAt: target.feedback_at };
  }
  return { status: finalized ? 'released' as const : 'provisional' as const,
    title: quiz.title, submittedAt: attempt.server_submit_time,
    score: finalized ? Number(attempt.final_score) : provisionalScore,
    knownScore, pendingMaxScore, pendingCount,
    maxScore: questions.reduce((sum, item) => sum + Number(item.max_score), 0),
    endsAt: liveEnabled && !target.feedback_at ? target.closes_at : null,
    aiScored: details.some(item => item.aiFinal),
    appealAllowed: Boolean(liveVisible() || postCloseRelease()), details };
}

export async function releaseFeedback(config: DataConfig, quizId: string, version: number,
  actor: string, fetcher: typeof fetch = fetch) {
  const [quizzes, targets, pending] = await Promise.all([
    read<Quiz[]>(config, `translation_quizzes?select=title,status,score_mode,feedback_policy&${key(quizId, version)}&limit=2`, fetcher),
    read<Target[]>(config, `translation_quiz_targets?select=id,class_code,closes_at,feedback_at&${key(quizId, version)}&limit=100`, fetcher),
    read<Array<{ id: string }>>(config, `translation_attempts?select=id&${key(quizId, version)}&status=in.(submitted,review-pending)&limit=1`, fetcher),
  ]);
  if (quizzes.length !== 1 || !['published', 'closed'].includes(quizzes[0].status) || quizzes[0].feedback_policy !== 'teacher-release') throw new Error('此測驗尚不可由教師發布回饋。');
  if (quizzes[0].score_mode === 'formal') throw new Error('正式測驗採各班課堂即時回饋；截止後不再永久開放答案。');
  if (!targets.length || targets.some(target => Date.now() < Date.parse(target.closes_at))) throw new Error('所有目標班級截止後才能發布回饋。');
  const liveTargets = await read<Array<{ id: number }>>(config,
    `translation_audit_log?select=id&entity_type=eq.translation_quiz_target&entity_id=in.(${targets.map(target => encodeURIComponent(target.id)).join(',')})&action=eq.enable-live-feedback&limit=1`, fetcher);
  if (liveTargets.length) throw new Error('此測驗已有班級採課堂即時回饋，不能再發布全測驗的永久回饋；請在工作區為需要的班級逐班啟用。');
  if (pending.length) throw new Error('仍有學生作答尚未逐題覆核定稿。');
  if (await feedbackReleased(config, quizId, version, quizzes[0], targets, targets[0].id, fetcher)) return;
  const response = await fetcher(`${config.supabaseUrl}/rest/v1/translation_audit_log`, {
    method: 'POST', headers: { apikey: config.supabaseSecretKey, authorization: `Bearer ${config.supabaseSecretKey}`,
      'content-type': 'application/json', prefer: 'return=minimal' },
    body: JSON.stringify({ actor_type: 'teacher', actor_id: actor, action: 'release-translation-feedback',
      entity_type: 'translation_quiz', entity_id: `${quizId}:${version}`, after_data: { quizId, version } }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('回饋發布未確認，請稍後重試。');
}

async function read<T>(config: DataConfig, path: string, fetcher: typeof fetch): Promise<T> {
  const response = await fetcher(`${config.supabaseUrl}/rest/v1/${path}`, {
    headers: { apikey: config.supabaseSecretKey, authorization: `Bearer ${config.supabaseSecretKey}`, accept: 'application/json' },
    cache: 'no-store', signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`回饋資料讀取失敗（${response.status}）。`);
  return await response.json() as T;
}
