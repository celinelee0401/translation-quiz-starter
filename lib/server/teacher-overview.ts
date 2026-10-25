import type { DataConfig } from './config.ts';
import { quizContentFingerprint } from '../quiz-content-approval.ts';
import { genericRubricFingerprint, genericRubricVersion } from '../generic-rubric-approval.ts';
import { studentE2EAuditAction, studentE2EAuditEntity, studentE2EContractVersion } from '../student-e2e-contract.ts';

export type TeacherQuiz = {
  quizId: string;
  version: number;
  title: string;
  unitLabel?: string;
  createdAt?: string;
  grade: number;
  scoreMode: 'practice' | 'formal';
  feedbackPolicy: 'immediate' | 'class-closed' | 'all-closed' | 'teacher-release';
  status: 'draft' | 'published' | 'closed' | 'archived';
  contentApproval?: { by: string; at: string };
  rubricApproval?: { by: string; at: string; version: string };
  studentE2E?: { by: string; at: string; version: string };
  questions: Array<{
    id: string;
    key: string;
    prompt: string;
    answer: string;
    hint: string;
    points: number;
    rubric: Array<{ label: string; requirement: string; points: number }>;
  }>;
  targets: Array<{
    classCode: string;
    opensAt: string;
    closesAt: string;
    feedbackAt?: string | null;
    dashboardVisible: boolean;
    attemptLimit?: number;
  }>;
};

type QuizRow = {
  quiz_id: string;
  quiz_version: number;
  title: string;
  unit_label?: string;
  created_at?: string;
  grade_level: number;
  score_mode: TeacherQuiz['scoreMode'];
  feedback_policy: TeacherQuiz['feedbackPolicy'];
  status: TeacherQuiz['status'];
};

type TargetRow = {
  quiz_id: string;
  quiz_version: number;
  class_code: string;
  opens_at: string;
  closes_at: string;
  feedback_at: string | null;
  dashboard_visible: boolean;
  attempt_limit?: number;
};

type QuestionRow = {
  id: string;
  quiz_id: string;
  quiz_version: number;
  question_key: string;
  display_order: number;
  prompt_zh: string;
  segmented_answer: string;
  hint: string;
  max_score: number;
};

type RubricRow = {
  question_id: string;
  display_order: number;
  label: string;
  requirement: string;
  points: number;
};

type ApprovalRow = {
  entity_id: string;
  actor_id: string;
  occurred_at: string;
  after_data: {
    content_fingerprint?: string;
    rubric_fingerprint?: string;
    rubric_version?: string;
    e2e_version?: string;
    passed?: boolean;
  } | null;
};

export async function loadTeacherOverview(
  config: DataConfig,
  fetcher: typeof fetch = fetch,
): Promise<TeacherQuiz[]> {
  const [quizzes, targets, questions, rubric, approvals, genericApprovals, studentE2ERuns] = await Promise.all([
    readRows<QuizRow[]>(
      config,
      'translation_quizzes?select=quiz_id,quiz_version,title,unit_label,created_at,grade_level,score_mode,feedback_policy,status&order=created_at.desc&limit=100',
      fetcher,
    ),
    readRows<TargetRow[]>(
      config,
      `translation_quiz_targets?select=quiz_id,quiz_version,class_code,opens_at,closes_at,feedback_at,dashboard_visible,attempt_limit&school_year=eq.${config.schoolYear}&order=class_code.asc&limit=500`,
      fetcher,
    ),
    readRows<QuestionRow[]>(
      config,
      'translation_questions?select=id,quiz_id,quiz_version,question_key,display_order,prompt_zh,segmented_answer,hint,max_score&order=display_order.asc&limit=1000',
      fetcher,
    ),
    readRows<RubricRow[]>(
      config,
      'translation_rubric_units?select=question_id,display_order,label,requirement,points&order=display_order.asc&limit=3000',
      fetcher,
    ),
    readRows<ApprovalRow[]>(
      config,
      'translation_audit_log?select=entity_id,actor_id,occurred_at,after_data&action=eq.confirm-quiz-content-points&entity_type=eq.translation_quiz&order=occurred_at.desc&limit=500',
      fetcher,
    ),
    readRows<ApprovalRow[]>(
      config,
      'translation_audit_log?select=entity_id,actor_id,occurred_at,after_data&action=eq.confirm-generic-rubric&entity_type=eq.translation_quiz&order=occurred_at.desc&limit=500',
      fetcher,
    ),
    readRows<ApprovalRow[]>(
      config,
      `translation_audit_log?select=entity_id,actor_id,occurred_at,after_data&action=eq.${studentE2EAuditAction}&entity_type=eq.translation-system&order=occurred_at.desc&limit=20`,
      fetcher,
    ),
  ]);

  if (quizzes.length === 100 || targets.length === 500 || questions.length === 1000 ||
    rubric.length === 3000 || approvals.length === 500 || genericApprovals.length === 500 ||
    studentE2ERuns.length === 20) {
    throw new Error('教師清單已超過目前頁面容量，請先擴充查詢分頁。');
  }

  const items = quizzes.map((quiz) => {
    const item: TeacherQuiz = {
    quizId: quiz.quiz_id,
    version: quiz.quiz_version,
    title: quiz.title,
    unitLabel: quiz.unit_label,
    createdAt: quiz.created_at,
    grade: quiz.grade_level,
    scoreMode: quiz.score_mode,
    feedbackPolicy: quiz.feedback_policy,
    status: quiz.status,
    questions: questions
      .filter((question) => question.quiz_id === quiz.quiz_id && question.quiz_version === quiz.quiz_version)
      .map((question) => ({
        id: question.id,
        key: question.question_key,
        prompt: question.prompt_zh,
        answer: question.segmented_answer,
        hint: question.hint,
        points: Number(question.max_score),
        rubric: rubric.filter((unit) => unit.question_id === question.id).map((unit) => ({
          label: unit.label, requirement: unit.requirement, points: Number(unit.points),
        })),
      })),
    targets: targets
      .filter((target) =>
        target.quiz_id === quiz.quiz_id && target.quiz_version === quiz.quiz_version)
      .map((target) => ({
        classCode: target.class_code,
        opensAt: target.opens_at,
        closesAt: target.closes_at,
        feedbackAt: target.feedback_at,
        dashboardVisible: target.dashboard_visible,
        attemptLimit: target.attempt_limit ?? 1,
      })),
    };
    const matching = approvals.find((approval) => approval.entity_id === `${item.quizId}:${item.version}` &&
      approval.after_data?.content_fingerprint === quizContentFingerprint(item));
    if (matching) item.contentApproval = { by: matching.actor_id, at: matching.occurred_at };
    return item;
  });
  for (const item of items.filter(quiz => quiz.quizId.startsWith('CUSTOM-'))) {
    const matching = genericApprovals.find(approval =>
      approval.entity_id === `${item.quizId}:${item.version}` &&
      approval.after_data?.rubric_version === genericRubricVersion &&
      approval.after_data?.rubric_fingerprint === genericRubricFingerprint(item));
    if (matching) item.rubricApproval = { by: matching.actor_id, at: matching.occurred_at,
      version: genericRubricVersion };
  }
  const verifiedStudentFlow = studentE2ERuns.find((run) =>
    run.entity_id === studentE2EAuditEntity &&
    run.after_data?.e2e_version === studentE2EContractVersion &&
    run.after_data?.passed === true);
  if (verifiedStudentFlow) {
    for (const item of items) {
      item.studentE2E = {
        by: verifiedStudentFlow.actor_id,
        at: verifiedStudentFlow.occurred_at,
        version: studentE2EContractVersion,
      };
    }
  }
  return items;
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
  if (!response.ok) throw new Error(`教師清單讀取失敗（HTTP ${response.status}）。`);
  return await response.json() as T;
}
