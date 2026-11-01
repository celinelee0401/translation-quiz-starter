import { getAiConfig } from './ai-provider.ts';
import { getDataConfig, getSessionSecret, getStudentLoginMode } from './config.ts';
import { RequestInputError } from './http.ts';
import { constantTimeEqual, sha256Hex } from './security.ts';
import { hashTeacherCode } from './teacher-auth.ts';
import { getSchoolSettings } from '../school-settings.ts';

export type CheckState = 'ok' | 'todo' | 'error';
export type SetupCheck = { key: string; title: string; state: CheckState; detail: string };

type Env = Record<string, string | undefined>;

/**
 * Plain-language checklist for /setup. It never returns secret values, only
 * whether each piece is present and working, plus the next step to take.
 */
export async function loadSetupChecks(env: Env = process.env, fetcher: typeof fetch = fetch): Promise<SetupCheck[]> {
  const checks: SetupCheck[] = [];
  const school = getSchoolSettings(env);
  const schoolYear = env.SCHOOL_YEAR?.trim() ?? '';
  checks.push({
    key: 'school', title: '學校設定',
    state: school.errors.length || !/^\d{3,4}$/.test(schoolYear) || !school.classes.length ? 'error' : 'ok',
    detail: school.errors.length ? school.errors.join(' ') :
      !/^\d{3,4}$/.test(schoolYear) ? 'SCHOOL_YEAR 要填 3–4 位數字的學年，例如 115。' :
      `${school.schoolName}｜${schoolYear} 學年｜${school.classes.map((item) => `${item.code}（${item.grade} 年級）`).join('、')}｜時區 ${school.timeZone}`,
  });

  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SECRET_KEY?.trim();
  const sampleName = isSampleValue(url) ? 'SUPABASE_URL' : isSampleValue(key) ? 'SUPABASE_SECRET_KEY' : '';
  let validUrl = false;
  try { validUrl = Boolean(url && new URL(url).protocol === 'https:'); } catch { validUrl = false; }
  if (sampleName) {
    checks.push({ key: 'database', title: '連線 Supabase 資料庫', state: 'error',
      detail: `${sampleName} 還是範本的示範文字。請到 Cloudflare 把它換成你自己的值（部署表單上的點點不代表已經填好）。` });
  } else if (!validUrl || !key) {
    checks.push({ key: 'database', title: '連線 Supabase 資料庫', state: 'todo',
      detail: !validUrl ? '還沒填 SUPABASE_URL（Supabase 的 Project URL，https:// 開頭）。' : '還沒填 SUPABASE_SECRET_KEY（Supabase 的 secret key，sb_secret_ 開頭）。' });
  } else if (!getSessionSecret(env)) {
    checks.push({ key: 'database', title: '連線 Supabase 資料庫', state: 'error',
      detail: 'SUPABASE_SECRET_KEY 看起來不完整，請重新複製整串 secret key。' });
  } else {
    const probe = await probeDatabase(url!.replace(/\/$/, ''), key, fetcher);
    checks.push(probe.connection);
    if (probe.connection.state === 'ok') {
      checks.push({ key: 'teacher-code', title: '設定教師通行碼', state: probe.hasTeacherCode ? 'ok' : 'todo',
        detail: probe.hasTeacherCode ? '已設定。忘記時可在本頁用設定碼重設。' : '用下方表單設定，之後用它登入教師工作區。' });
      checks.push({ key: 'roster', title: '匯入學生名冊', state: probe.hasStudents ? 'ok' : 'todo',
        detail: probe.hasStudents ? '名冊已有學生。' : '登入教師工作區後，到「學生名冊與 PIN」貼上班級與座號。' });
    }
  }

  const setupCode = env.SETUP_CODE?.trim() ?? '';
  checks.push(isSampleValue(setupCode)
    ? { key: 'setup-code', title: '設定碼（SETUP_CODE）', state: 'error',
        detail: 'SETUP_CODE 還是範本的示範文字，任何人都查得到。請到 Cloudflare 換成你自己想的密語。' }
    : { key: 'setup-code', title: '設定碼（SETUP_CODE）', state: setupCode.length >= 8 ? 'ok' : 'todo',
        detail: setupCode.length >= 8 ? '已設定。設定或重設教師通行碼時需要輸入。' : '請在 Cloudflare 的變數設定加入 SETUP_CODE（自己想一組至少 8 個字元的密語）。' });
  const ai = getAiConfig();
  checks.push({ key: 'ai', title: 'AI 批改建議（可不開）', state: 'ok',
    detail: ai ? `已開啟（OpenAI，模型 ${ai.model}）。` : '未開啟：系統用固定規則＋老師批改。要開啟請設定 AI_PROVIDER=openai 與 OPENAI_API_KEY。' });
  checks.push({ key: 'login-mode', title: '學生登入方式', state: 'ok',
    detail: getStudentLoginMode() === 'pin' ? '班級＋座號＋PIN。' : '班級＋座號（練習用，任何人都能用別人的座號）。' });
  return checks;
}

// Sample values that older copies of .dev.vars.example put into the deploy form.
// They are public, so a site still using them must not count as configured.
const SAMPLE_VALUES = new Set(['https://your-project.supabase.co', 'sb_secret_replace_me', 'replace-with-your-own-phrase']);

export function isSampleValue(value: string | undefined): boolean {
  return SAMPLE_VALUES.has(value?.trim() ?? '');
}

async function probeDatabase(url: string, key: string, fetcher: typeof fetch) {
  const headers = { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' };
  const get = (path: string) => fetcher(`${url}/rest/v1/${path}`, { headers, cache: 'no-store', signal: AbortSignal.timeout(8_000) });
  let teacher: Response;
  try {
    teacher = await get('teacher_access_settings?select=updated_at&limit=1');
  } catch {
    return { connection: { key: 'database', title: '連線 Supabase 資料庫', state: 'error' as const,
      detail: '連不到 SUPABASE_URL。請確認網址正確、Supabase 專案沒有被暫停（免費專案一週沒使用會暫停，到 Supabase 按 Restore）。' }, hasTeacherCode: false, hasStudents: false };
  }
  if (teacher.status === 401 || teacher.status === 403) {
    return { connection: { key: 'database', title: '連線 Supabase 資料庫', state: 'error' as const,
      detail: 'Supabase 拒絕連線：SUPABASE_SECRET_KEY 不正確。請到 Project Settings → API Keys 重新複製 secret key（不是 publishable key）。' }, hasTeacherCode: false, hasStudents: false };
  }
  if (teacher.status === 404) {
    return { connection: { key: 'database', title: '建立資料表', state: 'todo' as const,
      detail: '已連上 Supabase，但還沒建立資料表。請到 Supabase 的 SQL Editor 貼上 supabase/setup.sql 整個檔案並按 Run。' }, hasTeacherCode: false, hasStudents: false };
  }
  if (!teacher.ok) {
    return { connection: { key: 'database', title: '連線 Supabase 資料庫', state: 'error' as const,
      detail: `Supabase 回應異常（HTTP ${teacher.status}），請稍後重新整理。` }, hasTeacherCode: false, hasStudents: false };
  }
  const rows = await teacher.json().catch(() => []) as unknown[];
  const students = await get('enrollments?select=id&active=is.true&limit=1').catch(() => null);
  const studentRows = students?.ok ? await students.json().catch(() => []) as unknown[] : [];
  return { connection: { key: 'database', title: '連線 Supabase 資料庫與資料表', state: 'ok' as const, detail: '已連線，資料表已建立。' },
    hasTeacherCode: rows.length > 0, hasStudents: studentRows.length > 0 };
}

/**
 * Sets or resets the teacher access code. The caller proves they own the
 * deployment with SETUP_CODE, which only the person who deployed it knows.
 */
export async function setTeacherCode(
  input: { setupCode: unknown; teacherCode: unknown },
  env: Env = process.env,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const expected = env.SETUP_CODE?.trim() ?? '';
  if (expected.length < 8) throw new RequestInputError('這個網站還沒設定 SETUP_CODE，請先到 Cloudflare 加入這個變數。', 409);
  if (isSampleValue(expected)) throw new RequestInputError('SETUP_CODE 還是範本的示範文字，請先到 Cloudflare 換成你自己想的密語。', 409);
  const config = getDataConfig();
  if (!config) throw new RequestInputError('資料庫設定尚未完成，請先完成上方檢查項目。', 409);
  const setupCode = typeof input.setupCode === 'string' ? input.setupCode.trim() : '';
  // Compare fixed-length digests so the check takes the same time for any input.
  if (!constantTimeEqual(await sha256Hex(setupCode), await sha256Hex(expected))) {
    // Slow down guessing; each request already costs a round trip.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    throw new RequestInputError('設定碼不正確。', 403);
  }
  const teacherCode = typeof input.teacherCode === 'string' ? input.teacherCode.trim() : '';
  if (teacherCode.length < 8 || teacherCode.length > 64) throw new RequestInputError('教師通行碼需為 8–64 個字元。');
  if (teacherCode === expected) throw new RequestInputError('教師通行碼不要和設定碼相同。');

  const headers = {
    apikey: config.supabaseSecretKey, authorization: `Bearer ${config.supabaseSecretKey}`,
    'content-type': 'application/json',
  };
  const saved = await fetcher(`${config.supabaseUrl}/rest/v1/teacher_access_settings?on_conflict=id`, {
    method: 'POST',
    headers: { ...headers, prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ id: true, access_code_hash: await hashTeacherCode(teacherCode), updated_at: new Date().toISOString() }]),
    cache: 'no-store', signal: AbortSignal.timeout(10_000),
  });
  if (!saved.ok) throw new Error(`Teacher code not saved: ${saved.status}`);
  await fetcher(`${config.supabaseUrl}/rest/v1/translation_audit_log`, {
    method: 'POST', headers: { ...headers, prefer: 'return=minimal' },
    body: JSON.stringify([{ actor_type: 'teacher', actor_id: 'setup', action: 'set-teacher-code',
      entity_type: 'teacher-access', entity_id: 'teacher', after_data: { changed: true } }]),
    cache: 'no-store', signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}
