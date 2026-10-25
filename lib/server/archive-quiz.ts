import { canArchiveQuiz } from '../quiz-management.ts';
import type { DataConfig } from './config.ts';
import { loadTeacherOverview } from './teacher-overview.ts';

export class ArchiveQuizError extends Error {
  readonly status: number;
  constructor(message: string, status = 409) { super(message); this.status = status; }
}

async function tableRequest(config: DataConfig, path: string, method: 'POST' | 'PATCH', body: unknown,
  fetcher: typeof fetch): Promise<Array<Record<string, unknown>>> {
  const response = await fetcher(`${config.supabaseUrl}/rest/v1/${path}`, {
    method, headers: {
      apikey: config.supabaseSecretKey,
      authorization: `Bearer ${config.supabaseSecretKey}`,
      'content-type': 'application/json', prefer: 'return=representation',
    }, body: JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new ArchiveQuizError('後端未能確認封存狀態；請重新整理核對。', 503);
  return await response.json() as Array<Record<string, unknown>>;
}

export async function changeQuizArchive(config: DataConfig, quizId: string, version: number,
  action: 'archive' | 'restore', actor: string, fetcher: typeof fetch = fetch): Promise<void> {
  const quizzes = await loadTeacherOverview(config, fetcher);
  const quiz = quizzes.find(item => item.quizId === quizId && item.version === version);
  if (!quiz) throw new ArchiveQuizError('找不到指定測驗。', 404);
  if (action === 'archive' && !canArchiveQuiz(quiz)) {
    throw new ArchiveQuizError('測驗仍在開放中；須先等所有班級時段結束才可封存。');
  }
  if (action === 'restore' && quiz.status !== 'archived') {
    throw new ArchiveQuizError('這份測驗尚未封存。');
  }
  const previousStatus = quiz.status;
  // A published quiz may be restored only after its class windows ended. Restoring
  // does not change those windows; the teacher must explicitly schedule a makeup.
  const nextStatus = action === 'archive' ? 'archived' :
    previousStatus === 'archived' ? await previousArchiveStatus(config, quizId, version, fetcher) : previousStatus;
  const entityId = `${quizId}:${version}`;
  const before = { status: previousStatus };
  const after = { status: nextStatus, preserved: ['questions', 'rubrics', 'targets', 'attempts', 'answers', 'grades'] };
  const auditRow = { actor_type: 'teacher', actor_id: actor,
    action: action === 'archive' ? 'archive-quiz-authorized' : 'restore-quiz-authorized',
    entity_type: 'translation_quiz', entity_id: entityId, before_data: before, after_data: after };
  const audit = await tableRequest(config, 'translation_audit_log?select=id', 'POST', [auditRow], fetcher);
  if (audit.length !== 1) throw new ArchiveQuizError('稽核紀錄未確認，測驗狀態未變更。', 503);
  const key = `quiz_id=eq.${encodeURIComponent(quizId)}&quiz_version=eq.${version}`;
  const updated = await tableRequest(config,
    `translation_quizzes?${key}&status=eq.${previousStatus}&select=quiz_id,quiz_version,status`, 'PATCH',
    { status: nextStatus }, fetcher);
  if (updated.length !== 1) throw new ArchiveQuizError('測驗狀態未確認；請重新整理核對。', 503);
}

async function previousArchiveStatus(config: DataConfig, quizId: string, version: number,
  fetcher: typeof fetch): Promise<'draft' | 'published' | 'closed'> {
  const response = await fetcher(`${config.supabaseUrl}/rest/v1/translation_audit_log?select=before_data&entity_type=eq.translation_quiz&entity_id=eq.${encodeURIComponent(`${quizId}:${version}`)}&action=eq.archive-quiz-authorized&order=occurred_at.desc&limit=1`, {
    headers: { apikey: config.supabaseSecretKey, authorization: `Bearer ${config.supabaseSecretKey}` },
    cache: 'no-store', signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new ArchiveQuizError('無法核對原始測驗狀態；請稍後再試。', 503);
  const rows = await response.json() as Array<{ before_data?: { status?: string } }>;
  if (rows.length !== 1 || !['draft', 'published', 'closed'].includes(rows[0].before_data?.status ?? '')) {
    throw new ArchiveQuizError('缺少封存前狀態紀錄，無法安全還原。');
  }
  return rows[0].before_data?.status as 'draft' | 'published' | 'closed';
}
