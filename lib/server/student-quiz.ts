import type { DataConfig } from './config.ts';

export type StudentQuiz = {
  id: string;
  version: number;
  title: string;
  scoreMode: 'practice' | 'formal';
  questions: Array<{ id: string; prompt: string }>;
};

type QuizRow = {
  quiz_id: string;
  quiz_version: number;
  title: string;
  score_mode: StudentQuiz['scoreMode'];
  grade_level: number;
  status: string;
};
type QuestionRow = {
  question_key: string;
  prompt_zh: string;
  display_order: number;
};

/** Call only after start_translation_attempt has authorized this student and time. */
export async function loadStudentQuiz(
  config: DataConfig,
  quizId: string,
  version: number,
  gradeLevel: number,
  fetcher: typeof fetch = fetch,
): Promise<StudentQuiz> {
  const key = encodeURIComponent(quizId);
  const [quizRows, questionRows] = await Promise.all([
    readRows<QuizRow[]>(config,
      `translation_quizzes?select=quiz_id,quiz_version,title,score_mode,grade_level,status&quiz_id=eq.${key}&quiz_version=eq.${version}&limit=2`, fetcher),
    readRows<QuestionRow[]>(config,
      `translation_questions?select=question_key,prompt_zh,display_order&quiz_id=eq.${key}&quiz_version=eq.${version}&order=display_order.asc&limit=101`, fetcher),
  ]);
  if (quizRows.length !== 1 || quizRows[0].status !== 'published' || quizRows[0].grade_level !== gradeLevel ||
      quizRows[0].quiz_id !== quizId || quizRows[0].quiz_version !== version ||
      questionRows.length < 1 || questionRows.length > 100 ||
      questionRows.some((row) => !row.question_key || !row.prompt_zh)) {
    throw new Error('STUDENT_QUIZ_UNAVAILABLE');
  }
  const quiz = quizRows[0];
  return {
    id: quiz.quiz_id,
    version: quiz.quiz_version,
    title: quiz.title,
    scoreMode: quiz.score_mode,
    questions: questionRows.map((row) => ({ id: row.question_key, prompt: row.prompt_zh })),
  };
}

async function readRows<T>(config: DataConfig, path: string, fetcher: typeof fetch): Promise<T> {
  const response = await fetcher(`${config.supabaseUrl}/rest/v1/${path}`, {
    headers: {
      apikey: config.supabaseSecretKey,
      authorization: `Bearer ${config.supabaseSecretKey}`,
      accept: 'application/json',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('STUDENT_QUIZ_UNAVAILABLE');
  return await response.json() as T;
}
