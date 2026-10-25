import type { DataConfig } from './config.ts';
import type { StudentSession } from './session.ts';
import { supabaseRpc, SupabaseRequestError } from './supabase.ts';

export type StartedAttempt = {
  attemptId: string;
  quizId: string;
  quizVersion: number;
  serverStartTime: string;
  status: 'in-progress';
};

export type SubmittedAttempt = {
  attemptId: string;
  serverSubmitTime: string;
  status: 'submitted';
};

export type SubmittedAnswer = {
  questionId: string;
  rawAnswer: string;
};

export class AttemptError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function startAttempt(
  config: DataConfig,
  session: StudentSession,
  quizId: string,
  quizVersion: number,
  fetcher: typeof fetch = fetch,
): Promise<StartedAttempt> {
  try {
    const result = await supabaseRpc<unknown>(
      config,
      'start_translation_attempt',
      {
        p_quiz_id: quizId,
        p_quiz_version: quizVersion,
        p_student_id: session.studentId,
        p_enrollment_id: session.enrollmentId,
        p_school_year: session.schoolYear,
        p_class_code: session.classCode,
        p_grade_level: session.gradeLevel,
      },
      fetcher,
    );
    if (!isStartedAttempt(result) || result.quizId !== quizId || result.quizVersion !== quizVersion) {
      throw new SupabaseRequestError(502);
    }
    return result;
  } catch (error) {
    throw toAttemptError(error, '目前無法開始這份測驗。');
  }
}

export async function submitAttempt(
  config: DataConfig,
  session: StudentSession,
  attemptId: string,
  idempotencyKey: string,
  answers: SubmittedAnswer[],
  fetcher: typeof fetch = fetch,
): Promise<SubmittedAttempt> {
  try {
    const result = await supabaseRpc<unknown>(
      config,
      'submit_translation_attempt',
      {
        p_attempt_id: attemptId,
        p_student_id: session.studentId,
        p_enrollment_id: session.enrollmentId,
        p_idempotency_key: idempotencyKey,
        p_answers: answers,
      },
      fetcher,
    );
    if (!isSubmittedAttempt(result)) throw new SupabaseRequestError(502);
    return result;
  } catch (error) {
    throw toAttemptError(error, '作答尚未儲存，請保留頁面並再試一次。');
  }
}

function toAttemptError(error: unknown, fallbackMessage: string): AttemptError {
  if (error instanceof SupabaseRequestError) {
    const unavailable = error.status >= 500 || error.status === 404;
    return new AttemptError(
      unavailable ? 'ATTEMPT_SERVICE_UNAVAILABLE' : 'ATTEMPT_NOT_ALLOWED',
      fallbackMessage,
      unavailable ? 503 : 403,
    );
  }
  return new AttemptError('ATTEMPT_SERVICE_UNAVAILABLE', fallbackMessage, 503);
}

function isStartedAttempt(value: unknown): value is StartedAttempt {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<StartedAttempt>;
  return Boolean(
    typeof item.attemptId === 'string' &&
    /^[0-9a-f-]{36}$/i.test(item.attemptId) &&
    typeof item.quizId === 'string' &&
    Number.isInteger(item.quizVersion) &&
    typeof item.serverStartTime === 'string' &&
    item.status === 'in-progress',
  );
}

function isSubmittedAttempt(value: unknown): value is SubmittedAttempt {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<SubmittedAttempt>;
  return Boolean(
    typeof item.attemptId === 'string' &&
    /^[0-9a-f-]{36}$/i.test(item.attemptId) &&
    typeof item.serverSubmitTime === 'string' &&
    item.status === 'submitted',
  );
}
