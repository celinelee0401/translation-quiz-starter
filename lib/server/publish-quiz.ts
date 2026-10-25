import { getReleaseChecks } from '../release-readiness.ts';
import type { DataConfig } from './config.ts';
import { loadTeacherOverview } from './teacher-overview.ts';

export class PublishError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

async function write(config: DataConfig, path: string, method: 'POST' | 'PATCH', body: unknown): Promise<unknown[]> {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: config.supabaseSecretKey,
      authorization: `Bearer ${config.supabaseSecretKey}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
    },
    body: JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new PublishError('後端未能確認發布，請重新整理檢查狀態。', 503);
  return await response.json() as unknown[];
}

export async function publishQuiz(config: DataConfig, quizId: string, version: number, actor: string): Promise<void> {
  const quizzes = await loadTeacherOverview(config);
  const quiz = quizzes.find(item => item.quizId === quizId && item.version === version);
  if (!quiz || quiz.status !== 'draft') throw new PublishError('只可發布尚未發布的草稿。');
  const pending = getReleaseChecks(quiz).filter(check => check.state !== 'pass');
  if (pending.length) throw new PublishError(`尚未通過發布檢查：${pending.map(check => check.label).join('、')}。`);

  const key = `quiz_id=eq.${encodeURIComponent(quizId)}&quiz_version=eq.${version}`;
  const targetPath = `translation_quiz_targets?${key}&school_year=eq.${config.schoolYear}&select=id`;
  const audit = (action: string) => [{
    actor_type: 'teacher', actor_id: actor, action,
    entity_type: 'translation_quiz', entity_id: `${quizId}:${version}`,
    after_data: { school_year: config.schoolYear, classes: quiz.targets.map(target => target.classCode), score_mode: quiz.scoreMode },
  }];
  // Record authorization before changing access. Draft status continues to block students
  // until the final quiz update, even if the target update succeeds and a retry is needed.
  const started = await write(config, 'translation_audit_log?select=id', 'POST', audit('publish-quiz-authorized'));
  if (started.length !== 1) throw new PublishError('發布稽核紀錄未確認，測驗仍未開放。', 503);
  const targets = await write(config, targetPath, 'PATCH', { dashboard_visible: true });
  if (targets.length !== quiz.targets.length) throw new PublishError('班級發布狀態未全部確認；學生尚不可作答，請重新整理核對。', 503);
  const published = await write(config,
    `translation_quizzes?${key}&status=eq.draft&select=quiz_id,quiz_version,status`, 'PATCH',
    { status: 'published', published_at: new Date().toISOString() });
  if (published.length !== 1) throw new PublishError('測驗狀態未確認發布，請重新整理核對。', 503);
  try {
    await write(config, 'translation_audit_log?select=id', 'POST', audit('publish-quiz-complete'));
  } catch {
    throw new PublishError('測驗可能已發布，但完成稽核失敗；請立即重新整理並核對，不要重複按發布。', 503);
  }
}
