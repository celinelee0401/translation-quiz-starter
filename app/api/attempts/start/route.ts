import { AttemptError, startAttempt } from '@/lib/server/attempts';
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
import { loadStudentQuiz } from '@/lib/server/student-quiz';

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const context = await requireStudentSession(request);
    const input = parseStartInput(await readJsonBody(request));
    const attempt = await startAttempt(
      context.config,
      context.session,
      input.quizId,
      input.quizVersion,
    );
    const quiz = await loadStudentQuiz(context.config, input.quizId, input.quizVersion, context.session.gradeLevel);
    return json({ status: 'ok', attempt, quiz });
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
        error: '目前無法開始測驗。',
      },
      503,
    );
  }
}

function parseStartInput(value: unknown): {
  quizId: string;
  quizVersion: number;
} {
  if (!value || typeof value !== 'object')
    throw new RequestInputError('缺少測驗資料。');
  const input = value as { quizId?: unknown; quizVersion?: unknown };
  if (
    typeof input.quizId !== 'string' ||
    !/^[A-Z0-9][A-Z0-9._:-]{1,127}$/i.test(input.quizId) ||
    !Number.isInteger(input.quizVersion) ||
    Number(input.quizVersion) < 1
  ) {
    throw new RequestInputError('測驗版本資料不正確。');
  }
  return { quizId: input.quizId, quizVersion: Number(input.quizVersion) };
}
