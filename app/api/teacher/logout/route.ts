import { assertSameOrigin, json, RequestInputError } from '@/lib/server/http';
import { logoutTeacher } from '@/lib/server/teacher-auth';

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    return json({ status: 'ok' }, 200, { 'set-cookie': logoutTeacher(request) });
  } catch (error) {
    return json({ status: 'error', error: error instanceof RequestInputError ? error.message : '登出失敗。' }, 403);
  }
}
