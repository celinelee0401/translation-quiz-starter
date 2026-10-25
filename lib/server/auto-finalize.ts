import type { DataConfig } from './config.ts';
import { suggestTranslationScore } from '../grading.ts';
import { AUTO_FINALIZE_ACTOR, saveTeacherReview } from './save-review.ts';
import type { AiScoreSuggestion } from './teacher-review.ts';

// Marks scores that the system finalized without a teacher opening the answer.
// The mark is part of the saved review reason, so it appears in the history.
export const AI_AUTO_MARK = '[AI 自動採用]';
export const DEFAULT_THRESHOLD = 0.8;
const MIN_THRESHOLD = 0.8;
const MAX_THRESHOLD = 0.99;

export type AutoFinalizeSetting = { enabled: boolean; threshold: number };

// Automatic adoption is on unless the teacher switched it off for a quiz.
export const DEFAULT_SETTING: AutoFinalizeSetting = { enabled: true, threshold: DEFAULT_THRESHOLD };

export function settingFor(settings: Map<string, AutoFinalizeSetting>, quizId: string, version: number): AutoFinalizeSetting {
  return settings.get(`${quizId}:${version}`) ?? DEFAULT_SETTING;
}

export function parseThreshold(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_THRESHOLD;
  return Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, Math.round(number * 100) / 100));
}

export type AnswerFacts = {
  rawAnswer: string;
  finalScore: number | null;
  openAppeal: boolean;
  maxScore: number;
  ruleScore: number | null;
  ruleReason: string;
  aiScore: number | null;
  aiConfidence: number | null;
  aiReason: string;
};

export type AutoDecision = { score: number; source: 'rule' | 'ai'; confidence: number | null; reason: string };

const validScore = (score: number | null, max: number): score is number =>
  score !== null && Number.isFinite(score) && score >= 0 && score <= max && Math.round(score * 100) === score * 100;

/** Pure decision: returns null when a teacher must look at the answer. */
export function decideAutoFinalize(facts: AnswerFacts, threshold: number): AutoDecision | null {
  if (facts.finalScore !== null || facts.openAppeal || !facts.rawAnswer.trim()) return null;
  if (validScore(facts.ruleScore, facts.maxScore)) {
    return { score: facts.ruleScore, source: 'rule', confidence: null,
      reason: `${AI_AUTO_MARK} 固定規則：${facts.ruleReason}`.slice(0, 1000) };
  }
  if (validScore(facts.aiScore, facts.maxScore) && facts.aiConfidence !== null &&
      Number.isFinite(facts.aiConfidence) && facts.aiConfidence >= threshold) {
    return { score: facts.aiScore, source: 'ai', confidence: facts.aiConfidence,
      reason: `${AI_AUTO_MARK} AI 信心 ${Math.round(facts.aiConfidence * 100)}%：${facts.aiReason}`.slice(0, 1000) };
  }
  return null;
}

type SettingRow = { id: number; action: string; entity_id: string; after_data: { threshold?: number } | null };

export async function loadAutoFinalizeSettings(config: DataConfig,
  fetcher: typeof fetch = fetch): Promise<Map<string, AutoFinalizeSetting>> {
  const rows = await readRows<SettingRow>(config,
    'translation_audit_log?select=id,action,entity_id,after_data&entity_type=eq.translation_quiz&action=in.(enable-ai-auto-finalize,disable-ai-auto-finalize)&order=id.desc&limit=1000', fetcher);
  const settings = new Map<string, AutoFinalizeSetting>();
  for (const row of rows) {
    if (settings.has(row.entity_id)) continue;
    settings.set(row.entity_id, { enabled: row.action === 'enable-ai-auto-finalize',
      threshold: parseThreshold(row.after_data?.threshold) });
  }
  return settings;
}

export async function loadAutoFinalizeSetting(config: DataConfig, quizId: string, version: number,
  fetcher: typeof fetch = fetch): Promise<AutoFinalizeSetting> {
  const rows = await readRows<SettingRow>(config,
    `translation_audit_log?select=id,action,entity_id,after_data&entity_type=eq.translation_quiz&entity_id=eq.${encodeURIComponent(`${quizId}:${version}`)}&action=in.(enable-ai-auto-finalize,disable-ai-auto-finalize)&order=id.desc&limit=1`, fetcher);
  const row = rows[0];
  return row ? { enabled: row.action === 'enable-ai-auto-finalize', threshold: parseThreshold(row.after_data?.threshold) }
    : DEFAULT_SETTING;
}

export async function saveAutoFinalizeSetting(config: DataConfig, quizId: string, version: number,
  enabled: boolean, threshold: number, actor: string, fetcher: typeof fetch = fetch): Promise<AutoFinalizeSetting> {
  const quizzes = await readRows<{ status: string; score_mode: string }>(config,
    `translation_quizzes?select=status,score_mode&quiz_id=eq.${encodeURIComponent(quizId)}&quiz_version=eq.${version}&limit=2`, fetcher);
  if (quizzes.length !== 1 || !['published', 'closed'].includes(quizzes[0].status)) {
    throw new Error('只有已發布的測驗可以設定 AI 自動採用。');
  }
  const clean = parseThreshold(threshold);
  const response = await fetcher(`${config.supabaseUrl}/rest/v1/translation_audit_log`, {
    method: 'POST', headers: writeHeaders(config),
    body: JSON.stringify({ actor_type: 'teacher', actor_id: actor,
      action: enabled ? 'enable-ai-auto-finalize' : 'disable-ai-auto-finalize',
      entity_type: 'translation_quiz', entity_id: `${quizId}:${version}`,
      after_data: { quizId, version, threshold: clean } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('AI 自動採用設定尚未確認，請重新整理核對。');
  return { enabled, threshold: clean };
}

type Attempt = { id: string; quiz_id: string; quiz_version: number; status: string };
type Answer = { id: string; question_id: string; raw_answer: string; final_score: number | null;
  ai_review: AiScoreSuggestion | null; updated_at: string };
type Question = { id: string; question_key: string; segmented_answer: string; max_score: number };

export type AutoFinalizeOutcome = { adopted: number; skipped: number; failed: number };

type AttemptFacts = {
  attempt: Attempt;
  items: Array<{ answer: Answer; question: Question; rule: ReturnType<typeof suggestTranslationScore>; openAppeal: boolean }>;
};

async function loadAttemptFacts(config: DataConfig, attemptId: string, fetcher: typeof fetch): Promise<AttemptFacts | null> {
  const attempt = (await readRows<Attempt>(config,
    `translation_attempts?select=id,quiz_id,quiz_version,status&id=eq.${attemptId}&limit=1`, fetcher))[0];
  if (!attempt || !['submitted', 'review-pending'].includes(attempt.status)) return null;
  const quizFilter = `quiz_id=eq.${encodeURIComponent(attempt.quiz_id)}&quiz_version=eq.${attempt.quiz_version}`;
  const [quizzes, answers, questions, appeals] = await Promise.all([
    readRows<{ rubric_version?: string }>(config, `translation_quizzes?select=rubric_version&${quizFilter}&limit=2`, fetcher),
    readRows<Answer>(config,
      `translation_attempt_answers?select=id,question_id,raw_answer,final_score,ai_review,updated_at&attempt_id=eq.${attemptId}&limit=101`, fetcher),
    readRows<Question>(config,
      `translation_questions?select=id,question_key,segmented_answer,max_score&${quizFilter}&limit=101`, fetcher),
    readRows<{ answer_id: string }>(config,
      `translation_review_queue?select=answer_id&attempt_id=eq.${attemptId}&reason=eq.student-appeal&status=eq.open&limit=101`, fetcher),
  ]);
  if (quizzes.length !== 1) return null;
  const questionById = new Map(questions.map(question => [question.id, question]));
  const appealIds = new Set(appeals.map(item => item.answer_id));
  const items: AttemptFacts['items'] = [];
  for (const answer of answers) {
    const question = questionById.get(answer.question_id);
    if (!question) continue;
    items.push({ answer, question, openAppeal: appealIds.has(answer.id),
      rule: suggestTranslationScore(answer.raw_answer, question.segmented_answer, Number(question.max_score), {
        questionKey: question.question_key }) });
  }
  return { attempt, items };
}

/** Asks the AI about answers that no fixed rule can score yet. Returns the distinct error messages. */
export async function requestMissingAiReviews(config: DataConfig, attemptId: string,
  askAi: (input: { answerId: string; updatedAt: string }) => Promise<unknown>,
  fetcher: typeof fetch = fetch): Promise<string[]> {
  const facts = await loadAttemptFacts(config, attemptId, fetcher);
  if (!facts) return [];
  const todo = facts.items.filter(({ answer, rule, openAppeal }) =>
    answer.final_score === null && !openAppeal && rule.suggestedScore === null &&
    !answer.ai_review && Boolean(answer.raw_answer.trim()));
  const errors = new Set<string>();
  const queue = [...todo];
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      try { await withAiRetry(() => askAi({ answerId: item.answer.id, updatedAt: item.answer.updated_at })); }
      catch (error) { errors.add(error instanceof Error ? error.message : 'AI 判讀失敗'); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, todo.length) }, worker));
  return [...errors];
}

/**
 * Finalizes the answers of one attempt that meet the quiz's automatic-adoption
 * rule. Scores are written through the same database function as a manual
 * teacher review, so the total, the review queue and the audit trail stay
 * consistent. Appeals and low-confidence answers are left for the teacher.
 */
export async function autoFinalizeAttempt(config: DataConfig, attemptId: string, threshold: number,
  fetcher: typeof fetch = fetch): Promise<AutoFinalizeOutcome> {
  const outcome: AutoFinalizeOutcome = { adopted: 0, skipped: 0, failed: 0 };
  const facts = await loadAttemptFacts(config, attemptId, fetcher);
  if (!facts) return outcome;
  const markers: unknown[] = [];
  for (const { answer, question, rule, openAppeal } of facts.items) {
    const maxScore = Number(question.max_score);
    const decision = decideAutoFinalize({
      rawAnswer: answer.raw_answer, finalScore: answer.final_score, openAppeal, maxScore,
      ruleScore: rule.suggestedScore, ruleReason: rule.reason,
      aiScore: answer.ai_review?.suggestedScore ?? null, aiConfidence: answer.ai_review?.confidence ?? null,
      aiReason: answer.ai_review?.reason ?? '',
    }, threshold);
    if (!decision) { if (answer.final_score === null) outcome.skipped++; continue; }
    try {
      await saveTeacherReview(config, { answerId: answer.id, updatedAt: answer.updated_at,
        score: decision.score, reason: decision.reason }, AUTO_FINALIZE_ACTOR, fetcher);
      outcome.adopted++;
      markers.push({ actor_type: 'system', actor_id: 'ai-auto-finalize', action: 'ai-auto-finalize',
        entity_type: 'translation-attempt', entity_id: attemptId,
        after_data: { answerId: answer.id, score: decision.score, source: decision.source,
          confidence: decision.confidence, model: answer.ai_review?.model ?? null,
          quizId: facts.attempt.quiz_id, version: facts.attempt.quiz_version } });
    } catch {
      outcome.failed++;
    }
  }
  if (markers.length) {
    // Best effort: the review history already records every adopted score.
    await fetcher(`${config.supabaseUrl}/rest/v1/translation_audit_log`, {
      method: 'POST', headers: writeHeaders(config), body: JSON.stringify(markers),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  }
  return outcome;
}

/** Retries a short rate limit with growing waits; a missing quota or any other error is not retried. */
export async function withAiRetry<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await call(); }
    catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (!message.includes('呼叫太頻繁') || attempt >= 2) throw error;
      await sleep(3000 * (attempt + 1));
    }
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function writeHeaders(config: DataConfig) {
  return { apikey: config.supabaseSecretKey, authorization: `Bearer ${config.supabaseSecretKey}`,
    'content-type': 'application/json', prefer: 'return=minimal' };
}

async function readRows<T>(config: DataConfig, path: string, fetcher: typeof fetch): Promise<T[]> {
  const response = await fetcher(`${config.supabaseUrl}/rest/v1/${path}`, {
    headers: { apikey: config.supabaseSecretKey, authorization: `Bearer ${config.supabaseSecretKey}`, accept: 'application/json' },
    cache: 'no-store', signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`資料讀取失敗（HTTP ${response.status}）。`);
  return await response.json() as T[];
}
