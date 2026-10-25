import { assertSameOrigin, json, readJsonBody, RequestInputError } from '@/lib/server/http';
import { loginTeacher, TeacherAccessError } from '@/lib/server/teacher-auth';

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const body = await readJsonBody(request) as { accessCode?: unknown };
    const cookie = await loginTeacher(request, body?.accessCode);
    return json({ status: 'ok' }, 200, { 'set-cookie': cookie });
  } catch (error) {
    if (error instanceof TeacherAccessError || error instanceof RequestInputError) return json({ status: 'error', error: error.message }, error.status);
    return json({ status: 'error', error: '目前無法驗證教師通行碼，請稍後再試。' }, 503);
  }
}
