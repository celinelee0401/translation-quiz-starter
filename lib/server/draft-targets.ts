import { gradeLevelForClass } from '../public-quiz-data.ts';
import { fromSchoolLocal } from '../school-time.ts';
import type { DataConfig } from './config.ts';

export type TargetInput = {
  quizId: string;
  quizVersion: number;
  classCode: string;
  opensAtLocal: string;
  closesAtLocal: string;
  retainFeedbackAfterClose?: boolean;
  attemptLimit?: number;
};

function attemptLimitOf(input: TargetInput): number {
  const limit = input.attemptLimit ?? 1;
  if (!Number.isInteger(limit) || limit < 1 || limit > maxTeacherAttemptLimit) {
    throw new DraftTargetError(`作答次數須為 1 到 ${maxTeacherAttemptLimit} 次。`);
  }
  return limit;
}

export class DraftTargetError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function saveDraftTarget(
  config: DataConfig,
  input: TargetInput,
  actor: string,
  fetcher: typeof fetch = fetch,
): Promise<{ classCode: string; opensAt: string; closesAt: string }> {
  if (!/^[A-Z0-9][A-Z0-9._:-]{1,127}$/i.test(input.quizId) ||
    !Number.isInteger(input.quizVersion) || input.quizVersion < 1 ||
    !gradeLevelForClass(input.classCode)) {
    throw new DraftTargetError('測驗或班級資料不正確。');
  }
  const opensAt = taipeiTime(input.opensAtLocal);
  const closesAt = taipeiTime(input.closesAtLocal);
  if (opensAt.getTime() < Date.now() + 120_000 || closesAt <= opensAt ||
    closesAt.getTime() - opensAt.getTime() > 90 * 86400_000) {
    throw new DraftTargetError('請設定未來的開放時間，截止時間須較晚且相隔不超過 90 天。');
  }
  const filter = `quiz_id=eq.${encodeURIComponent(input.quizId)}&quiz_version=eq.${input.quizVersion}`;
  const quizzes = await table<Array<{ status: string; grade_level: number }>>(
    config, `translation_quizzes?${filter}&select=status,grade_level`, fetcher);
  if (quizzes.length !== 1 || quizzes[0].status !== 'draft' ||
    quizzes[0].grade_level !== gradeLevelForClass(input.classCode)) {
    throw new DraftTargetError('這份測驗不是該班可排程的草稿。', 409);
  }
  const targetFilter = `${filter}&school_year=eq.${config.schoolYear}&class_code=eq.${input.classCode}`;
  const previous = await table<Array<{ id: string; opens_at: string; closes_at: string; dashboard_visible: boolean }>>(
    config, `translation_quiz_targets?${targetFilter}&select=id,opens_at,closes_at,dashboard_visible`, fetcher);
  if (previous.length > 1 || previous[0]?.dashboard_visible) {
    throw new DraftTargetError('班級目標資料狀態異常，請先檢查。', 409);
  }
  if (previous.length) {
    const attempts = await table<Array<{ id: string }>>(config,
      `translation_attempts?target_id=eq.${previous[0].id}&select=id&limit=1`, fetcher);
    if (attempts.length) throw new DraftTargetError('已有學生作答紀錄，不能修改此時段。', 409);
  }
  const next = {
    quiz_id: input.quizId,
    quiz_version: input.quizVersion,
    school_year: config.schoolYear,
    grade_level: quizzes[0].grade_level,
    class_code: input.classCode,
    opens_at: opensAt.toISOString(),
    closes_at: closesAt.toISOString(),
    feedback_at: null,
    dashboard_visible: false,
    attempt_limit: attemptLimitOf(input),
  };
  const saved = await table<Array<{ id: string }>>(config,
    'translation_quiz_targets?on_conflict=quiz_id,quiz_version,school_year,class_code&select=id',
    fetcher, [next], 'resolution=merge-duplicates,return=representation');
  if (saved.length !== 1) throw new DraftTargetError('時段儲存結果異常，請重新整理核對。', 503);
  try {
    await table(config, 'translation_audit_log', fetcher, [{
      actor_type: 'teacher', actor_id: actor, action: 'save-draft-target',
      entity_type: 'translation_quiz_target', entity_id: saved[0].id,
      before_data: previous[0] ?? null, after_data: next,
    }]);
  } catch {
    throw new DraftTargetError('時段可能已儲存，但稽核紀錄失敗；請重新整理並聯絡管理者核對。', 503);
  }
  return { classCode: input.classCode, opensAt: next.opens_at, closesAt: next.closes_at };
}

/** Add a new class to an already published quiz without touching existing class windows. */
export async function addPublishedTarget(
  config: DataConfig,
  input: TargetInput,
  actor: string,
  fetcher: typeof fetch = fetch,
): Promise<{ classCode: string; opensAt: string; closesAt: string }> {
  if (!/^[A-Z0-9][A-Z0-9._:-]{1,127}$/i.test(input.quizId) ||
    !Number.isInteger(input.quizVersion) || input.quizVersion < 1 ||
    !gradeLevelForClass(input.classCode)) {
    throw new DraftTargetError('測驗或班級資料不正確。');
  }
  const opensAt = taipeiTime(input.opensAtLocal);
  const closesAt = taipeiTime(input.closesAtLocal);
  if (opensAt.getTime() < Date.now() + 120_000 || closesAt <= opensAt ||
    closesAt.getTime() - opensAt.getTime() > 90 * 86400_000) {
    throw new DraftTargetError('請設定至少兩分鐘後的開放時間，截止時間須較晚且相隔不超過 90 天。');
  }
  const filter = `quiz_id=eq.${encodeURIComponent(input.quizId)}&quiz_version=eq.${input.quizVersion}`;
  const quizzes = await table<Array<{ status: string; grade_level: number; score_mode: string; feedback_policy: string }>>(
    config, `translation_quizzes?${filter}&select=status,grade_level,score_mode,feedback_policy`, fetcher);
  if (quizzes.length !== 1 || quizzes[0].status !== 'published' ||
    quizzes[0].grade_level !== gradeLevelForClass(input.classCode)) {
    throw new DraftTargetError('這份測驗不是該班可追加排程的已發布測驗。', 409);
  }
  if (quizzes[0].score_mode === 'formal' && quizzes[0].feedback_policy !== 'teacher-release') {
    throw new DraftTargetError('為避免先考班級已看過答案，這份正式測驗不能在發布後追加班級。請先聯絡管理者評估。', 409);
  }
  const released = await table<Array<{ id: number }>>(config,
    `translation_audit_log?select=id&entity_type=eq.translation_quiz&entity_id=eq.${encodeURIComponent(`${input.quizId}:${input.quizVersion}`)}&action=eq.release-translation-feedback&limit=1`, fetcher);
  if (released.length) throw new DraftTargetError('本測驗的分數與答案已向學生發布，不能再追加班級。', 409);
  const targetFilter = `${filter}&school_year=eq.${config.schoolYear}&class_code=eq.${input.classCode}`;
  const previous = await table<Array<{ id: string }>>(
    config, `translation_quiz_targets?${targetFilter}&select=id`, fetcher);
  if (previous.length) throw new DraftTargetError(`${input.classCode} 班已有排程；不會覆寫已發布時段。`, 409);
  const next = {
    quiz_id: input.quizId,
    quiz_version: input.quizVersion,
    school_year: config.schoolYear,
    grade_level: quizzes[0].grade_level,
    class_code: input.classCode,
    opens_at: opensAt.toISOString(),
    closes_at: closesAt.toISOString(),
    feedback_at: null,
    dashboard_visible: true,
    attempt_limit: attemptLimitOf(input),
  };
  const authorized = await table<Array<{ id: number }>>(config, 'translation_audit_log?select=id', fetcher, [{
    actor_type: 'teacher', actor_id: actor, action: 'authorize-add-published-target',
    entity_type: 'translation_quiz', entity_id: `${input.quizId}:${input.quizVersion}:${input.classCode}`,
    before_data: null, after_data: next,
  }]);
  if (authorized.length !== 1) throw new DraftTargetError('發布授權紀錄未確認，尚未增加班級。', 503);
  // The unique quiz/version/year/class constraint prevents a concurrent request
  // from replacing an existing class target. No upsert is used here.
  const saved = await table<Array<{ id: string }>>(
    config, 'translation_quiz_targets?select=id', fetcher, [next]);
  if (saved.length !== 1) throw new DraftTargetError('新增班級結果未確認，請重新整理核對。', 503);
  try {
    await table(config, 'translation_audit_log?select=id', fetcher, [{
      actor_type: 'teacher', actor_id: actor, action: 'add-published-target',
      entity_type: 'translation_quiz_target', entity_id: saved[0].id,
      before_data: null, after_data: next,
    }]);
  } catch {
    throw new DraftTargetError('班級可能已加入，但完成紀錄失敗；請重新整理核對，勿重複提交。', 503);
  }
  return { classCode: input.classCode, opensAt: next.opens_at, closesAt: next.closes_at };
}

/** Reopen one finished class window for students who have not submitted. */
export async function reopenPublishedTarget(
  config: DataConfig,
  input: TargetInput,
  actor: string,
  fetcher: typeof fetch = fetch,
): Promise<{ classCode: string; opensAt: string; closesAt: string }> {
  if (!/^[A-Z0-9][A-Z0-9._:-]{1,127}$/i.test(input.quizId) ||
    !Number.isInteger(input.quizVersion) || input.quizVersion < 1 ||
    !gradeLevelForClass(input.classCode)) {
    throw new DraftTargetError('測驗或班級資料不正確。');
  }
  const opensAt = taipeiTime(input.opensAtLocal);
  const closesAt = taipeiTime(input.closesAtLocal);
  if (opensAt.getTime() < Date.now() + 120_000 || closesAt <= opensAt ||
    closesAt.getTime() - opensAt.getTime() > 90 * 86400_000) {
    throw new DraftTargetError('請設定至少兩分鐘後的補考開放時間，截止時間須較晚且相隔不超過 90 天。');
  }
  const filter = `quiz_id=eq.${encodeURIComponent(input.quizId)}&quiz_version=eq.${input.quizVersion}`;
  const quizzes = await table<Array<{ status: string; grade_level: number; score_mode: string; feedback_policy: string }>>(
    config, `translation_quizzes?${filter}&select=status,grade_level,score_mode,feedback_policy&limit=2`, fetcher);
  if (quizzes.length !== 1 || quizzes[0].status !== 'published' ||
    quizzes[0].grade_level !== gradeLevelForClass(input.classCode)) {
    throw new DraftTargetError('這份測驗不是該班可重新開放的已發布測驗。', 409);
  }
  if (quizzes[0].score_mode === 'formal' && quizzes[0].feedback_policy !== 'teacher-release') {
    throw new DraftTargetError('這份正式測驗的回饋政策不支援安全補考，請先聯絡管理者。', 409);
  }
  const targetFilter = `${filter}&school_year=eq.${config.schoolYear}&class_code=eq.${encodeURIComponent(input.classCode)}`;
  const previous = await table<Array<{ id: string; opens_at: string; closes_at: string; feedback_at: string | null; dashboard_visible: boolean; attempt_limit: number }>>(
    config, `translation_quiz_targets?${targetFilter}&select=id,opens_at,closes_at,feedback_at,dashboard_visible,attempt_limit&limit=2`, fetcher);
  if (previous.length !== 1 || !previous[0].dashboard_visible ||
    !Number.isFinite(Date.parse(previous[0].closes_at)) ||
    Date.now() < Date.parse(previous[0].closes_at)) {
    throw new DraftTargetError('只有已截止、已發布的該班時段可以重新開放；進行中的考試不會被覆寫。', 409);
  }
  if (previous[0].attempt_limit !== 1) {
    throw new DraftTargetError('此班設定允許重複作答，不能套用只供缺考學生使用的補考時段。', 409);
  }
  if (previous[0].feedback_at) {
    throw new DraftTargetError('此班已另行發布永久回饋，不能重新開放同一份正式測驗。', 409);
  }
  const released = await table<Array<{ id: number }>>(config,
    `translation_audit_log?select=id&entity_type=eq.translation_quiz&entity_id=eq.${encodeURIComponent(`${input.quizId}:${input.quizVersion}`)}&action=eq.release-translation-feedback&limit=1`, fetcher);
  if (released.length) throw new DraftTargetError('本測驗答案已永久發布，不能重新開放同一份考卷。', 409);
  const old = previous[0];
  if (input.retainFeedbackAfterClose !== undefined && typeof input.retainFeedbackAfterClose !== 'boolean') {
    throw new DraftTargetError('截止後回饋設定不正確。');
  }
  const next = { opens_at: opensAt.toISOString(), closes_at: closesAt.toISOString(),
    ...(input.retainFeedbackAfterClose ? { feedback_at: closesAt.toISOString() } : {}) };
  const authorization = await table<Array<{ id: number }>>(config, 'translation_audit_log?select=id', fetcher, [{
    actor_type: 'teacher', actor_id: actor, action: 'authorize-reopen-class-target',
    entity_type: 'translation_quiz_target', entity_id: old.id,
    before_data: old, after_data: { ...next, classCode: input.classCode, attemptLimitUnchanged: old.attempt_limit },
  }]);
  if (authorization.length !== 1) throw new DraftTargetError('補考授權紀錄未確認，尚未重新開放。', 503);
  const path = `translation_quiz_targets?id=eq.${encodeURIComponent(old.id)}&${targetFilter}` +
    `&opens_at=eq.${encodeURIComponent(old.opens_at)}&closes_at=eq.${encodeURIComponent(old.closes_at)}` +
    `&dashboard_visible=eq.true&select=id,opens_at,closes_at,feedback_at`;
  let response: Response;
  try {
    response = await fetcher(`${config.supabaseUrl}/rest/v1/${path}`, {
      method: 'PATCH', headers: {
        apikey: config.supabaseSecretKey, authorization: `Bearer ${config.supabaseSecretKey}`,
        accept: 'application/json', 'content-type': 'application/json', prefer: 'return=representation',
      },
      body: JSON.stringify(next), cache: 'no-store', signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new DraftTargetError('補考時段未確認儲存，請重新整理核對。', 503);
  }
  if (!response.ok) throw new DraftTargetError('後端未能更新補考時段，請重新整理核對。', 503);
  let saved: Array<{ id: string; opens_at: string; closes_at: string; feedback_at: string | null }>;
  try { saved = await response.json() as typeof saved; }
  catch { throw new DraftTargetError('補考時段回應異常，請重新整理核對。', 503); }
  if (saved.length !== 1 || saved[0].id !== old.id ||
    Date.parse(saved[0].opens_at) !== opensAt.getTime() ||
    Date.parse(saved[0].closes_at) !== closesAt.getTime() ||
    (input.retainFeedbackAfterClose && Date.parse(saved[0].feedback_at ?? '') !== closesAt.getTime())) {
    throw new DraftTargetError('補考時段可能已被其他操作改動；請重新整理核對。', 409);
  }
  try {
    const completed = await table<Array<{ id: number }>>(config, 'translation_audit_log?select=id', fetcher, [{
      actor_type: 'teacher', actor_id: actor, action: 'reopen-class-target',
      entity_type: 'translation_quiz_target', entity_id: old.id,
      before_data: old, after_data: { ...next, classCode: input.classCode, attemptLimitUnchanged: old.attempt_limit },
    }]);
    if (completed.length !== 1) throw new Error('AUDIT_NOT_CONFIRMED');
  } catch {
    throw new DraftTargetError('補考時段可能已重新開放，但稽核紀錄未確認；請先重新整理核對，勿重複提交。', 503);
  }
  return { classCode: input.classCode, opensAt: next.opens_at, closesAt: next.closes_at };
}

export type AdjustAction = 'open-now' | 'end-now' | 'reschedule' | 'attempt-limit';
export type AdjustInput = {
  quizId: string;
  quizVersion: number;
  classCode: string;
  action: AdjustAction;
  opensAtLocal?: string;
  closesAtLocal?: string;
  graceMinutes?: number;
  attemptLimit?: number;
};
export const maxTeacherAttemptLimit = 5;

/**
 * Teacher controls for one published class window that has not ended yet:
 * open now, end now (optional grace minutes), move the cutoff, or change the attempt limit.
 * Ended windows keep using reopenPublishedTarget so earlier submitters stay protected.
 */
export async function adjustPublishedTarget(
  config: DataConfig,
  input: AdjustInput,
  actor: string,
  fetcher: typeof fetch = fetch,
): Promise<{ classCode: string; opensAt: string; closesAt: string; attemptLimit: number }> {
  if (!/^[A-Z0-9][A-Z0-9._:-]{1,127}$/i.test(input.quizId) ||
    !Number.isInteger(input.quizVersion) || input.quizVersion < 1 ||
    !gradeLevelForClass(input.classCode) ||
    !['open-now', 'end-now', 'reschedule', 'attempt-limit'].includes(input.action)) {
    throw new DraftTargetError('測驗、班級或操作資料不正確。');
  }
  const filter = `quiz_id=eq.${encodeURIComponent(input.quizId)}&quiz_version=eq.${input.quizVersion}`;
  const quizzes = await table<Array<{ status: string; grade_level: number }>>(
    config, `translation_quizzes?${filter}&select=status,grade_level&limit=2`, fetcher);
  if (quizzes.length !== 1 || quizzes[0].status !== 'published' ||
    quizzes[0].grade_level !== gradeLevelForClass(input.classCode)) {
    throw new DraftTargetError('只有已發布測驗的班級時段可以調整。', 409);
  }
  const targetFilter = `${filter}&school_year=eq.${config.schoolYear}&class_code=eq.${encodeURIComponent(input.classCode)}`;
  const previous = await table<Array<{ id: string; opens_at: string; closes_at: string; feedback_at: string | null; dashboard_visible: boolean; attempt_limit: number }>>(
    config, `translation_quiz_targets?${targetFilter}&select=id,opens_at,closes_at,feedback_at,dashboard_visible,attempt_limit&limit=2`, fetcher);
  if (previous.length !== 1 || !previous[0].dashboard_visible) {
    throw new DraftTargetError('找不到這個班級已發布的時段，請重新整理核對。', 409);
  }
  const old = previous[0];
  const now = Date.now();
  const oldOpens = Date.parse(old.opens_at);
  const oldCloses = Date.parse(old.closes_at);
  if (!Number.isFinite(oldOpens) || !Number.isFinite(oldCloses) || now >= oldCloses) {
    throw new DraftTargetError(`${input.classCode} 班時段已截止，這裡不能再調整；請重新整理頁面，在該班下方展開「為 ${input.classCode} 班重新發布補考時段」。`, 409);
  }
  // Second precision keeps the stored value and the confirmation check identical.
  const nowSecond = Math.ceil(now / 1000) * 1000;
  const next: { opens_at?: string; closes_at?: string; feedback_at?: string; attempt_limit?: number } = {};
  if (input.action === 'open-now') {
    if (now >= oldOpens) throw new DraftTargetError('這個班級已經開放中。', 409);
    next.opens_at = new Date(nowSecond).toISOString();
  } else if (input.action === 'end-now') {
    if (now < oldOpens) throw new DraftTargetError('這個班級尚未開放；若要取消請改時段。', 409);
    const grace = input.graceMinutes ?? 0;
    if (!Number.isInteger(grace) || grace < 0 || grace > 30) {
      throw new DraftTargetError('緩衝時間須為 0 到 30 分鐘。');
    }
    const closesAt = Math.max(nowSecond + grace * 60_000, oldOpens + 1000);
    if (closesAt >= oldCloses) throw new DraftTargetError('新的結束時間沒有比原截止時間早，未變更。', 409);
    next.closes_at = new Date(closesAt).toISOString();
  } else if (input.action === 'reschedule') {
    const closesAt = taipeiTime(input.closesAtLocal ?? '').getTime();
    let opensAt = oldOpens;
    if (now < oldOpens && input.opensAtLocal) {
      opensAt = taipeiTime(input.opensAtLocal).getTime();
      if (opensAt < now + 60_000) throw new DraftTargetError('新的開放時間須至少一分鐘後；要馬上開放請按「立即開放」。');
    }
    if (closesAt < now + 60_000 || closesAt <= opensAt || closesAt - opensAt > 90 * 86400_000) {
      throw new DraftTargetError('截止時間須至少一分鐘後、晚於開放時間，且相隔不超過 90 天；要馬上結束請按「立即結束」。');
    }
    if (opensAt !== oldOpens) next.opens_at = new Date(opensAt).toISOString();
    if (closesAt !== oldCloses) next.closes_at = new Date(closesAt).toISOString();
    if (!next.opens_at && !next.closes_at) throw new DraftTargetError('時段沒有變更。', 409);
  } else {
    const limit = input.attemptLimit;
    if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > maxTeacherAttemptLimit) {
      throw new DraftTargetError(`作答次數須為 1 到 ${maxTeacherAttemptLimit} 次。`);
    }
    if (limit === old.attempt_limit) throw new DraftTargetError('作答次數沒有變更。', 409);
    next.attempt_limit = limit;
  }
  // Retained post-close feedback was scheduled at the old cutoff; keep it tied to the new cutoff.
  if (next.closes_at && old.feedback_at && Date.parse(old.feedback_at) === oldCloses) {
    next.feedback_at = next.closes_at;
  }
  const audit = { ...next, classCode: input.classCode, action: input.action,
    ...(input.action === 'end-now' ? { graceMinutes: input.graceMinutes ?? 0 } : {}) };
  const authorization = await table<Array<{ id: number }>>(config, 'translation_audit_log?select=id', fetcher, [{
    actor_type: 'teacher', actor_id: actor, action: 'authorize-adjust-class-target',
    entity_type: 'translation_quiz_target', entity_id: old.id, before_data: old, after_data: audit,
  }]);
  if (authorization.length !== 1) throw new DraftTargetError('調整授權紀錄未確認，時段未變更。', 503);
  const path = `translation_quiz_targets?id=eq.${encodeURIComponent(old.id)}&${targetFilter}` +
    `&opens_at=eq.${encodeURIComponent(old.opens_at)}&closes_at=eq.${encodeURIComponent(old.closes_at)}` +
    `&attempt_limit=eq.${old.attempt_limit}&dashboard_visible=eq.true&select=id,opens_at,closes_at,feedback_at,attempt_limit`;
  let response: Response;
  try {
    response = await fetcher(`${config.supabaseUrl}/rest/v1/${path}`, {
      method: 'PATCH', headers: {
        apikey: config.supabaseSecretKey, authorization: `Bearer ${config.supabaseSecretKey}`,
        accept: 'application/json', 'content-type': 'application/json', prefer: 'return=representation',
      },
      body: JSON.stringify(next), cache: 'no-store', signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new DraftTargetError('時段調整未確認儲存，請重新整理核對。', 503);
  }
  if (!response.ok) throw new DraftTargetError('後端未能調整時段，請重新整理核對。', 503);
  let saved: Array<{ id: string; opens_at: string; closes_at: string; feedback_at: string | null; attempt_limit: number }>;
  try { saved = await response.json() as typeof saved; }
  catch { throw new DraftTargetError('時段調整回應異常，請重新整理核對。', 503); }
  const row = saved[0];
  if (saved.length !== 1 || row.id !== old.id ||
    (next.opens_at && Date.parse(row.opens_at) !== Date.parse(next.opens_at)) ||
    (next.closes_at && Date.parse(row.closes_at) !== Date.parse(next.closes_at)) ||
    (next.attempt_limit && row.attempt_limit !== next.attempt_limit)) {
    throw new DraftTargetError('時段可能已被其他操作改動；請重新整理核對。', 409);
  }
  try {
    const completed = await table<Array<{ id: number }>>(config, 'translation_audit_log?select=id', fetcher, [{
      actor_type: 'teacher', actor_id: actor, action: 'adjust-class-target',
      entity_type: 'translation_quiz_target', entity_id: old.id, before_data: old, after_data: audit,
    }]);
    if (completed.length !== 1) throw new Error('AUDIT_NOT_CONFIRMED');
  } catch {
    throw new DraftTargetError('時段可能已調整，但稽核紀錄未確認；請先重新整理核對，勿重複提交。', 503);
  }
  return { classCode: input.classCode, opensAt: row.opens_at, closesAt: row.closes_at, attemptLimit: row.attempt_limit };
}

function taipeiTime(value: string): Date {
  if (!/^20\d{2}-(0[1-9]|1[0-2])-([0-2]\d|3[01])T([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new DraftTargetError('請輸入學校時區的日期與分鐘。');
  }
  const date = fromSchoolLocal(value);
  if (!date) throw new DraftTargetError('日期不存在，請重新選擇。');
  return date;
}

async function table<T>(config: DataConfig, path: string, fetcher: typeof fetch,
  body?: unknown, prefer = 'return=representation'): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(`${config.supabaseUrl}/rest/v1/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        apikey: config.supabaseSecretKey,
        authorization: `Bearer ${config.supabaseSecretKey}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json', prefer }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: 'no-store', signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new DraftTargetError('目前無法連線到後端，請稍後再試。', 503);
  }
  if (!response.ok) throw new DraftTargetError(`後端時段操作失敗（HTTP ${response.status}）。`, response.status >= 500 ? 503 : 409);
  try {
    return await response.json() as T;
  } catch {
    throw new DraftTargetError('後端回應格式異常，請重新整理核對。', 503);
  }
}
