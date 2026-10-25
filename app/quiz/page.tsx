import { StudentQuizPreview } from '@/components/student-quiz-preview';
import { headers } from 'next/headers';
import { isTeacherAuthenticated } from '@/lib/server/teacher-auth';
import { publicQuizMeta, publicQuizQuestions } from '@/lib/public-quiz-data';
import { getDataConfig, getStudentLoginMode } from '@/lib/server/config';
import { loadTeacherOverview } from '@/lib/server/teacher-overview';

export const dynamic = 'force-dynamic';

export default async function QuizPage({ searchParams }: {
  searchParams: Promise<{ quiz?: string; version?: string; preview?: string }>;
}) {
  const params = await searchParams;
  const allowPreview = await isTeacherAuthenticated(new Request('https://translation.local/', { headers: await headers() }));
  const requestedVersion = params.version ?? '1';
  const quizVersion = /^[1-9]\d*$/.test(requestedVersion) ? Number(requestedVersion) : NaN;
  const quizId = typeof params.quiz === 'string' && /^[A-Z0-9][A-Z0-9._:-]{1,127}$/i.test(params.quiz) &&
    Number.isSafeInteger(quizVersion) ? params.quiz : null;
  const formalPreview = allowPreview && params.preview === '1' && quizId ?
    (await (async () => {
      const config = getDataConfig();
      if (!config) return null;
      try {
        const quizzes = await loadTeacherOverview(config);
        const quiz = quizzes.find((item) => item.quizId === quizId && item.version === quizVersion);
        return quiz ? {
          id: quiz.quizId,
          version: quiz.version,
          title: quiz.title,
          scoreMode: quiz.scoreMode,
          questions: quiz.questions.map((question) => ({ id: question.id, prompt: question.prompt })),
        } : null;
      } catch {
        return null;
      }
    })()) : null;
  const practicePreview = allowPreview && params.preview === '1' && !quizId ? {
    id: publicQuizMeta.id,
    version: publicQuizMeta.version,
    title: publicQuizMeta.title,
    scoreMode: 'practice' as const,
    questions: [...publicQuizQuestions],
  } : null;
  const previewQuiz = formalPreview ?? practicePreview;
  if (allowPreview && params.preview === '1' && quizId && !formalPreview) {
    return <main className="mx-auto max-w-xl px-5 py-16">
      <h1 className="font-heading text-2xl font-black">目前無法載入這份測驗的預覽</h1>
      <p className="mt-4 leading-7">請返回教師工作區，確認草稿仍存在後再試一次。學生作答狀態未變更。</p>
    </main>;
  }
  return (
    <StudentQuizPreview
      previewQuiz={previewQuiz}
      quizId={previewQuiz ? null : quizId}
      quizVersion={Number.isSafeInteger(quizVersion) ? quizVersion : 1}
      autoPreview={Boolean(formalPreview)}
      loginMode={getStudentLoginMode()}
    />
  );
}
