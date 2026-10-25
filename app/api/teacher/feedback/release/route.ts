import { getDataConfig } from '@/lib/server/config';
import { releaseFeedback } from '@/lib/server/feedback';
import { requireTeacher, TeacherAccessError } from '@/lib/server/teacher-auth';
import { assertSameOrigin, json, readJsonBody, RequestInputError } from '@/lib/server/http';

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const teacher = await requireTeacher(request);
    const config = getDataConfig();
    if (!config) return json({ error: '後端設定尚未完成。' }, 503);
    const input = await readJsonBody(request) as Record<string, unknown>;
    if (typeof input.quizId !== 'string' || !/^[A-Z0-9][A-Z0-9._:-]{1,127}$/i.test(input.quizId) ||
      !Number.isInteger(input.version) || Number(input.version) < 1) return json({ error: '測驗資料不正確。' }, 400);
    await releaseFeedback(config, input.quizId, Number(input.version), teacher.email);
    return json({ status: 'ok' });
  } catch (error) {
    if (error instanceof TeacherAccessError || error instanceof RequestInputError) return json({ error: error.message }, error.status);
    return json({ error: error instanceof Error ? error.message : '目前無法發布回饋。' }, 409);
  }
}
