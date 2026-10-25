import { getDataConfig } from '@/lib/server/config';
import { requireTeacher, TeacherAccessError } from '@/lib/server/teacher-auth';
import { loadTeacherOverview } from '@/lib/server/teacher-overview';
import { gradesToColumnCsv, gradesToCsv, loadFinalGrades } from '@/lib/server/grade-export';
import { json } from '@/lib/server/http';
import { classCodePattern } from '@/lib/public-quiz-data';

export async function GET(request: Request): Promise<Response> {
  try {
    await requireTeacher(request);
    const config = getDataConfig();
    if (!config) return json({ error: '後端設定尚未完成。' }, 503);
    const url = new URL(request.url);
    const quizId = url.searchParams.get('quiz') ?? '';
    const version = Number(url.searchParams.get('version'));
    const classCode = url.searchParams.get('class') ?? '';
    if (!/^[A-Z0-9][A-Z0-9._:-]{1,127}$/i.test(quizId) || !Number.isInteger(version) || version < 1 ||
      (classCode && !classCodePattern.test(classCode))) return json({ error: '請選擇有效測驗與班級。' }, 400);
    const quizzes = await loadTeacherOverview(config);
    const quiz = quizzes.find(item => item.quizId === quizId && item.version === version);
    if (!quiz || (classCode && !quiz.targets.some(target => target.classCode === classCode)))
      return json({ error: '找不到這份測驗或指定班級。' }, 404);
    const rows = (await loadFinalGrades(config, quiz)).filter(row => !classCode || row.classCode === classCode);
    const column = url.searchParams.get('format') === 'column';
    if (column && !classCode) return json({ error: '貼表格格式需指定單一班級。' }, 400);
    const filename = `${quizId}-v${version}${classCode ? `-${classCode}` : ''}-${column ? 'paste' : 'grades'}.csv`;
    return new Response(column ? gradesToColumnCsv(rows) : gradesToCsv(rows), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof TeacherAccessError) return json({ error: error.message }, 401);
    return json({ error: '目前無法確認成績資料完整性，請稍後再試。' }, 503);
  }
}
