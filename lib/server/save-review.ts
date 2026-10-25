import type { DataConfig } from './config.ts';
import { supabaseRpc, SupabaseRequestError } from './supabase.ts';
import { RequestInputError } from './http.ts';

export type ReviewResult = {
  answerId: string;
  attemptId: string;
  answerScore: number;
  attemptStatus: 'review-pending' | 'finalized';
  attemptFinalScore: number | null;
  reviewedAt: string;
};

// review_translation_answer() records this label as the actor; the app server
// has already authenticated the teacher before calling it.
export const AUTO_FINALIZE_ACTOR = 'system:auto-finalize';

export class ReviewSaveError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function saveTeacherReview(
  config: DataConfig,
  input: { answerId: string; updatedAt: string; score: number; reason: string },
  teacherEmail: string,
  fetcher: typeof fetch = fetch,
): Promise<ReviewResult> {
  try {
    const result = await supabaseRpc<unknown>(config, 'review_translation_answer', {
      p_answer_id: input.answerId,
      p_expected_updated_at: input.updatedAt,
      p_teacher_email: teacherEmail,
      p_score: input.score,
      p_reason: input.reason,
    }, fetcher);
    if (!isReviewResult(result)) throw new SupabaseRequestError(502);
    return result;
  } catch (error) {
    if (error instanceof SupabaseRequestError && error.status >= 400 && error.status < 500 && error.status !== 404) {
      throw new ReviewSaveError('作答或分數可能已變更。請重新整理後核對，再重新提交。', 409);
    }
    throw new ReviewSaveError('目前無法確認覆核已儲存；請勿重複猜測結果，先重新整理核對。', 503);
  }
}

function isReviewResult(value: unknown): value is ReviewResult {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<ReviewResult>;
  return Boolean(
    typeof item.answerId === 'string' &&
    typeof item.attemptId === 'string' &&
    typeof item.answerScore === 'number' && Number.isFinite(item.answerScore) &&
    (item.attemptStatus === 'review-pending' || item.attemptStatus === 'finalized') &&
    (item.attemptFinalScore === null || typeof item.attemptFinalScore === 'number') &&
    typeof item.reviewedAt === 'string',
  );
}

export function parseReviewInput(value: unknown): {
  answerId: string;
  updatedAt: string;
  score: number;
  reason: string;
} {
  if (!value || typeof value !== 'object') throw new RequestInputError('覆核資料不正確。');
  const item = value as Record<string, unknown>;
  if (
    typeof item.answerId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.answerId) ||
    typeof item.updatedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(item.updatedAt) ||
    !Number.isFinite(Date.parse(item.updatedAt)) ||
    typeof item.score !== 'number' ||
    !Number.isFinite(item.score) || item.score < 0 || item.score > 100 ||
    Math.round(item.score * 100) !== item.score * 100 ||
    typeof item.reason !== 'string' ||
    item.reason.trim().length < 4 || item.reason.trim().length > 1000
  ) throw new RequestInputError('請填寫有效分數與至少四字的覆核理由。');
  return {
    answerId: item.answerId,
    updatedAt: item.updatedAt,
    score: item.score,
    reason: item.reason.trim(),
  };
}
