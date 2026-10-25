import { getDataConfig, type DataConfig } from './config.ts';
import {
  readStudentSessionCookie,
  type StudentSession,
  verifyStudentSession,
} from './session.ts';
import { IdentityClientError, validateStudentSessionIdentity } from './student-identity.ts';

export class SessionRequirementError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function requireStudentSession(
  request: Request,
): Promise<{ config: DataConfig; session: StudentSession }> {
  const config = getDataConfig();
  if (!config) {
    throw new SessionRequirementError(
      'CONFIGURATION_REQUIRED',
      '系統尚未完成安全設定，請稍後再試。',
      503,
    );
  }
  const token = readStudentSessionCookie(request);
  const session = token
    ? await verifyStudentSession(token, config.sessionSecret)
    : null;
  if (!session) {
    throw new SessionRequirementError(
      'AUTH_REQUIRED',
      '登入狀態已失效，請重新驗證。',
      401,
    );
  }
  try {
    await validateStudentSessionIdentity(config, session);
    return { config, session };
  } catch (error) {
    if (error instanceof IdentityClientError) {
      throw new SessionRequirementError(error.code, error.message, error.status);
    }
    throw error;
  }
}
