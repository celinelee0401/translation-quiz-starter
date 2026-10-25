import {
  classCodePattern,
  classCodesForGrade as codesForGrade,
  classCodesForQuizId as codesForQuizId,
  getSchoolSettings,
  gradeLevelForClass as gradeForClass,
  isSupportedGrade as supportedGrade,
  type SchoolSettings,
} from './school-settings.ts';

export { classCodePattern };

export const publicQuizMeta = {
  id: 'G8-DEMO-SCHOOL-DAY-01',
  title: 'G8 示範｜校園生活句子翻譯 01',
  version: 1,
  grade: 'G8' as const,
  unit: '示範單元 School Day',
  maxScore: 90,
};

// Only prompts and stable question keys may be imported by the student bundle.
export const publicQuizQuestions = [
  { id: 'Q1', prompt: 'Mia，你今天早上幾點到學校？' },
  { id: 'Q2', prompt: '我七點半和我哥哥一起到學校。' },
  { id: 'Q3', prompt: '你的第一堂課是什麼？' },
  { id: 'Q4', prompt: '第一堂是數學，但是我忘了帶課本。' },
  { id: 'Q5', prompt: '真糟糕！' },
] as const;

// Server-side shortcuts that read the current deployment settings. Client
// components use the same helpers from school-settings.ts with useSchoolSettings().
export function isSupportedClassCode(classCode: string, settings: SchoolSettings = getSchoolSettings()): boolean {
  return settings.classes.some((item) => item.code === classCode);
}

export function gradeLevelForClass(classCode: string, settings: SchoolSettings = getSchoolSettings()): number | null {
  return gradeForClass(settings, classCode);
}

export function isSupportedGrade(grade: unknown, settings: SchoolSettings = getSchoolSettings()): grade is number {
  return supportedGrade(settings, grade);
}

export function classCodesForGrade(grade: number, settings: SchoolSettings = getSchoolSettings()): string[] {
  return codesForGrade(settings, grade);
}

export function classCodesForQuizId(quizId: string | null, settings: SchoolSettings = getSchoolSettings()): string[] {
  return codesForQuizId(settings, quizId);
}
