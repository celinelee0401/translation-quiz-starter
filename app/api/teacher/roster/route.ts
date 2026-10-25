import { getDataConfig } from '@/lib/server/config';
import { assertSameOrigin, json, readJsonBody, RequestInputError } from '@/lib/server/http';
import { importRoster, parseRoster } from '@/lib/server/roster';
import { requireTeacher, TeacherAccessError } from '@/lib/server/teacher-auth';

export async function POST(request: Request): Promise<Response> {
  try {
    const teacher = await requireTeacher(request);
    assertSameOrigin(request);
    const config = getDataConfig();
    if (!config) return json({ status: 'error', error: '後端設定尚未完成。' }, 503);
    const body = await readJsonBody(request) as { text?: unknown } | null;
    if (!body || typeof body.text !== 'string') throw new RequestInputError('請貼上名冊。');
    const rows = await importRoster(config, parseRoster(body.text, config.loginMode), teacher.email);
    // PINs are returned once so the teacher can hand them out; they are not stored in plain text.
    return json({ status: 'ok', rows }, 200, { 'cache-control': 'no-store' });
  } catch (error) {
    if (error instanceof TeacherAccessError || error instanceof RequestInputError) {
      return json({ status: 'error', error: error.message }, error.status);
    }
    console.error('Roster import failed:', error);
    return json({ status: 'error', error: '名冊匯入未完成，請重新整理核對後再試。' }, 503);
  }
}
