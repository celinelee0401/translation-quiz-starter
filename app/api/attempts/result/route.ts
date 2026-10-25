import { loadStudentResult } from '@/lib/server/feedback';
import { requireStudentSession, SessionRequirementError } from '@/lib/server/require-session';
import { json } from '@/lib/server/http';

export async function GET(request: Request): Promise<Response> {
  try {
    const { config, session } = await requireStudentSession(request);
    const url = new URL(request.url);
    const quizId = url.searchParams.get('quiz') ?? '';
    const version = Number(url.searchParams.get('version'));
    if (!/^[A-Z0-9][A-Z0-9._:-]{1,127}$/i.test(quizId) || !Number.isInteger(version) || version < 1)
      return json({ error: '測驗資料不正確。' }, 400);
    const result = await loadStudentResult(config, session, quizId, version);
    return result ? json({ status: 'ok', result }) : json({ status: 'not-found' }, 404);
  } catch (error) {
    if (error instanceof SessionRequirementError) return json({ error: error.message }, error.status);
    return json({ error: '目前無法確認測驗結果，請稍後再試。' }, 503);
  }
}
