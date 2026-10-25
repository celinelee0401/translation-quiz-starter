import { getDataConfig, type DataConfig } from '@/lib/server/config';
import { json } from '@/lib/server/http';
import { gradeLevelForClass, isSupportedGrade } from '@/lib/public-quiz-data';

type Target = { quiz_id: string; quiz_version: number; class_code: string; opens_at: string; closes_at: string };
type Quiz = { quiz_id: string; quiz_version: number; title: string; grade_level: number; status: string };

async function read<T>(config: DataConfig, path: string): Promise<T[]> {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    headers: { apikey: config.supabaseSecretKey, authorization: `Bearer ${config.supabaseSecretKey}` },
    cache: 'no-store', signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('Feed unavailable');
  return await response.json() as T[];
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const classCode = url.searchParams.get('class');
  const grade = Number(url.searchParams.get('grade'));
  if (!classCode || gradeLevelForClass(classCode) !== grade || !isSupportedGrade(grade))
    return json({ status: 'error', error: '班級資料不正確。' }, 400);
  const config = getDataConfig();
  if (!config) return json({ status: 'error', error: '測驗公告暫不可用。' }, 503);
  const now = new Date().toISOString();
  const targetsQuery = new URLSearchParams({
    select: 'quiz_id,quiz_version,class_code,opens_at,closes_at',
    school_year: `eq.${config.schoolYear}`, grade_level: `eq.${grade}`,
    class_code: `eq.${classCode}`, dashboard_visible: 'eq.true',
    opens_at: `lte.${now}`, closes_at: `gt.${now}`,
    order: 'closes_at.asc', limit: '50',
  });
  const quizzesQuery = new URLSearchParams({
    select: 'quiz_id,quiz_version,title,grade_level,status',
    grade_level: `eq.${grade}`, status: 'eq.published', limit: '100',
  });
  try {
    const [targets, quizzes] = await Promise.all([
      read<Target>(config, `translation_quiz_targets?${targetsQuery}`),
      read<Quiz>(config, `translation_quizzes?${quizzesQuery}`),
    ]);
    if (targets.length === 50 || quizzes.length === 100) throw new Error('Feed pagination required');
    const titles = new Map(quizzes.map(item => [`${item.quiz_id}:${item.quiz_version}`, item.title]));
    const items = targets.flatMap(target => {
      const title = titles.get(`${target.quiz_id}:${target.quiz_version}`);
      return title ? [{
        quizId: target.quiz_id, version: target.quiz_version, title,
        classCode: target.class_code, opensAt: target.opens_at, closesAt: target.closes_at,
        url: `/quiz?quiz=${encodeURIComponent(target.quiz_id)}&version=${target.quiz_version}`,
      }] : [];
    });
    return json({ status: 'ok', items });
  } catch {
    return json({ status: 'error', error: '測驗公告暫不可用。' }, 503);
  }
}
