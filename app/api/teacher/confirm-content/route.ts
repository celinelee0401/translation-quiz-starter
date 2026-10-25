import { quizContentFingerprint } from '@/lib/quiz-content-approval';
import { getDataConfig } from '@/lib/server/config';
import { json, readJsonBody, RequestInputError } from '@/lib/server/http';
import { requireTeacher, TeacherAccessError } from '@/lib/server/teacher-auth';
import { loadTeacherOverview } from '@/lib/server/teacher-overview';

export async function POST(request: Request): Promise<Response> {
  try {
    const teacher = await requireTeacher(request);
    if (request.headers.get('origin') !== new URL(request.url).origin) {
      throw new RequestInputError('無法確認請求來源。', 403);
    }
    const body = await readJsonBody(request) as { quizId?: unknown; quizVersion?: unknown };
    if (!body || typeof body.quizId !== 'string' ||
      !/^[A-Z0-9][A-Z0-9._:-]{1,127}$/i.test(body.quizId) ||
      !Number.isSafeInteger(body.quizVersion) || Number(body.quizVersion) < 1) {
      throw new RequestInputError('測驗資料不正確。');
    }
    const config = getDataConfig();
    if (!config) return json({ status: 'error', error: '後端設定尚未完成。' }, 503);
    const overview = await loadTeacherOverview(config);
    const quiz = overview.find((item) => item.quizId === body.quizId && item.version === body.quizVersion);
    if (!quiz || quiz.status !== 'draft' || quiz.scoreMode !== 'formal' || !quiz.questions.length) {
      throw new RequestInputError('這份測驗不是可核定的正式草稿。', 409);
    }
    if (quiz.contentApproval) return json({ status: 'ok', alreadyConfirmed: true });
    const response = await fetch(`${config.supabaseUrl}/rest/v1/translation_audit_log`, {
      method: 'POST',
      headers: {
        apikey: config.supabaseSecretKey,
        authorization: `Bearer ${config.supabaseSecretKey}`,
        'content-type': 'application/json',
        prefer: 'return=representation',
      },
      body: JSON.stringify([{
        actor_type: 'teacher',
        actor_id: teacher.email,
        action: 'confirm-quiz-content-points',
        entity_type: 'translation_quiz',
        entity_id: `${quiz.quizId}:${quiz.version}`,
        after_data: {
          content_fingerprint: quizContentFingerprint(quiz),
          question_count: quiz.questions.length,
          total_points: quiz.questions.reduce((sum, question) => sum + question.points, 0),
          scope: 'questions-answers-points-only',
        },
      }]),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Audit write failed: ${response.status}`);
    const saved = await response.json() as Array<{ id?: number }>;
    if (saved.length !== 1 || !saved[0].id) throw new Error('Audit write was not confirmed');
    return json({ status: 'ok' });
  } catch (error) {
    if (error instanceof TeacherAccessError || error instanceof RequestInputError) {
      return json({ status: 'error', error: error.message }, error.status);
    }
    return json({ status: 'error', error: '核定紀錄尚未確認儲存，請重新整理核對。' }, 503);
  }
}
