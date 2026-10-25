import { schoolConfig } from '../school.config.ts';

export type Grade = `G${number}`;

export const publicQuizMeta = {
  id: 'G8-DEMO-SCHOOL-DAY-01',
  title: 'G8 示範｜校園生活句子翻譯 01',
  version: 1,
  grade: 'G8' as const,
  unit: '示範單元 School Day',
  maxScore: 90,
};

export const publicClassCatalog: Record<Grade, string[]> = Object.fromEntries(
  [...new Set(schoolConfig.classes.map((item) => item.grade))].map((grade) => [
    `G${grade}`,
    schoolConfig.classes.filter((item) => item.grade === grade).map((item) => item.code),
  ]),
);

export const gradeLevels: number[] = [...new Set(schoolConfig.classes.map((item) => item.grade))].sort((a, b) => a - b);

// Only prompts and stable question keys may be imported by the student bundle.
export const publicQuizQuestions = [
  { id: 'Q1', prompt: 'Mia，你今天早上幾點到學校？' },
  { id: 'Q2', prompt: '我七點半和我哥哥一起到學校。' },
  { id: 'Q3', prompt: '你的第一堂課是什麼？' },
  { id: 'Q4', prompt: '第一堂是數學，但是我忘了帶課本。' },
  { id: 'Q5', prompt: '真糟糕！' },
] as const;

// Class codes may use letters, digits and hyphens (see school.config.ts).
export const classCodePattern = /^[A-Za-z0-9-]{1,16}$/;

export function isSupportedGrade(grade: unknown): grade is number {
  return typeof grade === 'number' && gradeLevels.includes(grade);
}

export function isSupportedClassCode(classCode: string): boolean {
  return schoolConfig.classes.some((item) => item.code === classCode);
}

export function gradeLevelForClass(classCode: string): number | null {
  return schoolConfig.classes.find((item) => item.code === classCode)?.grade ?? null;
}

export function classCodesForGrade(grade: number): string[] {
  return schoolConfig.classes.filter((item) => item.grade === grade).map((item) => item.code);
}

// Quiz IDs are only a UI hint. The server still verifies the student's actual
// class, the quiz target and its open window before allowing an attempt.
export function classCodesForQuizId(quizId: string | null): string[] {
  const grade = /(?:^|-)G(\d{1,2})(?:-|$)/i.exec(quizId ?? '')?.[1];
  const classes = grade ? classCodesForGrade(Number(grade)) : [];
  return classes.length ? classes : schoolConfig.classes.map((item) => item.code);
}
