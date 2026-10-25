import { getAuthConfig } from '@/lib/server/config';
import { assertSameOrigin, json, RequestInputError } from '@/lib/server/http';
import { clearStudentSessionCookie } from '@/lib/server/session';

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const config = getAuthConfig();
    const secureCookies =
      config?.secureCookies ?? new URL(request.url).protocol === 'https:';
    return json({ status: 'ok' }, 200, {
      'set-cookie': clearStudentSessionCookie(secureCookies),
    });
  } catch (error) {
    if (error instanceof RequestInputError) {
      return json(
        { status: 'error', code: 'INVALID_REQUEST', error: error.message },
        error.status,
      );
    }
    return json({ status: 'error', code: 'SERVICE_UNAVAILABLE' }, 503);
  }
}
