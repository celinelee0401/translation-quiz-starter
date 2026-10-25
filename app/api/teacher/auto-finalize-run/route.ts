import { getDataConfig } from '@/lib/server/config';
import { json, readJsonBody, RequestInputError } from '@/lib/server/http';
import { requireTeacher, TeacherAccessError } from '@/lib/server/teacher-auth';
import { autoFinalizeAttempt, loadAutoFinalizeSetting, requestMissingAiReviews } from '@/lib/server/auto-finalize';
import { suggestAnswerWithAi } from '@/lib/server/ai-score-suggestion';
import { getAiConfig, aiNotConfiguredMessage } from '@/lib/server/ai-provider';

const BATCH = 3;

// Processes the next few unfinalized attempts of one quiz. The browser calls
// this repeatedly with the last attempt id until `done` is true.
export async function POST(request: Request): Promise<Response> {
  try {
    await requireTeacher(request);
    if (request.headers.get('origin') !== new URL(request.url).origin) {
      throw new RequestInputError('無法確認請求來源。', 403);
    }
    const body = await readJsonBody(request) as Record<string, unknown>;
    const after = typeof body?.after === 'string' ? body.after : '';
    if (typeof body?.quizId !== 'string' || !/^[A-Z0-9][A-Z0-9._:-]{1,127}$/i.test(body.quizId) ||
        !Number.isInteger(body.version) || Number(body.version) < 1 ||
        (after && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(after))) {
      throw new RequestInputError('資料不正確。');
    }
    const config = getDataConfig();
    const ai = getAiConfig();
    if (!config) return json({ status: 'error', error: '後端設定尚未完成。' }, 503);
    const version = Number(body.version);
    const setting = await loadAutoFinalizeSetting(config, body.quizId, version);
    if (!setting.enabled) throw new RequestInputError('這份測驗尚未開啟 AI 自動採用。', 409);
    const response = await fetch(`${config.supabaseUrl}/rest/v1/translation_attempts?select=id&quiz_id=eq.${encodeURIComponent(body.quizId)}&quiz_version=eq.${version}&status=in.(submitted,review-pending)${after ? `&id=gt.${after}` : ''}&order=id.asc&limit=${BATCH}`, {
      headers: { apikey: config.supabaseSecretKey, authorization: `Bearer ${config.supabaseSecretKey}`, accept: 'application/json' },
      cache: 'no-store', signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('作答清單讀取失敗。');
    const attempts = await response.json() as Array<{ id: string }>;
    const totals = { adopted: 0, skipped: 0, failed: 0 };
    const aiErrors = new Set<string>();
    if (!ai) aiErrors.add(`${aiNotConfiguredMessage}只處理固定規則可判定的題目。`);
    for (const attempt of attempts) {
      if (ai) {
        for (const message of await requestMissingAiReviews(config, attempt.id,
          input => suggestAnswerWithAi(config, ai, input))) aiErrors.add(message);
      }
      const outcome = await autoFinalizeAttempt(config, attempt.id, setting.threshold);
      totals.adopted += outcome.adopted; totals.skipped += outcome.skipped; totals.failed += outcome.failed;
    }
    return json({ status: 'ok', processed: attempts.length, ...totals, aiErrors: [...aiErrors],
      next: attempts.at(-1)?.id ?? after,
      done: attempts.length < BATCH || [...aiErrors].some(message => message.includes('insufficient_quota')) });
  } catch (error) {
    if (error instanceof TeacherAccessError || error instanceof RequestInputError) {
      return json({ status: 'error', error: error.message }, error.status);
    }
    return json({ status: 'error', error: '批次處理中斷，已完成的題目不受影響，可再按一次繼續。' }, 503);
  }
}
