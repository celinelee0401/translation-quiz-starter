import type { TeacherQuiz } from './server/teacher-overview.ts';

/** Exact snapshot of the teacher-confirmed questions, answers and point totals. */
export function quizContentFingerprint(quiz: Pick<TeacherQuiz, 'quizId' | 'version' | 'questions'>): string {
  return JSON.stringify({
    quizId: quiz.quizId,
    version: quiz.version,
    questions: quiz.questions.map((question) => ({
      key: question.key,
      prompt: question.prompt,
      answer: question.answer,
      points: question.points,
    })),
  });
}
