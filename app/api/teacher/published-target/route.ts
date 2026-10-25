import { getDataConfig } from '@/lib/server/config';
import { addPublishedTarget, DraftTargetError, type TargetInput } from '@/lib/server/draft-targets';
import { json, readJsonBody, RequestInputError } from '@/lib/server/http';
import { requireTeacher, TeacherAccessError } from '@/lib/server/teacher-auth';

export async function POST(request: Request): Promise<Response> {
  try {
    const teacher = await requireTeacher(request);
    if (request.headers.get('origin') !== new URL(request.url).origin) {
      throw new RequestInputError('無法確認請求來源。', 403);
    }
    const body = await readJsonBody(request);
    if (!body || typeof body !== 'object') throw new RequestInputError('時段資料不正確。');
    const config = getDataConfig();
    if (!config) return json({ status: 'error', error: '後端設定尚未完成。' }, 503);
    const target = await addPublishedTarget(config, body as TargetInput, teacher.email);
    return json({ status: 'ok', target });
  } catch (error) {
    if (error instanceof TeacherAccessError || error instanceof RequestInputError || error instanceof DraftTargetError) {
      return json({ status: 'error', error: error.message }, error.status);
    }
    return json({ status: 'error', error: '新增班級未確認，請重新整理核對。' }, 503);
  }
}
