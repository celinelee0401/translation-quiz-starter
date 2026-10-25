import { assertSameOrigin, json, readJsonBody, RequestInputError } from '@/lib/server/http';
import { setTeacherCode } from '@/lib/server/setup';

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const body = await readJsonBody(request) as { setupCode?: unknown; teacherCode?: unknown } | null;
    await setTeacherCode({ setupCode: body?.setupCode, teacherCode: body?.teacherCode });
    return json({ status: 'ok' });
  } catch (error) {
    if (error instanceof RequestInputError) return json({ status: 'error', error: error.message }, error.status);
    console.error('Teacher code setup failed:', error);
    return json({ status: 'error', error: '教師通行碼尚未儲存。請確認上方「資料庫」檢查是綠色的，再試一次。' }, 503);
  }
}
