import { getDataConfig } from '@/lib/server/config';
import { enableLiveFeedback, isLiveFeedbackEnabled, loadLiveFeedbackTarget } from '@/lib/server/live-feedback';
import { requireTeacher, TeacherAccessError } from '@/lib/server/teacher-auth';
import { assertSameOrigin, json, readJsonBody, RequestInputError } from '@/lib/server/http';
import { classCodePattern } from '@/lib/public-quiz-data';

function parse(value: unknown): { quizId: string; version: number; classCode: string } {
  if (!value || typeof value !== 'object') throw new RequestInputError('請選擇測驗與班級。');
  const input = value as Record<string, unknown>;
  if (typeof input.quizId !== 'string' || !/^[A-Z0-9][A-Z0-9._:-]{1,127}$/i.test(input.quizId) ||
      !Number.isInteger(input.version) || Number(input.version) < 1 ||
      typeof input.classCode !== 'string' || !classCodePattern.test(input.classCode))
    throw new RequestInputError('測驗或班級資料不正確。');
  return { quizId: input.quizId, version: Number(input.version), classCode: input.classCode };
}

export async function GET(request: Request): Promise<Response> {
  try {
    await requireTeacher(request);
    const config = getDataConfig();
    if (!config) return json({ error: '後端設定尚未完成。' }, 503);
    const url = new URL(request.url);
    const input = parse({ quizId: url.searchParams.get('quiz'), version: Number(url.searchParams.get('version')),
      classCode: url.searchParams.get('class') });
    const target = await loadLiveFeedbackTarget(config, input.quizId, input.version, input.classCode);
    if (!target) return json({ error: '找不到班級時段。' }, 404);
    return json({ status: 'ok', enabled: await isLiveFeedbackEnabled(config, target.id), closesAt: target.closes_at });
  } catch (error) {
    if (error instanceof TeacherAccessError || error instanceof RequestInputError)
      return json({ error: error.message }, error.status);
    return json({ error: '目前無法確認即時回饋設定。' }, 503);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const teacher = await requireTeacher(request);
    const config = getDataConfig();
    if (!config) return json({ error: '後端設定尚未完成。' }, 503);
    const input = parse(await readJsonBody(request));
    const target = await enableLiveFeedback(config, input.quizId, input.version, input.classCode, teacher.email);
    return json({ status: 'ok', enabled: true, closesAt: target.closes_at });
  } catch (error) {
    if (error instanceof TeacherAccessError || error instanceof RequestInputError)
      return json({ error: error.message }, error.status);
    return json({ error: error instanceof Error ? error.message : '目前無法啟用即時回饋。' }, 409);
  }
}
