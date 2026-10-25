import { json, readJsonBody, RequestInputError } from '@/lib/server/http';
import { parseEnglishLines, generateQuizQuestions } from '@/lib/server/generate-quiz-questions';
import { requireTeacher, TeacherAccessError } from '@/lib/server/teacher-auth';
import { getAiConfig, aiNotConfiguredMessage } from '@/lib/server/ai-provider';

export async function POST(request: Request): Promise<Response> {
  try {
    await requireTeacher(request);
    if (request.headers.get('origin') !== new URL(request.url).origin)
      throw new RequestInputError('無法確認請求來源。', 403);
    const body = await readJsonBody(request, 16 * 1024) as { englishAnswers?: unknown };
    const answers = parseEnglishLines(body?.englishAnswers);
    const ai = getAiConfig();
    if (!ai) return json({ status: 'error', error: aiNotConfiguredMessage }, 503);
    const questions = await generateQuizQuestions(answers, ai);
    return json({ status: 'ok', questions });
  } catch (error) {
    if (error instanceof TeacherAccessError || error instanceof RequestInputError)
      return json({ status: 'error', error: error.message }, error.status);
    return json({ status: 'error', error: 'AI 命題未完成；未儲存或發布任何題目。' }, 503);
  }
}
