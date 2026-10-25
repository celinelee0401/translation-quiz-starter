import type { DataConfig } from './config.ts';
import { loadTeacherReview, type TeacherReviewAttempt } from './teacher-review.ts';
import type { TeacherQuiz } from './teacher-overview.ts';

export const CONFIDENCE_BUCKETS = [
  { label: '95% 以上', min: 0.95 },
  { label: '90–95%', min: 0.9 },
  { label: '85–90%', min: 0.85 },
  { label: '80–85%', min: 0.8 },
  { label: '80% 以下', min: 0 },
] as const;

export type CalibrationRow = { finalScore: number | null; aiScore: number; confidence: number; adoptedAutomatically: boolean };
export type CalibrationBucket = { label: string; total: number; teacherChecked: number; teacherAgreed: number };

/** Groups AI reviews by confidence and compares them with scores the teacher entered herself. */
export function summarizeCalibration(rows: CalibrationRow[]): CalibrationBucket[] {
  return CONFIDENCE_BUCKETS.map((bucket, index) => {
    const upper = index === 0 ? Infinity : CONFIDENCE_BUCKETS[index - 1].min;
    const inBucket = rows.filter(row => row.confidence >= bucket.min && row.confidence < upper);
    const checked = inBucket.filter(row => row.finalScore !== null && !row.adoptedAutomatically);
    return { label: bucket.label, total: inBucket.length, teacherChecked: checked.length,
      teacherAgreed: checked.filter(row => Math.abs(Number(row.finalScore) - row.aiScore) < 0.005).length };
  });
}

type AnswerRow = { id: string; final_score: number | null; ai_review: { suggestedScore?: number; confidence?: number } | null };

export async function loadCalibration(config: DataConfig, quiz: TeacherQuiz,
  fetcher: typeof fetch = fetch): Promise<CalibrationRow[]> {
  if (!quiz.questions.length) return [];
  const questionIds = quiz.questions.map(question => question.id).join(',');
  const rows: AnswerRow[] = [];
  for (let offset = 0; offset < 10000; offset += 500) {
    const batch = await read<AnswerRow>(config,
      `translation_attempt_answers?select=id,final_score,ai_review&question_id=in.(${questionIds})&ai_review=not.is.null&order=id.asc&limit=500&offset=${offset}`, fetcher);
    rows.push(...batch);
    if (batch.length < 500) break;
  }
  const auto = new Set<string>();
  for (let offset = 0; offset < 10000; offset += 500) {
    const batch = await read<{ after_data: { answerId?: string } | null }>(config,
      `translation_audit_log?select=after_data&entity_type=eq.translation-attempt&action=eq.ai-auto-finalize&after_data-%3E%3EquizId=eq.${encodeURIComponent(quiz.quizId)}&order=id.asc&limit=500&offset=${offset}`, fetcher);
    for (const row of batch) if (row.after_data?.answerId) auto.add(row.after_data.answerId);
    if (batch.length < 500) break;
  }
  return rows.flatMap(row => {
    const score = row.ai_review?.suggestedScore;
    const confidence = row.ai_review?.confidence;
    if (typeof score !== 'number' || typeof confidence !== 'number') return [];
    return [{ finalScore: row.final_score === null ? null : Number(row.final_score), aiScore: score, confidence,
      adoptedAutomatically: auto.has(row.id) }];
  });
}

export type SpotCheckItem = { classCode: string; confidence: number; attempt: TeacherReviewAttempt; answerId: string };

/** Per class, the AI-adopted answers with the lowest confidence — the likeliest mistakes. */
export async function loadSpotCheck(config: DataConfig, quizzes: TeacherQuiz[], quizId: string,
  perClass: number, fetcher: typeof fetch = fetch): Promise<SpotCheckItem[]> {
  const markers = await read<{ entity_id: string }>(config,
    `translation_audit_log?select=entity_id&entity_type=eq.translation-attempt&action=eq.ai-auto-finalize&after_data-%3E%3EquizId=eq.${encodeURIComponent(quizId)}&order=id.desc&limit=1000`, fetcher);
  const attemptIds = [...new Set(markers.map(row => row.entity_id))].slice(0, 400);
  const attempts: TeacherReviewAttempt[] = [];
  for (let index = 0; index < attemptIds.length; index += 50) {
    attempts.push(...await loadTeacherReview(config, quizzes, fetcher, 0, attemptIds.slice(index, index + 50)));
  }
  const candidates: SpotCheckItem[] = attempts.flatMap(attempt => attempt.answers
    .filter(answer => answer.autoAdopted && answer.aiReview && answer.finalScore !== null)
    .map(answer => ({ classCode: attempt.classCode, confidence: Number(answer.aiReview?.confidence), attempt, answerId: answer.id })));
  const byClass = new Map<string, SpotCheckItem[]>();
  for (const item of candidates) byClass.set(item.classCode, [...(byClass.get(item.classCode) ?? []), item]);
  return [...byClass.entries()].sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([, items]) => items.sort((a, b) => a.confidence - b.confidence).slice(0, perClass));
}

async function read<T>(config: DataConfig, path: string, fetcher: typeof fetch): Promise<T[]> {
  const response = await fetcher(`${config.supabaseUrl}/rest/v1/${path}`, {
    headers: { apikey: config.supabaseSecretKey, authorization: `Bearer ${config.supabaseSecretKey}`, accept: 'application/json' },
    cache: 'no-store', signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`資料讀取失敗（HTTP ${response.status}）。`);
  return await response.json() as T[];
}
