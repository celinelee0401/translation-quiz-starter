import { schoolConfig } from '../school.config.ts';

export type SchoolClass = { code: string; grade: number };
export type SchoolSettings = {
  schoolName: string;
  timeZone: string;
  classes: SchoolClass[];
  /** Set when a deployment variable could not be read; shown on /setup. */
  errors: string[];
};

// Class codes may use letters, digits and hyphens.
export const classCodePattern = /^[A-Za-z0-9-]{1,16}$/;

/**
 * Parses SCHOOL_CLASSES such as `801:8, 802:8, 901:9` (班級代碼:年級).
 * Full-width punctuation is accepted because teachers often type it.
 */
export function parseSchoolClasses(value: string): { classes: SchoolClass[]; error: string | null } {
  const items = value.replace(/[，、；;]/g, ',').replace(/：/g, ':').split(',').map((item) => item.trim()).filter(Boolean);
  const classes: SchoolClass[] = [];
  for (const item of items) {
    const [code = '', grade = ''] = item.split(':').map((part) => part.trim());
    const level = Number(grade);
    if (!classCodePattern.test(code) || !Number.isInteger(level) || level < 1 || level > 12) {
      return { classes: [], error: `SCHOOL_CLASSES 的「${item}」格式不正確，應寫成「班級:年級」，例如 801:8。` };
    }
    if (classes.some((existing) => existing.code === code)) {
      return { classes: [], error: `SCHOOL_CLASSES 的班級 ${code} 重複。` };
    }
    classes.push({ code, grade: level });
  }
  if (!classes.length) return { classes: [], error: 'SCHOOL_CLASSES 沒有任何班級。' };
  return { classes, error: null };
}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Server-side: deployment variables (SCHOOL_NAME, SCHOOL_CLASSES, SCHOOL_TIMEZONE)
 * override school.config.ts. Read on every call so changed variables apply
 * after a redeploy without code edits. Client components get the result from
 * <SchoolSettingsProvider>, never from process.env.
 */
export function getSchoolSettings(env: Record<string, string | undefined> = serverEnv()): SchoolSettings {
  const errors: string[] = [];
  let classes: SchoolClass[] = schoolConfig.classes.map((item) => ({ ...item }));
  if (env.SCHOOL_CLASSES?.trim()) {
    const parsed = parseSchoolClasses(env.SCHOOL_CLASSES);
    classes = parsed.classes;
    if (parsed.error) errors.push(parsed.error);
  }
  let timeZone: string = schoolConfig.timeZone;
  if (env.SCHOOL_TIMEZONE?.trim()) {
    if (isValidTimeZone(env.SCHOOL_TIMEZONE.trim())) timeZone = env.SCHOOL_TIMEZONE.trim();
    else errors.push(`SCHOOL_TIMEZONE「${env.SCHOOL_TIMEZONE}」不是有效的時區，暫用 ${timeZone}。`);
  }
  const schoolName = env.SCHOOL_NAME?.trim().slice(0, 60) || schoolConfig.schoolName;
  return { schoolName, timeZone, classes, errors };
}

function serverEnv(): Record<string, string | undefined> {
  return typeof process === 'undefined' ? {} : process.env;
}

export function gradeLevelsOf(settings: SchoolSettings): number[] {
  return [...new Set(settings.classes.map((item) => item.grade))].sort((a, b) => a - b);
}

export function classCodesForGrade(settings: SchoolSettings, grade: number): string[] {
  return settings.classes.filter((item) => item.grade === grade).map((item) => item.code);
}

export function gradeLevelForClass(settings: SchoolSettings, classCode: string): number | null {
  return settings.classes.find((item) => item.code === classCode)?.grade ?? null;
}

export function isSupportedGrade(settings: SchoolSettings, grade: unknown): grade is number {
  return typeof grade === 'number' && gradeLevelsOf(settings).includes(grade);
}

// Quiz IDs are only a UI hint. The server still verifies the student's actual
// class, the quiz target and its open window before allowing an attempt.
export function classCodesForQuizId(settings: SchoolSettings, quizId: string | null): string[] {
  const grade = /(?:^|-)G(\d{1,2})(?:-|$)/i.exec(quizId ?? '')?.[1];
  const classes = grade ? classCodesForGrade(settings, Number(grade)) : [];
  return classes.length ? classes : settings.classes.map((item) => item.code);
}
