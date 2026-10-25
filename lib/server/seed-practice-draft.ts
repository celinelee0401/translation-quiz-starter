import { quizMeta, quizQuestions } from '../mvp-data.ts';
import type { DataConfig } from './config.ts';

const gradeLevel = 8;
const unitTypes: Record<string, Array<'meaning' | 'pattern' | 'grammar' | 'convention'>> = {
  Q1: ['meaning', 'pattern', 'meaning', 'convention'],
  Q2: ['grammar', 'meaning', 'meaning', 'convention'],
  Q3: ['pattern', 'meaning', 'convention'],
  Q4: ['meaning', 'grammar', 'meaning', 'convention'],
  Q5: ['pattern', 'convention'],
};

export class DraftSeedError extends Error {
  readonly status: number;

  constructor(message: string, status = 503) {
    super(message);
    this.status = status;
  }
}

type QuizRow = {
  quiz_id: string;
  quiz_version: number;
  status: string;
};

type QuestionRow = {
  id: string;
  question_key: string;
};

export async function seedPracticeDraft(
  config: DataConfig,
  fetcher: typeof fetch = fetch,
): Promise<{ result: 'created' | 'already-exists'; questions: number; rubricUnits: number }> {
  validateSeed();
  const quizFilter = `quiz_id=eq.${encodeURIComponent(quizMeta.id)}&quiz_version=eq.${quizMeta.version}`;
  const existing = await tableRequest<QuizRow[]>(
    config,
    `translation_quizzes?${quizFilter}&select=quiz_id,quiz_version,status`,
    undefined,
    fetcher,
  );
  if (existing.length > 0) {
    if (existing[0].status !== 'draft') {
      throw new DraftSeedError('同版本測驗已非草稿，匯入已停止。', 409);
    }
    const questions = await tableRequest<QuestionRow[]>(
      config,
      `translation_questions?${quizFilter}&select=id,question_key`,
      undefined,
      fetcher,
    );
    if (questions.length !== quizQuestions.length ||
      quizQuestions.some((item) => !questions.some((row) => row.question_key === item.id))) {
      throw new DraftSeedError('後端已有不完整或不同內容的草稿，請先由教師檢查。', 409);
    }
    const count = await countRubricUnits(config, questions, fetcher);
    if (count !== expectedRubricCount()) {
      throw new DraftSeedError('後端草稿的評分單位不完整，請先由教師檢查。', 409);
    }
    return { result: 'already-exists', questions: questions.length, rubricUnits: count };
  }

  await tableRequest(
    config,
    'translation_quizzes',
    {
      method: 'POST',
      body: [{
        quiz_id: quizMeta.id,
        quiz_version: quizMeta.version,
        title: quizMeta.title,
        grade_level: gradeLevel,
        unit_label: quizMeta.unit,
        score_mode: 'practice',
        rubric_version: quizMeta.rubricVersion,
        status: 'draft',
        feedback_policy: 'immediate',
        published_at: null,
      }],
    },
    fetcher,
  );
  const questions = await tableRequest<QuestionRow[]>(
    config,
    'translation_questions?select=id,question_key',
    {
      method: 'POST',
      body: quizQuestions.map((question, index) => ({
        quiz_id: quizMeta.id,
        quiz_version: quizMeta.version,
        question_key: question.id,
        display_order: index + 1,
        prompt_zh: question.prompt,
        segmented_answer: question.segmentedAnswer,
        hint: question.hint,
        max_score: question.rubric.reduce((sum, unit) => sum + unit.points, 0),
      })),
    },
    fetcher,
  );
  if (questions.length !== quizQuestions.length) {
    throw new DraftSeedError('題目儲存數量異常；草稿保持未發布，請檢查後端。');
  }
  const rubricUnits = quizQuestions.flatMap((question) => {
    const stored = questions.find((row) => row.question_key === question.id);
    if (!stored) throw new DraftSeedError('題目識別碼異常；草稿保持未發布，請檢查後端。');
    return question.rubric.map((unit, index) => ({
      question_id: stored.id,
      rubric_version: quizMeta.rubricVersion,
      unit_type: unitTypes[question.id][index],
      label: unit.label,
      requirement: unit.requirement,
      points: unit.points,
      display_order: index + 1,
      machine_rule: index === 0 ? {
        teacherConfirmed: true,
        acceptedFullAnswers: question.acceptedAlternatives,
        partialCreditAnswers: question.scoredAlternatives ?? [],
      } : {},
      accepted_alternatives: [],
    }));
  });
  const inserted = await tableRequest<Array<{ id: string }>>(
    config,
    'translation_rubric_units?select=id',
    { method: 'POST', body: rubricUnits },
    fetcher,
  );
  if (inserted.length !== rubricUnits.length) {
    throw new DraftSeedError('評分單位儲存數量異常；草稿保持未發布，請檢查後端。');
  }
  return {
    result: 'created',
    questions: questions.length,
    rubricUnits: inserted.length,
  };
}

function validateSeed(): void {
  const total = quizQuestions.reduce(
    (sum, question) => sum + question.rubric.reduce((points, unit) => points + unit.points, 0),
    0,
  );
  if (total !== quizMeta.maxScore || quizMeta.maxScore !== 90 ||
      quizQuestions.length !== 5 ||
      quizQuestions[4].rubric.reduce((sum, unit) => sum + unit.points, 0) !== 10 ||
      quizQuestions.some((question) =>
        !question.segmentedAnswer ||
        question.rubric.length !== unitTypes[question.id]?.length ||
        /[，。？！’]/.test(question.segmentedAnswer))) {
    throw new DraftSeedError('本地題目與已確認的 90 分評分規則不一致。', 500);
  }
}

function expectedRubricCount(): number {
  return quizQuestions.reduce((sum, question) => sum + question.rubric.length, 0);
}

async function countRubricUnits(
  config: DataConfig,
  questions: QuestionRow[],
  fetcher: typeof fetch,
): Promise<number> {
  const ids = questions.map((row) => row.id).join(',');
  const rows = await tableRequest<Array<{ id: string }>>(
    config,
    `translation_rubric_units?question_id=in.(${ids})&rubric_version=eq.${quizMeta.rubricVersion}&select=id`,
    undefined,
    fetcher,
  );
  return rows.length;
}

async function tableRequest<T>(
  config: DataConfig,
  path: string,
  write?: { method: 'POST'; body: unknown },
  fetcher: typeof fetch = fetch,
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(`${config.supabaseUrl}/rest/v1/${path}`, {
      method: write?.method ?? 'GET',
      headers: {
        apikey: config.supabaseSecretKey,
        authorization: `Bearer ${config.supabaseSecretKey}`,
        accept: 'application/json',
        ...(write ? {
          'content-type': 'application/json',
          prefer: 'return=representation',
        } : {}),
      },
      ...(write ? { body: JSON.stringify(write.body) } : {}),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new DraftSeedError('目前無法連線到後端；草稿未發布。');
  }
  if (!response.ok) {
    throw new DraftSeedError(
      `後端資料操作失敗（HTTP ${response.status}）；草稿未發布。`,
      response.status >= 500 ? 503 : 409,
    );
  }
  try {
    return await response.json() as T;
  } catch {
    throw new DraftSeedError('後端回應格式異常；草稿未發布。');
  }
}
