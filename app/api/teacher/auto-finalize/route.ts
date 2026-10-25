import { getDataConfig } from '@/lib/server/config';
import { json, readJsonBody, RequestInputError } from '@/lib/server/http';
import { requireTeacher, TeacherAccessError } from '@/lib/server/teacher-auth';
import { parseThreshold, saveAutoFinalizeSetting } from '@/lib/server/auto-finalize';

export async function POST(request: Request): Promise<Response> {
  try {
    const teacher = await requireTeacher(request);
    if (request.headers.get('origin') !== new URL(request.url).origin) {
      throw new RequestInputError('無法確認請求來源。', 403);
    }
    const body = await readJsonBody(request) as Record<string, unknown>;
    if (typeof body?.quizId !== 'string' || !/^[A-Z0-9][A-Z0-9._:-]{1,127}$/i.test(body.quizId) ||
        !Number.isInteger(body.version) || Number(body.version) < 1 || typeof body.enabled !== 'boolean') {
      throw new RequestInputError('設定資料不正確。');
    }
    const config = getDataConfig();
    if (!config) return json({ status: 'error', error: '後端設定尚未完成。' }, 503);
    const setting = await saveAutoFinalizeSetting(config, body.quizId, Number(body.version),
      body.enabled, parseThreshold(body.threshold), teacher.email);
    return json({ status: 'ok', setting });
  } catch (error) {
    if (error instanceof TeacherAccessError || error instanceof RequestInputError) {
      return json({ status: 'error', error: error.message }, error.status);
    }
    return json({ status: 'error', error: error instanceof Error ? error.message : '設定未確認，請重新整理核對。' }, 503);
  }
}
