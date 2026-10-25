import { genericRubricFingerprint, genericRubricVersion } from '@/lib/generic-rubric-approval';
import { getDataConfig } from '@/lib/server/config';
import { json, readJsonBody, RequestInputError } from '@/lib/server/http';
import { requireTeacher, TeacherAccessError } from '@/lib/server/teacher-auth';
import { loadTeacherOverview } from '@/lib/server/teacher-overview';

export async function POST(request: Request): Promise<Response> {
  try {
    const teacher = await requireTeacher(request);
    if (request.headers.get('origin') !== new URL(request.url).origin)
      throw new RequestInputError('無法確認請求來源。', 403);
    const body = await readJsonBody(request) as { quizId?: unknown; quizVersion?: unknown };
    if (!body || typeof body.quizId !== 'string' || !/^CUSTOM-G\d{1,2}-[A-F0-9]{32}$/.test(body.quizId) ||
      !Number.isSafeInteger(body.quizVersion) || Number(body.quizVersion) < 1)
      throw new RequestInputError('測驗資料不正確。');
    const config = getDataConfig();
    if (!config) return json({ status: 'error', error: '後端設定尚未完成。' }, 503);
    const quizzes = await loadTeacherOverview(config);
    const quiz = quizzes.find(item => item.quizId === body.quizId && item.version === body.quizVersion);
    if (!quiz || quiz.status !== 'draft' || quiz.scoreMode !== 'formal' || !quiz.contentApproval ||
      !quiz.questions.length || quiz.questions.some(q => !q.rubric.length ||
        q.rubric.reduce((sum, unit) => sum + unit.points, 0) !== q.points))
      throw new RequestInputError('請先確認題目、配分與完整評分單位。', 409);
    if (quiz.rubricApproval) return json({ status: 'ok', alreadyConfirmed: true });
    const response = await fetch(`${config.supabaseUrl}/rest/v1/translation_audit_log?select=id`, {
      method: 'POST', headers: { apikey: config.supabaseSecretKey,
        authorization: `Bearer ${config.supabaseSecretKey}`, 'content-type': 'application/json',
        prefer: 'return=representation' }, body: JSON.stringify([{
        actor_type: 'teacher', actor_id: teacher.email, action: 'confirm-generic-rubric',
        entity_type: 'translation_quiz', entity_id: `${quiz.quizId}:${quiz.version}`,
        after_data: { rubric_version: genericRubricVersion,
          rubric_fingerprint: genericRubricFingerprint(quiz),
          policy: 'literal-match-advice-only;unknown-wording-requires-teacher-review' },
      }]), cache: 'no-store', signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('Audit not saved');
    const saved = await response.json() as Array<{ id?: number }>;
    if (saved.length !== 1 || !saved[0].id) throw new Error('Audit not confirmed');
    return json({ status: 'ok' });
  } catch (error) {
    if (error instanceof TeacherAccessError || error instanceof RequestInputError)
      return json({ status: 'error', error: error.message }, error.status);
    return json({ status: 'error', error: '評分細則核定未確認；請重新整理核對。' }, 503);
  }
}
