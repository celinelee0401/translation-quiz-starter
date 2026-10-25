import { isSupportedClassCode } from '../public-quiz-data.ts';
import { type DataConfig, getDataConfig } from './config.ts';
import {
  assertSameOrigin,
  configurationRequired,
  json,
  readJsonBody,
  RequestInputError,
} from './http.ts';
import {
  IdentityClientError,
  type StudentCredentials,
  verifyStudentLogin,
} from './student-identity.ts';
import {
  createStudentSession,
  publicStudentSession,
  studentSessionCookie,
} from './session.ts';

export async function authenticateStudent(request: Request): Promise<Response> {
  const config = getDataConfig();
  if (!config) return configurationRequired();

  try {
    assertSameOrigin(request);
    const credentials = parseCredentials(await readJsonBody(request), config);
    const identity = await verifyStudentLogin(config, credentials);
    const { session, token } = await createStudentSession(
      identity,
      config.sessionSecret,
    );
    return json({ status: 'ok', session: publicStudentSession(session) }, 200, {
      'set-cookie': studentSessionCookie(config, token),
    });
  } catch (error) {
    if (
      error instanceof RequestInputError ||
      error instanceof IdentityClientError
    ) {
      return json(
        {
          status: 'error',
          code:
            error instanceof IdentityClientError
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
        error: '身分驗證暫時無法完成。',
      },
      503,
    );
  }
}

export function parseCredentials(
  value: unknown,
  config: Pick<DataConfig, 'loginMode'>,
): StudentCredentials {
  if (!value || typeof value !== 'object') {
    throw new RequestInputError('請完整輸入身分資料。');
  }
  const input = value as Record<string, unknown>;
  const classCode = typeof input.classCode === 'string' ? input.classCode : '';
  const seatNumber = Number(input.seatNumber);
  const pin = typeof input.pin === 'string' ? input.pin : '';

  if (!isSupportedClassCode(classCode)) {
    throw new RequestInputError('這個班級尚未開放此系統。', 403);
  }
  if (!Number.isInteger(seatNumber) || seatNumber < 1 || seatNumber > 99) {
    throw new RequestInputError('請輸入有效的座號。');
  }
  if (config.loginMode === 'pin' && !/^\d{6}$/.test(pin)) {
    throw new RequestInputError('PIN 請輸入六位數字。');
  }
  return { classCode, seatNumber, pin: config.loginMode === 'pin' ? pin : null };
}
