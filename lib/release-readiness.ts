import type { TeacherQuiz } from './server/teacher-overview.ts';

export type ReleaseCheck = {
  label: string;
  state: 'pass' | 'action' | 'manual';
  detail: string;
};

/** Read-only preflight. Manual checks intentionally never turn into publish authorization. */
export function getReleaseChecks(quiz: TeacherQuiz, now = new Date()): ReleaseCheck[] {
  const checks: ReleaseCheck[] = [];
  const questionsComplete = quiz.questions.length > 0 && quiz.questions.every((question) =>
    question.prompt.trim() && question.answer.trim() && question.hint.trim() &&
    Number.isFinite(question.points) && question.points > 0);
  checks.push({
    label: '題目與學習提示',
    state: questionsComplete ? 'pass' : 'action',
    detail: questionsComplete ? `已建立 ${quiz.questions.length} 題；仍請對照原始題目來源。` : '需補齊每題中文題目、英文參考答案、提示與配分。',
  });

  const rubricComplete = questionsComplete && quiz.questions.every((question) =>
    question.rubric.length > 0 &&
    question.rubric.every((unit) => unit.label.trim() && unit.requirement.trim() && Number.isFinite(unit.points) && unit.points >= 0) &&
    Math.abs(question.rubric.reduce((sum, unit) => sum + unit.points, 0) - question.points) < 0.001);
  checks.push({
    label: '逐題評分單位與總分',
    state: rubricComplete ? 'pass' : 'action',
    detail: rubricComplete ? '每題評分單位的配分加總與題目分數一致。' : '需補齊評分單位，並核對每題配分加總。',
  });

  const validTargets = quiz.targets.length > 0 && quiz.targets.every((target) => {
    const opensAt = Date.parse(target.opensAt);
    const closesAt = Date.parse(target.closesAt);
    return Number.isFinite(opensAt) && Number.isFinite(closesAt) && opensAt < closesAt && closesAt > now.getTime();
  });
  checks.push({
    label: '班級與開放時段',
    state: validTargets ? 'pass' : 'action',
    detail: validTargets ? `已設定 ${quiz.targets.map((target) => target.classCode).join('、')}；發布前請再次確認目標班級。` : '至少設定一個目標班級及尚未截止的有效時段。',
  });

  if (quiz.scoreMode === 'formal') {
    const safeFeedback = quiz.feedbackPolicy === 'all-closed' || quiz.feedbackPolicy === 'teacher-release';
    checks.push({
      label: '正式成績回饋時機',
      state: safeFeedback ? 'pass' : 'action',
      detail: safeFeedback ? (quiz.feedbackPolicy === 'teacher-release'
        ? '依課堂即時回饋設定，交卷後在本班時段內可見；截止時收回。先考學生仍可截圖或轉述，請教師評估錯開應試風險。'
        : '所有班級截止後才顯示答案。') : '錯開應試時，請改為所有班截止後或課堂即時回饋政策。',
    });
    checks.push({
      label: '教師核定題目與配分',
      state: quiz.contentApproval ? 'pass' : 'manual',
      detail: quiz.contentApproval ? `已記錄教師確認（${quiz.contentApproval.at}）；內容變更後需重新確認。` : '需逐頁確認題目、參考答案與配分。',
    });
    checks.push({
      label: '教師核定替代表達與評分細則',
      state: quiz.rubricApproval ? 'pass' : 'manual',
      detail: quiz.rubricApproval
        ? `已記錄 ${quiz.rubricApproval.version} 核准（${quiz.rubricApproval.at}）；內容或規則變更後需重新確認。`
        : '仍需審定可接受替代表達與灰色答案的判分方式；題目配分確認不等於完成這項核定。',
    });
    checks.push({
      label: '共用 PIN 與學生端實測',
      state: quiz.studentE2E ? 'pass' : 'manual',
      detail: quiz.studentE2E
        ? `已完成隔離測試帳號端到端驗收（${quiz.studentE2E.version}，${quiz.studentE2E.at}）；正式學生資料未用於測試。`
        : '需以隔離測試身分驗證共用 PIN、班級時段、提交與正式回饋限制。',
    });
  }
  return checks;
}
