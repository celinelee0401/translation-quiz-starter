import { getDataConfig } from '@/lib/server/config';
import { json, readJsonBody, RequestInputError } from '@/lib/server/http';
import { requireTeacher, TeacherAccessError } from '@/lib/server/teacher-auth';
import { createQuizDraft, CreateDraftError, validateNewDraft } from '@/lib/server/create-quiz-draft';

export async function POST(request: Request): Promise<Response> {
  try {
    const teacher = await requireTeacher(request);
    if (request.headers.get('origin') !== new URL(request.url).origin)
      throw new RequestInputError('無法確認請求來源。', 403);
    const input = validateNewDraft(await readJsonBody(request, 64 * 1024));
    const config = getDataConfig();
    if (!config) return json({ status: 'error', error: '後端設定尚未完成。' }, 503);
    const quizId = await createQuizDraft(config, input, teacher.email);
    return json({ status: 'ok', quizId });
  } catch (error) {
    if (error instanceof TeacherAccessError || error instanceof RequestInputError || error instanceof CreateDraftError)
      return json({ status: 'error', error: error.message }, error.status);
    return json({ status: 'error', error: '草稿儲存未確認；請重新整理核對。' }, 503);
  }
}
