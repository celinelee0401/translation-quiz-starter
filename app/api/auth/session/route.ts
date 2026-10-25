import { getDataConfig } from '@/lib/server/config';
import { configurationRequired, json } from '@/lib/server/http';
import {
  publicStudentSession,
  readStudentSessionCookie,
  verifyStudentSession,
} from '@/lib/server/session';
import { IdentityClientError, validateStudentSessionIdentity } from '@/lib/server/student-identity';

export async function GET(request: Request): Promise<Response> {
  const config = getDataConfig();
  if (!config) return configurationRequired();
  const token = readStudentSessionCookie(request);
  const session = token
    ? await verifyStudentSession(token, config.sessionSecret)
    : null;
  if (!session) {
    return json(
      { status: 'error', code: 'AUTH_REQUIRED', error: '尚未登入。' },
      401,
    );
  }
  try {
    await validateStudentSessionIdentity(config, session);
    return json({ status: 'ok', session: publicStudentSession(session) });
  } catch (error) {
    if (error instanceof IdentityClientError) {
      return json({ status: 'error', code: error.code, error: error.message }, error.status);
    }
    return json({ status: 'error', code: 'SERVICE_UNAVAILABLE', error: '身分驗證暫時無法完成。' }, 503);
  }
}
