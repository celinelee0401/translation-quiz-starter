import { AttemptError, submitAttempt } from '@/lib/server/attempts';
import {
  assertSameOrigin,
  json,
  readJsonBody,
  RequestInputError,
} from '@/lib/server/http';
import {
  requireStudentSession,
  SessionRequirementError,
} from '@/lib/server/require-session';

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const context = await requireStudentSession(request);
    const input = parseSubmitInput(await readJsonBody(request));
    const attempt = await submitAttempt(
      context.config,
      context.session,
      input.attemptId,
      input.idempotencyKey,
      input.answers,
    );
    return json({ status: 'ok', attempt });
  } catch (error) {
    if (
      error instanceof RequestInputError ||
      error instanceof AttemptError ||
      error instanceof SessionRequirementError
    ) {
      return json(
        {
          status: 'error',
          code:
            error instanceof AttemptError ||
            error instanceof SessionRequirementError
              ? error.code
              : 'INVALID_REQUEST',
          error: error.message,
        },
        error.status,
      );
    }
    return json(
      {
        status: 'error',
        code: 'SERVICE_UNAVAILABLE',
        error: '作答尚未儲存，請保留頁面並再試一次。',
      },
      503,
    );
  }
}

function parseSubmitInput(value: unknown): {
  attemptId: string;
  idempotencyKey: string;
  answers: Array<{ questionId: string; rawAnswer: string }>;
} {
  if (!value || typeof value !== 'object') {
    throw new RequestInputError('缺少作答資料。');
  }
  const input = value as Record<string, unknown>;
  if (
    typeof input.attemptId !== 'string' ||
    !isUuid(input.attemptId) ||
    typeof input.idempotencyKey !== 'string' ||
    !isUuid(input.idempotencyKey) ||
    !Array.isArray(input.answers) ||
    input.answers.length < 1 ||
    input.answers.length > 100
  ) {
    throw new RequestInputError('作答資料格式不正確。');
  }
  const answers = input.answers.map((value) => {
    if (!value || typeof value !== 'object') {
      throw new RequestInputError('作答資料格式不正確。');
    }
    const answer = value as Record<string, unknown>;
    if (
      typeof answer.questionId !== 'string' ||
      !/^[A-Z0-9][A-Z0-9._:-]{0,127}$/i.test(answer.questionId) ||
      typeof answer.rawAnswer !== 'string' ||
      answer.rawAnswer.length > 1000
    ) {
      throw new RequestInputError('作答資料格式不正確。');
    }
    return { questionId: answer.questionId, rawAnswer: answer.rawAnswer };
  });
  if (
    new Set(answers.map((answer) => answer.questionId)).size !== answers.length
  ) {
    throw new RequestInputError('題目不可重複。');
  }
  return {
    attemptId: input.attemptId,
    idempotencyKey: input.idempotencyKey,
    answers,
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
