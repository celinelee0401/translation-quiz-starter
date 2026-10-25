import type { DataConfig } from './config.ts';
import { isSupportedGrade } from '../public-quiz-data.ts';

export type NewQuestion = { prompt: string; answer: string; hint: string; meaning: number; grammar: number };
export type NewQuizDraft = {
  title: string; unit: string; grade: number; scoreMode: 'practice' | 'formal'; questions: NewQuestion[];
};

export class CreateDraftError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

export function validateNewDraft(input: unknown): NewQuizDraft {
  if (!input || typeof input !== 'object') throw new CreateDraftError('請填寫測驗資料。');
  const value = input as Record<string, unknown>;
  if (typeof value.title !== 'string' || value.title.trim().length < 3 || value.title.length > 120 ||
    typeof value.unit !== 'string' || !value.unit.trim() || value.unit.length > 80 ||
    !isSupportedGrade(value.grade) ||
    (value.scoreMode !== 'practice' && value.scoreMode !== 'formal') ||
    !Array.isArray(value.questions) || value.questions.length < 1 || value.questions.length > 50) {
    throw new CreateDraftError('請填寫名稱、單元、年級、成績模式及 1～50 題。');
  }
  const questions = value.questions.map((item: unknown, index: number) => {
    const q = item as Partial<NewQuestion> | null;
    if (!q || typeof q.prompt !== 'string' || !q.prompt.trim() || q.prompt.length > 500 ||
      typeof q.answer !== 'string' || !q.answer.trim() || q.answer.length > 1000 ||
      typeof q.hint !== 'string' || !q.hint.trim() || q.hint.length > 500 ||
      !Number.isInteger(q.meaning) || !Number.isInteger(q.grammar) ||
      Number(q.meaning) < 1 || Number(q.grammar) < 0 || Number(q.meaning) + Number(q.grammar) + 1 > 100) {
      throw new CreateDraftError(`第 ${index + 1} 題資料或配分不完整。`);
    }
    if (/[，。？！；：“”‘’]/u.test(q.answer)) {
      throw new CreateDraftError(`第 ${index + 1} 題英文答案請改用半形標點與直撇號。`);
    }
    return { prompt: q.prompt.trim(), answer: q.answer.trim(), hint: q.hint.trim(),
      meaning: Number(q.meaning), grammar: Number(q.grammar) };
  });
  return { title: value.title.trim(), unit: value.unit.trim(), grade: value.grade,
    scoreMode: value.scoreMode, questions };
}

async function insert<T>(config: DataConfig, path: string, body: unknown, fetcher: typeof fetch): Promise<T> {
  const response = await fetcher(`${config.supabaseUrl}/rest/v1/${path}`, {
    method: 'POST', headers: { apikey: config.supabaseSecretKey,
      authorization: `Bearer ${config.supabaseSecretKey}`, 'content-type': 'application/json',
      prefer: 'return=representation' }, body: JSON.stringify(body), cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new CreateDraftError('後端儲存未完成；如清單已有不完整草稿，請先封存後重試。', 503);
  return await response.json() as T;
}

export async function createQuizDraft(config: DataConfig, input: NewQuizDraft, actor: string,
  fetcher: typeof fetch = fetch): Promise<string> {
  const id = `CUSTOM-G${input.grade}-${crypto.randomUUID().replaceAll('-', '').toUpperCase()}`;
  const rubricVersion = 'teacher-draft-v1';
  const created = await insert<Array<{ quiz_id: string }>>(config, 'translation_quizzes?select=quiz_id', [{
    quiz_id: id, quiz_version: 1, title: input.title, grade_level: input.grade,
    unit_label: input.unit, score_mode: input.scoreMode, rubric_version: rubricVersion,
    status: 'draft', feedback_policy: input.scoreMode === 'formal' ? 'teacher-release' : 'immediate',
  }], fetcher);
  if (created.length !== 1 || created[0].quiz_id !== id) throw new CreateDraftError('草稿建立未確認。', 503);
  const questions = await insert<Array<{ id: string; question_key: string }>>(config,
    'translation_questions?select=id,question_key', input.questions.map((question, index) => ({
      quiz_id: id, quiz_version: 1, question_key: `Q${index + 1}`, display_order: index + 1,
      prompt_zh: question.prompt, segmented_answer: question.answer, hint: question.hint,
      max_score: question.meaning + question.grammar + 1,
    })), fetcher);
  if (questions.length !== input.questions.length) throw new CreateDraftError('題目儲存不完整；測驗仍未發布。', 503);
  const rubric = input.questions.flatMap((question, index) => {
    const stored = questions.find(row => row.question_key === `Q${index + 1}`);
    if (!stored) throw new CreateDraftError('題目識別碼不完整；測驗仍未發布。', 503);
    return [
      { question_id: stored.id, rubric_version: rubricVersion, unit_type: 'meaning', label: '必要語意',
        requirement: question.prompt, points: question.meaning, display_order: 1,
        machine_rule: { requiresTeacherReview: true }, accepted_alternatives: [] },
      { question_id: stored.id, rubric_version: rubricVersion, unit_type: 'grammar', label: '句型與文法',
        requirement: question.hint, points: question.grammar, display_order: 2,
        machine_rule: { requiresTeacherReview: true }, accepted_alternatives: [] },
      { question_id: stored.id, rubric_version: rubricVersion, unit_type: 'convention', label: '書寫規約',
        requirement: '大小寫、拼字與半形標點合計 1 分，避免重複扣分。', points: 1, display_order: 3,
        machine_rule: { requiresTeacherReview: true }, accepted_alternatives: [] },
    ];
  });
  const saved = await insert<Array<{ id: string }>>(config, 'translation_rubric_units?select=id', rubric, fetcher);
  if (saved.length !== rubric.length) throw new CreateDraftError('評分單位儲存不完整；測驗仍未發布。', 503);
  const audit = await insert<Array<{ id: number }>>(config, 'translation_audit_log?select=id', [{
    actor_type: 'teacher', actor_id: actor, action: 'create-quiz-draft', entity_type: 'translation_quiz',
    entity_id: `${id}:1`, after_data: { title: input.title, grade: input.grade, scoreMode: input.scoreMode,
      questionCount: input.questions.length, totalPoints: input.questions.reduce((sum, q) => sum + q.meaning + q.grammar + 1, 0) },
  }], fetcher);
  if (audit.length !== 1) throw new CreateDraftError('草稿已建立但稽核未確認；請重新整理核對。', 503);
  return id;
}
