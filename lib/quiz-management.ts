import type { TeacherQuiz } from './server/teacher-overview.ts';
import { getReleaseChecks } from './release-readiness.ts';

export type QuizGroup = 'draft' | 'upcoming' | 'active' | 'ended' | 'archived';
export type TargetPhase = 'upcoming' | 'active' | 'ended';

export function quizGroup(quiz: TeacherQuiz, now = Date.now()): QuizGroup {
  if (quiz.status === 'archived') return 'archived';
  if (quiz.status === 'draft') return 'draft';
  if (quiz.status === 'closed' || (quiz.targets.length > 0 &&
    quiz.targets.every(target => Date.parse(target.closesAt) <= now))) return 'ended';
  if (quiz.targets.some(target => Date.parse(target.opensAt) <= now && now < Date.parse(target.closesAt))) return 'active';
  return 'upcoming';
}

export function targetPhase(target: { opensAt: string; closesAt: string }, now = Date.now()): TargetPhase {
  if (now < Date.parse(target.opensAt)) return 'upcoming';
  if (now < Date.parse(target.closesAt)) return 'active';
  return 'ended';
}

export function canArchiveQuiz(quiz: TeacherQuiz, now = Date.now()): boolean {
  if (quiz.status === 'archived') return false;
  if (quiz.status === 'draft') return true;
  return quiz.targets.length > 0 && quiz.targets.every(target =>
    Number.isFinite(Date.parse(target.closesAt)) && Date.parse(target.closesAt) <= now);
}

const chineseDigits: Record<string, string> = { 一: '1', 二: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9', 十: '10' };

/**
 * 把題名與搜尋字都轉成同一種寫法：全形→半形、大小寫不分，
 * 「Unit 2／unit2／第二課／Lesson 2」都視為 U2，「八年級」視為 G8。
 */
export function normalizeSearchText(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase()
    .replace(/[一二三四五六七八九十]/g, digit => chineseDigits[digit])
    .replace(/(?:unit|lesson|第)\s*(\d+)\s*(?:課|單元)?/g, ' u$1 ')
    .replace(/\bu\s+(\d+)/g, ' u$1 ')
    .replace(/(?:grade\s*|g\s+)([89])\b/g, ' g$1 ')
    .replace(/([89])\s*年級/g, ' g$1 ')
    .replace(/對話/g, ' dialogue ')
    .replace(/閱讀/g, ' reading ')
    .replace(/[|｜,，、.。:：;；()（）[\]【】_\-–—/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 每個關鍵字都要出現（不分順序、忽略空白）。 */
export function quizMatchesQuery(quiz: Pick<TeacherQuiz, 'title' | 'unitLabel' | 'quizId'>, query: string): boolean {
  const tokens = normalizeSearchText(query).split(' ').filter(Boolean);
  if (!tokens.length) return true;
  const haystack = normalizeSearchText(`${quiz.title} ${quiz.unitLabel ?? ''}`).replace(/ /g, '');
  // 測驗代碼含隨機英數，只接受整段貼上比對，避免單一數字誤中。
  return tokens.every(token => haystack.includes(token)) ||
    (query.trim().length >= 6 && quiz.quizId.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
}

/** 依題名自然排序（U2 在 U10 前、p.21 在 p.103 前）。 */
export function compareQuizTitles(a: Pick<TeacherQuiz, 'title'>, b: Pick<TeacherQuiz, 'title'>): number {
  return a.title.localeCompare(b.title, 'zh-TW', { numeric: true });
}

/** 草稿的下一步：null 表示發布檢查已全部通過，可直接發布。 */
export function draftNextStep(quiz: TeacherQuiz, now = new Date()): string | null {
  if (quiz.status !== 'draft') return null;
  return getReleaseChecks(quiz, now).find(check => check.state !== 'pass')?.label ?? null;
}
