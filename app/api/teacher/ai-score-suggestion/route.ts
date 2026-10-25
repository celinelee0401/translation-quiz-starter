import { getDataConfig } from '@/lib/server/config';
import { json, readJsonBody, RequestInputError } from '@/lib/server/http';
import { parseAiSuggestionInput, suggestAnswerWithAi } from '@/lib/server/ai-score-suggestion';
import { requireTeacher, TeacherAccessError } from '@/lib/server/teacher-auth';
import { getAiConfig, aiNotConfiguredMessage } from '@/lib/server/ai-provider';

export async function POST(request: Request): Promise<Response> {
  try {
    await requireTeacher(request);
    if (request.headers.get('origin') !== new URL(request.url).origin) {
      throw new RequestInputError('無法確認請求來源。', 403);
    }
    const input = parseAiSuggestionInput(await readJsonBody(request));
    const config = getDataConfig();
    const ai = getAiConfig();
    if (!config) return json({ status: 'error', error: '後端設定尚未完成。' }, 503);
    if (!ai) return json({ status: 'error', error: aiNotConfiguredMessage }, 503);
    const suggestion = await suggestAnswerWithAi(config, ai, input);
    return json({ status: 'ok', suggestion });
  } catch (error) {
    if (error instanceof TeacherAccessError || error instanceof RequestInputError) {
      return json({ status: 'error', error: error.message }, error.status);
    }
    if (error instanceof Error && /^AI |^OpenAI /.test(error.message)) {
      return json({ status: 'error', error: `${error.message}（原始答案與教師分數沒有變更）` }, 503);
    }
    return json({ status: 'error', error: 'AI 建議暫時無法取得；原始答案與教師分數沒有變更。' }, 503);
  }
}
