import type { DataConfig } from './config.ts';
import type { TeacherQuiz } from './teacher-overview.ts';

type Attempt = { id: string; enrollment_id: string; final_score: number; server_submit_time: string };
type Enrollment = { id: string; class_code: string; seat_number: number };

export async function loadFinalGrades(config: DataConfig, quiz: TeacherQuiz, fetcher: typeof fetch = fetch) {
  const attempts: Attempt[] = [];
  for (let offset = 0; offset < 20000; offset += 500) {
    const rows = await read<Attempt[]>(config,
      `translation_attempts?select=id,enrollment_id,final_score,server_submit_time&quiz_id=eq.${encodeURIComponent(quiz.quizId)}&quiz_version=eq.${quiz.version}&status=eq.finalized&order=server_submit_time.asc&limit=500&offset=${offset}`, fetcher);
    attempts.push(...rows);
    if (rows.length < 500) break;
    if (offset === 19500) throw new Error('成績筆數超過匯出上限，請分批處理。');
  }
  const enrollmentIds = [...new Set(attempts.map(row => row.enrollment_id))];
  const enrollments: Enrollment[] = [];
  for (let index = 0; index < enrollmentIds.length; index += 200) {
    enrollments.push(...await read<Enrollment[]>(config,
      `enrollments?select=id,class_code,seat_number&id=in.(${enrollmentIds.slice(index, index + 200).join(',')})&limit=201`, fetcher));
  }
  if (enrollments.length !== enrollmentIds.length) throw new Error('學生座號資料不完整，停止匯出。');
  const byId = new Map(enrollments.map(row => [row.id, row]));
  const maxScore = quiz.questions.reduce((sum, question) => sum + question.points, 0);
  return attempts.map(attempt => {
    const enrollment = byId.get(attempt.enrollment_id);
    if (!enrollment || !Number.isFinite(Number(attempt.final_score))) throw new Error('成績資料不完整，停止匯出。');
    return {
      schoolYear: config.schoolYear, classCode: enrollment.class_code,
      seatNumber: enrollment.seat_number, quizId: quiz.quizId, quizTitle: quiz.title,
      quizVersion: quiz.version, attemptId: attempt.id, submittedAt: attempt.server_submit_time,
      finalScore: Number(attempt.final_score), maxScore,
    };
  }).sort((left, right) => left.classCode.localeCompare(right.classCode) || left.seatNumber - right.seatNumber);
}

export function gradesToCsv(rows: Awaited<ReturnType<typeof loadFinalGrades>>): string {
  const header = ['學年', '班級', '座號', '測驗名稱', '測驗代碼', '版本', '定稿分數', '滿分', '提交時間', '作答紀錄 ID'];
  const safe = (value: string | number) => {
    let text = String(value);
    if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return '\uFEFF' + [header, ...rows.map(row => [row.schoolYear, row.classCode, row.seatNumber,
    row.quizTitle, row.quizId, row.quizVersion, row.finalScore, row.maxScore,
    row.submittedAt, row.attemptId])].map(line => line.map(safe).join(',')).join('\r\n') + '\r\n';
}

/** 貼進平時成績表用：只有「座號、分數」兩欄，座號 1..最大座號連續列出，沒有定稿成績的留空白（不是 0 分）。 */
export function gradesToColumnCsv(rows: Awaited<ReturnType<typeof loadFinalGrades>>): string {
  const bySeat = new Map<number, number>();
  for (const row of rows) bySeat.set(row.seatNumber, row.finalScore);
  const maxSeat = Math.max(0, ...bySeat.keys());
  const lines = [['座號', '分數']];
  for (let seat = 1; seat <= maxSeat; seat++) lines.push([String(seat), bySeat.has(seat) ? String(bySeat.get(seat)) : '']);
  return '\uFEFF' + lines.map(line => line.join(',')).join('\r\n') + '\r\n';
}

async function read<T>(config: DataConfig, path: string, fetcher: typeof fetch): Promise<T> {
  const response = await fetcher(`${config.supabaseUrl}/rest/v1/${path}`, {
    headers: { apikey: config.supabaseSecretKey, authorization: `Bearer ${config.supabaseSecretKey}`, accept: 'application/json' },
    cache: 'no-store', signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`成績讀取失敗（${response.status}）。`);
  return await response.json() as T;
}
