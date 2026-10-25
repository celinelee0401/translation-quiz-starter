import type { TeacherQuiz } from './server/teacher-overview.ts';

export const genericRubricVersion = 'teacher-reviewed-v1';

/** A changed question or scoring unit invalidates the teacher's approval. */
export function genericRubricFingerprint(quiz: Pick<TeacherQuiz, 'quizId' | 'version'> & {
  questions: Array<Pick<TeacherQuiz['questions'][number], 'key' | 'answer' | 'points' | 'rubric'>>;
}): string {
  return JSON.stringify({ quizId: quiz.quizId, version: quiz.version,
    questions: quiz.questions.map(question => ({ key: question.key, answer: question.answer,
      points: question.points, rubric: question.rubric.map(unit => ({
        label: unit.label, requirement: unit.requirement, points: unit.points,
      })) })) });
}
