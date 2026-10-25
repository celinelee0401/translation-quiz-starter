import type { DataConfig } from './config.ts';

export class UnpublishError extends Error {
  readonly status: number;
  constructor(message: string, status = 409) { super(message); this.status = status; }
}

/**
 * Undo a mistaken publish: back to draft and hide every class target.
 * Only while no student has started; quiz status changes first so the start RPC
 * (which requires status = published) refuses new attempts during the switch.
 */
export async function unpublishQuiz(config: DataConfig, quizId: string, version: number, actor: string,
  fetcher: typeof fetch = fetch): Promise<{ classes: string[] }> {
  const key = `quiz_id=eq.${encodeURIComponent(quizId)}&quiz_version=eq.${version}`;
  const quizzes = await request<Array<{ status: string; published_at: string | null }>>(config, fetcher,
    `translation_quizzes?${key}&select=status,published_at&limit=2`);
  const targets = await request<Array<{ id: string; class_code: string; dashboard_visible: boolean }>>(config, fetcher,
    `translation_quiz_targets?${key}&school_year=eq.${config.schoolYear}&select=id,class_code,dashboard_visible&limit=20`);
  const quiz = quizzes[0];
  // A draft that still has visible targets is a half-finished earlier undo; finish hiding them.
  const repairing = quiz?.status === 'draft' && targets.some(target => target.dashboard_visible);
  if (quizzes.length !== 1 || (quiz.status !== 'published' && !repairing)) {
    throw new UnpublishError('只有已發布的測驗可以撤銷發布。');
  }
  const started = async () => (await request<Array<{ id: string }>>(config, fetcher,
    `translation_attempts?${key}&select=id&limit=1`)).length > 0;
  if (await started()) {
    throw new UnpublishError('已有學生開始或交卷，不能撤銷發布（作答紀錄需要保留依據）。請改用各班「立即結束」，結束後可封存。');
  }
  const classes = targets.map(target => target.class_code);
  const audit = (action: string) => [{
    actor_type: 'teacher', actor_id: actor, action, entity_type: 'translation_quiz', entity_id: `${quizId}:${version}`,
    before_data: { status: quiz.status, published_at: quiz.published_at, classes },
    after_data: { status: 'draft', dashboard_visible: false, preserved: ['questions', 'rubrics', 'targets', 'approvals'] },
  }];
  const authorized = await request<unknown[]>(config, fetcher, 'translation_audit_log?select=id', 'POST', audit('unpublish-quiz-authorized'));
  if (authorized.length !== 1) throw new UnpublishError('撤銷授權紀錄未確認，測驗仍維持發布。', 503);
  if (quiz.status === 'published') {
    const updated = await request<unknown[]>(config, fetcher,
      `translation_quizzes?${key}&status=eq.published&select=quiz_id`, 'PATCH', { status: 'draft', published_at: null });
    if (updated.length !== 1) throw new UnpublishError('測驗狀態未確認；請重新整理核對。', 503);
    // A student may have started in the instant before the switch; then restore the publish.
    if (await started()) {
      await request<unknown[]>(config, fetcher, `translation_quizzes?${key}&status=eq.draft&select=quiz_id`, 'PATCH',
        { status: 'published', published_at: quiz.published_at }).catch(() => []);
      throw new UnpublishError('剛好有學生開始作答，已恢復發布狀態；請改用各班「立即結束」。請重新整理核對。');
    }
  }
  const hidden = await request<Array<{ id: string }>>(config, fetcher,
    `translation_quiz_targets?${key}&school_year=eq.${config.schoolYear}&select=id`, 'PATCH', { dashboard_visible: false });
  if (hidden.length !== targets.length) {
    throw new UnpublishError('測驗已退回草稿，學生無法作答；但班級時段狀態未全部確認，請重新整理後再按一次撤銷。', 503);
  }
  try {
    await request<unknown[]>(config, fetcher, 'translation_audit_log?select=id', 'POST', audit('unpublish-quiz-complete'));
  } catch {
    throw new UnpublishError('已退回草稿，但完成紀錄未確認；請重新整理核對，勿重複操作。', 503);
  }
  return { classes };
}

async function request<T>(config: DataConfig, fetcher: typeof fetch, path: string,
  method: 'GET' | 'POST' | 'PATCH' = 'GET', body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(`${config.supabaseUrl}/rest/v1/${path}`, {
      method, headers: {
        apikey: config.supabaseSecretKey, authorization: `Bearer ${config.supabaseSecretKey}`, accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json', prefer: 'return=representation' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: 'no-store', signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new UnpublishError('目前無法連線到後端，請稍後再試。', 503);
  }
  if (!response.ok) throw new UnpublishError(`後端撤銷操作失敗（HTTP ${response.status}），請重新整理核對。`, 503);
  return await response.json() as T;
}
