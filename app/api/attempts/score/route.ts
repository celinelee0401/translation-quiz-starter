import { requireStudentSession, SessionRequirementError } from '@/lib/server/require-session';
import { assertSameOrigin, json, readJsonBody, RequestInputError } from '@/lib/server/http';
import { loadStudentResult } from '@/lib/server/feedback';
import { suggestAnswerWithAi } from '@/lib/server/ai-score-suggestion';
import { autoFinalizeAttempt, loadAutoFinalizeSetting, withAiRetry } from '@/lib/server/auto-finalize';
import { getAiConfig } from '@/lib/server/ai-provider';

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const { config, session } = await requireStudentSession(request);
    const body = await readJsonBody(request) as { quizId?: unknown; version?: unknown };
    if (typeof body?.quizId !== 'string' || !/^[A-Z0-9][A-Z0-9._:-]{1,127}$/i.test(body.quizId) ||
        !Number.isInteger(body.version) || Number(body.version) < 1)
      throw new RequestInputError('測驗資料不正確。');
    const quizId = body.quizId;
    const version = Number(body.version);
    const result = await loadStudentResult(config, session, quizId, version);
    if (!result) return json({ status: 'not-found' }, 404);
    if (result.status !== 'provisional' || !result.details?.length)
      return json({ status: 'ok', result });
    const ai = getAiConfig();
    if (ai) {
      const pending = result.details.filter(item => item.scoreState === 'pending' && item.updatedAt && item.rawAnswer.trim()).slice(0, 20);
      await Promise.allSettled(pending.map(item => withAiRetry(() => suggestAnswerWithAi(config, ai,
        { answerId: item.answerId, updatedAt: item.updatedAt! }))));
    }
    // When the teacher enabled automatic adoption for this quiz, finalize the
    // answers that meet the rule; the rest stay in the teacher's review list.
    try {
      const setting = await loadAutoFinalizeSetting(config, quizId, version);
      if (setting.enabled) {
        const attemptRows = await (await fetch(`${config.supabaseUrl}/rest/v1/translation_attempts?select=id&quiz_id=eq.${encodeURIComponent(quizId)}&quiz_version=eq.${version}&student_id=eq.${session.studentId}&enrollment_id=eq.${session.enrollmentId}&status=in.(submitted,review-pending)&order=server_submit_time.desc&limit=1`, {
          headers: { apikey: config.supabaseSecretKey, authorization: `Bearer ${config.supabaseSecretKey}`, accept: 'application/json' },
          cache: 'no-store', signal: AbortSignal.timeout(10_000),
        })).json() as Array<{ id: string }>;
        if (attemptRows[0]) await autoFinalizeAttempt(config, attemptRows[0].id, setting.threshold);
      }
    } catch {
      // The student still receives the provisional result; the teacher can run the batch later.
    }
    const refreshed = await loadStudentResult(config, session, quizId, version);
    return json({ status: 'ok', result: refreshed });
  } catch (error) {
    if (error instanceof SessionRequirementError || error instanceof RequestInputError)
      return json({ status: 'error', error: error.message }, error.status);
    return json({ status: 'error', error: '作答已儲存，但暫定分數尚未完成；請重新整理後再試。' }, 503);
  }
}
