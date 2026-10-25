import { getDataConfig } from '@/lib/server/config';
import { json, readJsonBody, RequestInputError } from '@/lib/server/http';
import { requireTeacher, TeacherAccessError } from '@/lib/server/teacher-auth';
import { changeQuizArchive, ArchiveQuizError } from '@/lib/server/archive-quiz';

export async function POST(request: Request): Promise<Response> {
  try {
    const teacher = await requireTeacher(request);
    if (request.headers.get('origin') !== new URL(request.url).origin)
      throw new RequestInputError('無法確認請求來源。', 403);
    const body = await readJsonBody(request) as { quizId?: unknown; quizVersion?: unknown; action?: unknown };
    if (!body || typeof body.quizId !== 'string' || !/^[A-Z0-9][A-Z0-9._:-]{1,127}$/i.test(body.quizId) ||
      !Number.isSafeInteger(body.quizVersion) || Number(body.quizVersion) < 1 ||
      (body.action !== 'archive' && body.action !== 'restore')) throw new RequestInputError('測驗資料不正確。');
    const config = getDataConfig();
    if (!config) return json({ status: 'error', error: '後端設定尚未完成。' }, 503);
    await changeQuizArchive(config, body.quizId, Number(body.quizVersion), body.action, teacher.email);
    return json({ status: 'ok' });
  } catch (error) {
    if (error instanceof TeacherAccessError || error instanceof RequestInputError || error instanceof ArchiveQuizError)
      return json({ status: 'error', error: error.message }, error.status);
    return json({ status: 'error', error: '封存結果未確認；請重新整理核對。' }, 503);
  }
}
