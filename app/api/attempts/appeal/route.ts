import { requireStudentSession, SessionRequirementError } from '@/lib/server/require-session';
import { assertSameOrigin, json, readJsonBody, RequestInputError } from '@/lib/server/http';
import { loadStudentResult } from '@/lib/server/feedback';

const isUuid = (value: unknown): value is string => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const { config, session } = await requireStudentSession(request);
    const body = await readJsonBody(request) as Record<string, unknown>;
    if (typeof body?.quizId !== 'string' || !/^[A-Z0-9][A-Z0-9._:-]{1,127}$/i.test(body.quizId) ||
        !Number.isInteger(body.version) || Number(body.version) < 1 || !isUuid(body.answerId) ||
        typeof body.note !== 'string' || body.note.trim().length < 3 || body.note.length > 300)
      throw new RequestInputError('請選擇題目並簡短說明評分疑義（3～300 字）。');
    const result = await loadStudentResult(config, session, body.quizId, Number(body.version));
    if (!result || (result.status !== 'provisional' && result.status !== 'released') ||
        !result.appealAllowed ||
        !result.details?.some(item => item.answerId === body.answerId))
      throw new RequestInputError('此題目前無法提出評分疑義；請確認回饋是否已開放。', 403);
    const headers = { apikey: config.supabaseSecretKey,
      authorization: `Bearer ${config.supabaseSecretKey}`, 'content-type': 'application/json' };
    const answersResponse = await fetch(`${config.supabaseUrl}/rest/v1/translation_attempt_answers?select=id,attempt_id&id=eq.${body.answerId}&limit=1`,
      { headers, cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    if (!answersResponse.ok) throw new Error('申訴資料讀取失敗。');
    const answers = await answersResponse.json() as Array<{ id: string; attempt_id: string }>;
    if (answers.length !== 1) throw new RequestInputError('找不到此題作答。', 404);
    const answer = answers[0];
    const existingResponse = await fetch(`${config.supabaseUrl}/rest/v1/translation_review_queue?select=id&answer_id=eq.${answer.id}&reason=eq.student-appeal&status=eq.open&limit=1`,
      { headers, cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    if (!existingResponse.ok) throw new Error('申訴狀態讀取失敗。');
    const existing = await existingResponse.json() as Array<{ id: string }>;
    if (existing.length) return json({ status: 'ok', alreadySubmitted: true });
    const queueResponse = await fetch(`${config.supabaseUrl}/rest/v1/translation_review_queue`, {
      method: 'POST', headers: { ...headers, prefer: 'return=representation' },
      body: JSON.stringify({ attempt_id: answer.attempt_id, answer_id: answer.id, reason: 'student-appeal', status: 'open' }),
      cache: 'no-store', signal: AbortSignal.timeout(10_000),
    });
    if (!queueResponse.ok) throw new Error('評分疑義尚未加入教師覆核。');
    const auditResponse = await fetch(`${config.supabaseUrl}/rest/v1/translation_audit_log`, {
      method: 'POST', headers: { ...headers, prefer: 'return=minimal' },
      body: JSON.stringify({ actor_type: 'student', actor_id: session.studentId,
        action: 'student-translation-appeal', entity_type: 'translation-attempt', entity_id: answer.attempt_id,
        after_data: { answerId: answer.id, note: body.note.trim() } }),
      cache: 'no-store', signal: AbortSignal.timeout(10_000),
    });
    if (!auditResponse.ok) throw new Error('評分疑義已列入覆核，但說明尚未確認；請聯絡老師。');
    return json({ status: 'ok' });
  } catch (error) {
    if (error instanceof SessionRequirementError || error instanceof RequestInputError)
      return json({ status: 'error', error: error.message }, error.status);
    return json({ status: 'error', error: '目前無法確認評分疑義已送達，請稍後再試。' }, 503);
  }
}
