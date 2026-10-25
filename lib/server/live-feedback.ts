import type { DataConfig } from './config.ts';

export type LiveFeedbackTarget = {
  id: string;
  quiz_id: string;
  quiz_version: number;
  school_year: string;
  class_code: string;
  opens_at: string;
  closes_at: string;
  dashboard_visible: boolean;
};

export async function isLiveFeedbackEnabled(config: DataConfig, targetId: string,
  fetcher: typeof fetch = fetch): Promise<boolean> {
  const events = await read<Array<{ id: number }>>(config,
    `translation_audit_log?select=id&entity_type=eq.translation_quiz_target&entity_id=eq.${encodeURIComponent(targetId)}&action=eq.enable-live-feedback&limit=1`, fetcher);
  return events.length === 1;
}

export function isWithinClassWindow(target: Pick<LiveFeedbackTarget, 'opens_at' | 'closes_at'>,
  now = new Date()): boolean {
  const start = Date.parse(target.opens_at);
  const end = Date.parse(target.closes_at);
  return Number.isFinite(start) && Number.isFinite(end) && start <= now.getTime() && now.getTime() < end;
}

export async function loadLiveFeedbackTarget(config: DataConfig, quizId: string, version: number,
  classCode: string, fetcher: typeof fetch = fetch): Promise<LiveFeedbackTarget | null> {
  const rows = await read<LiveFeedbackTarget[]>(config,
    `translation_quiz_targets?select=id,quiz_id,quiz_version,school_year,class_code,opens_at,closes_at,dashboard_visible&quiz_id=eq.${encodeURIComponent(quizId)}&quiz_version=eq.${version}&school_year=eq.${config.schoolYear}&class_code=eq.${encodeURIComponent(classCode)}&limit=2`, fetcher);
  if (rows.length > 1) throw new Error('班級時段資料不完整。');
  return rows[0] ?? null;
}

export async function enableLiveFeedback(config: DataConfig, quizId: string, version: number,
  classCode: string, actor: string, fetcher: typeof fetch = fetch): Promise<LiveFeedbackTarget> {
  const quizzes = await read<Array<{ status: string; score_mode: string; feedback_policy: string }>>(config,
    `translation_quizzes?select=status,score_mode,feedback_policy&quiz_id=eq.${encodeURIComponent(quizId)}&quiz_version=eq.${version}&limit=2`, fetcher);
  if (quizzes.length !== 1 || quizzes[0].status !== 'published' ||
      quizzes[0].score_mode !== 'formal' || quizzes[0].feedback_policy !== 'teacher-release') {
    throw new Error('只有已發布、採教師回饋政策的正式測驗可啟用課堂即時回饋。');
  }
  const target = await loadLiveFeedbackTarget(config, quizId, version, classCode, fetcher);
  if (!target || !target.dashboard_visible) throw new Error('找不到這個班級的已發布時段。');
  if (!Number.isFinite(Date.parse(target.closes_at)) || Date.now() >= Date.parse(target.closes_at))
    throw new Error('這個班級的測驗時段已截止，不能再啟用即時回饋。');
  if (await isLiveFeedbackEnabled(config, target.id, fetcher)) return target;
  const response = await fetcher(`${config.supabaseUrl}/rest/v1/translation_audit_log`, {
    method: 'POST', headers: {
      apikey: config.supabaseSecretKey, authorization: `Bearer ${config.supabaseSecretKey}`,
      'content-type': 'application/json', prefer: 'return=minimal',
    },
    body: JSON.stringify({ actor_type: 'teacher', actor_id: actor,
      action: 'enable-live-feedback', entity_type: 'translation_quiz_target', entity_id: target.id,
      before_data: null, after_data: { quizId, version, classCode, closesAt: target.closes_at } }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('即時回饋設定尚未確認，請重新整理核對。');
  return target;
}

async function read<T>(config: DataConfig, path: string, fetcher: typeof fetch): Promise<T> {
  const response = await fetcher(`${config.supabaseUrl}/rest/v1/${path}`, {
    headers: { apikey: config.supabaseSecretKey, authorization: `Bearer ${config.supabaseSecretKey}`, accept: 'application/json' },
    cache: 'no-store', signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`即時回饋資料讀取失敗（${response.status}）。`);
  return await response.json() as T;
}
