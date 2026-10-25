import { getDataConfig } from '@/lib/server/config';
import { json, readJsonBody, RequestInputError } from '@/lib/server/http';
import { saveTeacherReview, ReviewSaveError, parseReviewInput } from '@/lib/server/save-review';
import { requireTeacher, TeacherAccessError } from '@/lib/server/teacher-auth';

export async function POST(request: Request): Promise<Response> {
  try {
    const teacher = await requireTeacher(request);
    if (request.headers.get('origin') !== new URL(request.url).origin) {
      throw new RequestInputError('無法確認請求來源。', 403);
    }
    const input = parseReviewInput(await readJsonBody(request));
    const config = getDataConfig();
    if (!config) return json({ status: 'error', error: '後端設定尚未完成。' }, 503);
    const result = await saveTeacherReview(config, input, teacher.email);
    return json({ status: 'ok', result });
  } catch (error) {
    if (error instanceof TeacherAccessError || error instanceof RequestInputError || error instanceof ReviewSaveError) {
      return json({ status: 'error', error: error.message }, error.status);
    }
    return json({ status: 'error', error: '目前無法確認覆核已儲存，請重新整理核對。' }, 503);
  }
}
