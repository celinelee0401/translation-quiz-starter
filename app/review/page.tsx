import { PageNavLink } from '@/components/page-nav-link';
import { headers } from 'next/headers';
import { getDataConfig } from '@/lib/server/config';
import { isTeacherAuthenticated } from '@/lib/server/teacher-auth';
import { loadTeacherOverview, type TeacherQuiz } from '@/lib/server/teacher-overview';
import { loadReviewOverview, loadTeacherReview, type ReviewGroup, type TeacherReviewAttempt } from '@/lib/server/teacher-review';
import { TeacherScoreForm } from '@/components/teacher-score-form';
import { BatchAiSuggestions } from '@/components/batch-ai-suggestions';
import { ReleaseFeedback } from '@/components/release-feedback';
import { loadAutoFinalizeSettings, settingFor, type AutoFinalizeSetting } from '@/lib/server/auto-finalize';
import { AiFirstPass } from '@/components/ai-first-pass';
import { CONFIDENCE_BUCKETS, loadCalibration, loadSpotCheck, summarizeCalibration, type CalibrationBucket, type SpotCheckItem } from '@/lib/server/calibration';
import { classCodePattern } from '@/lib/public-quiz-data';
import { getSchoolSettings } from '@/lib/school-settings';

export const dynamic = 'force-dynamic';

function schoolTime() {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: getSchoolSettings().timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ quiz?: string; v?: string; class?: string; view?: string; focus?: string; spot?: string; calib?: string }> }) {
  if (!await isTeacherAuthenticated(new Request('https://translation.local/', { headers: await headers() }))) {
    return <main className="mx-auto max-w-xl px-5 py-16"><h1 className="text-2xl font-black">教師覆核區</h1><p className="mt-4">此頁僅供教師帳號使用。</p></main>;
  }

  const config = getDataConfig();
  const query = await searchParams;
  const classFilter = classCodePattern.test(query.class ?? '') ? query.class! : '';
  const quizFilter = typeof query.quiz === 'string' && query.quiz.length < 130 ? query.quiz : '';
  const versionFilter = /^\d{1,4}$/.test(query.v ?? '') ? Number(query.v) : 0;
  const showAll = query.view === 'all';
  const appealOnly = query.focus === 'appeal';
  let attempts: TeacherReviewAttempt[] = [];
  let quizzes: TeacherQuiz[] = [];
  let groups: ReviewGroup[] = [];
  let error: string | null = null;
  let autoQuizIds: string[] = [];
  let settings = new Map<string, AutoFinalizeSetting>();
  let spotItems: SpotCheckItem[] = [];
  let calibration: CalibrationBucket[] | null = null;
  let extrasError = '';
  if (!config) {
    error = '後端設定尚未完成，暫時無法讀取作答。';
  } else {
    try {
      quizzes = await loadTeacherOverview(config);
      groups = await loadReviewOverview(config, quizzes);
      const current = groups.find(group => group.quizId === quizFilter && group.classCode === classFilter &&
        (!versionFilter || group.version === versionFilter));
      if (current) {
        const ids = (showAll ? current.attemptIds : current.pendingAttemptIds).slice(0, 50);
        attempts = await loadTeacherReview(config, quizzes, fetch, 0, ids);
      }
      settings = await loadAutoFinalizeSettings(config).catch(() => new Map());
      autoQuizIds = quizzes.filter(quiz => settingFor(settings, quiz.quizId, quiz.version).enabled).map(quiz => quiz.quizId);
      try {
        const spotQuiz = quizzes.find(quiz => quiz.quizId === query.spot);
        if (spotQuiz) spotItems = await loadSpotCheck(config, quizzes, spotQuiz.quizId, 10);
        const calibQuiz = quizzes.find(quiz => quiz.quizId === query.calib);
        if (calibQuiz) calibration = summarizeCalibration(await loadCalibration(config, calibQuiz));
      } catch {
        extrasError = '抽查或校準資料暫時無法讀取，請稍後再試。';
      }
    } catch {
      error = '目前無法確認覆核資料完整性。請稍後再試；請勿依此畫面評分。';
    }
  }

  const current = groups.find(group => group.quizId === quizFilter && group.classCode === classFilter &&
    (!versionFilter || group.version === versionFilter)) ?? null;
  const groupHref = (group: ReviewGroup, all = false, appeal = false) =>
    `/review?quiz=${encodeURIComponent(group.quizId)}&v=${group.version}&class=${group.classCode}${all ? '&view=all' : ''}${appeal ? '&focus=appeal' : ''}#answers`;
  const currentIndex = current ? groups.indexOf(current) : -1;
  const nextGroup = [...groups.slice(currentIndex + 1), ...groups.slice(0, Math.max(0, currentIndex))]
    .find(group => group !== current && group.pendingAnswers > 0) ?? null;
  const totalPending = groups.reduce((sum, group) => sum + group.pendingAnswers, 0);
  const hasAppeal = (attempt: TeacherReviewAttempt) => attempt.answers.some(answer => answer.openAppeal);
  const shown = [...attempts]
    .sort((a, b) => Number(hasAppeal(b)) - Number(hasAppeal(a)) || a.seatNumber - b.seatNumber)
    .filter(attempt => appealOnly ? hasAppeal(attempt) : showAll || attempt.answers.some(answer => answer.finalScore === null || answer.openAppeal));
  const visibleAnswer = (answer: TeacherReviewAttempt['answers'][number]) =>
    appealOnly ? answer.openAppeal : showAll || answer.finalScore === null || answer.openAppeal;
  // Why a teacher has to look at this answer, in the order it should be handled.
  const reasonOf = (answer: TeacherReviewAttempt['answers'][number]) =>
    answer.openAppeal ? { label: '學生送評議・請優先批改', className: 'bg-rose-600 text-white' }
      : answer.finalScore !== null ? null
        : !answer.rawAnswer.trim() ? { label: '空白答案', className: 'bg-slate-200 text-slate-800' }
          : answer.aiReview ? { label: `AI 信心不足（${Math.round(answer.aiReview.confidence * 100)}%）`, className: 'bg-amber-200 text-amber-950' }
            : answer.suggestion.suggestedScore !== null ? { label: '固定規則已建議分數', className: 'bg-sky-100 text-sky-900' }
              : { label: 'AI 尚未判讀', className: 'bg-slate-200 text-slate-800' };
  const pendingAnswers = attempts.flatMap(attempt => attempt.answers).filter(answer => answer.finalScore === null || answer.openAppeal);
  const breakdown = {
    appeal: pendingAnswers.filter(answer => answer.openAppeal).length,
    lowAi: pendingAnswers.filter(answer => !answer.openAppeal && answer.aiReview && answer.rawAnswer.trim()).length,
    other: pendingAnswers.filter(answer => !answer.openAppeal && !(answer.aiReview && answer.rawAnswer.trim())).length,
  };
  const needsAi = shown.flatMap(attempt => attempt.answers)
    .filter(answer => answer.finalScore === null && answer.suggestion.suggestedScore === null &&
      !answer.aiReview && Boolean(answer.rawAnswer.trim()))
    .map(answer => ({ answerId: answer.id, updatedAt: answer.updatedAt }));
  const quizGroups = [...new Map(groups.map(group => [`${group.quizId}:${group.version}`, group.title])).entries()];
  const chip = (active: boolean) => `inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-bold ${active ? 'bg-[#12313e] text-white' : 'border border-border text-primary'}`;
  const releasable = quizzes.filter(quiz => quiz.scoreMode !== 'formal' && quiz.feedbackPolicy === 'teacher-release' && (quiz.status === 'published' || quiz.status === 'closed'));
  return (
    <main id="top" className="min-h-screen bg-background text-foreground">
      <div className="sticky top-0 z-30 border-b border-cyan-900 bg-[#12313e] shadow-md">
        <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-5 py-2 text-sm sm:px-8" aria-label="批改頁導覽">
          <PageNavLink href="/" className="inline-flex min-h-11 items-center rounded-xl border border-cyan-300 px-4 font-black text-cyan-100">← 教師工作區</PageNavLink>
          <PageNavLink href="/review" className={`inline-flex min-h-11 items-center rounded-xl px-4 font-black ${current ? 'border border-cyan-300 text-cyan-100' : 'bg-cyan-300 text-slate-950'}`}>待批改總覽</PageNavLink>
          {current ? <span className="inline-flex min-h-11 items-center rounded-xl bg-cyan-300 px-4 font-black text-slate-950">批改中：{current.classCode} 班</span> : null}
          <a href="#tools" className="inline-flex min-h-11 items-center rounded-xl border border-cyan-300 px-4 font-black text-cyan-100">成績匯出・抽查</a>
        </nav>
      </div>
      <div className="mx-auto max-w-5xl space-y-5 px-5 py-6 sm:px-8">
        {error ? <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-900">{error}</p> : current ? (
          <>
            <section id="answers" className="surface-card scroll-mt-20 border-2 border-[#12313e]">
              <p className="text-sm font-bold text-primary">正在批改</p>
              <h1 className="mt-1 font-heading text-2xl font-black">{current.classCode} 班 · {current.title}</h1>
              <p className="mt-2 text-base font-bold">
                {current.pendingAnswers ? `待你確認 ${current.pendingAnswers} 題` : '這一組已全部定稿 ✓'}
                <span className="font-normal text-muted-foreground"> · 已交卷 {current.submitted} 份，其中 {current.finalized} 份已定稿</span>
              </p>
              {pendingAnswers.length ? <p className="mt-2 flex flex-wrap gap-2 text-sm font-bold">
                {breakdown.appeal ? <span className="rounded-full bg-rose-600 px-3 py-1 text-white">學生送評議 {breakdown.appeal} 題</span> : null}
                {breakdown.lowAi ? <span className="rounded-full bg-amber-200 px-3 py-1 text-amber-950">AI 信心不足 {breakdown.lowAi} 題</span> : null}
                {breakdown.other ? <span className="rounded-full bg-slate-200 px-3 py-1 text-slate-800">其他（空白、尚未判讀）{breakdown.other} 題</span> : null}
              </p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {current.appealAnswers ? <PageNavLink href={groupHref(current, false, true)}
                  className={`inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-black ${appealOnly ? 'bg-rose-700 text-white' : 'border-2 border-rose-600 text-rose-700'}`}>
                  只看學生評議（{current.appealAnswers}）</PageNavLink> : null}
                <PageNavLink href={groupHref(current)} className={chip(!showAll && !appealOnly)}>只看待確認</PageNavLink>
                <PageNavLink href={groupHref(current, true)} className={chip(showAll)}>看全部作答</PageNavLink>
                {nextGroup ? <PageNavLink href={groupHref(nextGroup)} className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-black text-primary-foreground">
                  下一組待批改：{nextGroup.classCode} 班 · {nextGroup.title}（{nextGroup.pendingAnswers} 題）→</PageNavLink> : null}
              </div>
              <p className="mt-3 text-sm text-muted-foreground">有學生評議的排在最前面，其餘依座號排列。{showAll ? '顯示這一班所有作答與題目。' : '每份只顯示還沒定稿的題目；按「確認並儲存」後，該題會從清單消失。'}
                {(showAll ? current.attemptIds : current.pendingAttemptIds).length > 50 ? ' 本組超過 50 份，先顯示前 50 份，存完後重新整理會出現其餘作答。' : ''}</p>
            </section>
            <BatchAiSuggestions answers={needsAi} />
            {shown.length === 0 ? <p className="surface-card">這一組沒有需要確認的題目。{nextGroup ? '可按上方「下一組待批改」繼續。' : '所有測驗都已批改完成。'}</p> : shown.map((attempt) => (
              <article key={attempt.id} className="surface-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h2 className="text-xl font-black">{attempt.classCode} 班 {attempt.seatNumber} 號</h2>
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-950">{attempt.status === 'finalized' ? `已定稿 ${attempt.finalScore} 分` : `待確認 ${attempt.answers.filter(answer => answer.finalScore === null).length} 題`}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">交卷時間 {schoolTime().format(new Date(attempt.submittedAt))}</p>
                <ol className="mt-4 space-y-4">
                  {attempt.answers.filter(visibleAnswer).map((answer) => (
                    <li key={answer.id} className={`rounded-xl p-4 text-sm leading-6 ${answer.openAppeal ? 'border-2 border-rose-500 bg-rose-50' : 'border border-border'}`}>
                      {reasonOf(answer) ? <p className="mb-2"><span className={`inline-block rounded-full px-3 py-1 text-xs font-black ${reasonOf(answer)!.className}`}>{reasonOf(answer)!.label}</span></p> : null}
                      <p className="font-black">{answer.questionKey} · {answer.prompt}（{answer.maxScore} 分）</p>
                      <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-muted p-3">學生原始作答：{answer.rawAnswer || '（空白）'}</p>
                      {answer.appealNotes.map((note, index) => <p key={index} className="mt-1 break-words text-rose-900">學生說明：{note}</p>)}
                      <details className="mt-2 rounded-lg border border-border px-3 py-2">
                        <summary className="cursor-pointer font-bold">查看參考答案與評分單位</summary>
                        <p className="mt-2 break-words font-mono">{answer.textbookAnswer}</p>
                        <ul className="mt-2 space-y-1 text-muted-foreground">
                          {answer.rubric.map((unit) => <li key={unit.label}>{unit.label} {unit.points} 分：{unit.requirement}</li>)}
                        </ul>
                      </details>
                      <p className="mt-2 font-bold text-primary">
                        {answer.suggestion.suggestedScore !== null
                          ? `規則 ${answer.suggestion.ruleVersion}：建議 ${answer.suggestion.suggestedScore} 分`
                          : `規則 ${answer.suggestion.ruleVersion}：需教師判讀`}
                      </p>
                      {answer.suggestion.breakdown ? <p className="text-sm font-semibold text-primary">
                        語意 {answer.suggestion.breakdown.meaning} 分 · 文法句型 {answer.suggestion.breakdown.grammar} 分 · 書寫 {answer.suggestion.breakdown.convention} 分
                      </p> : null}
                      <p className="text-muted-foreground">{answer.suggestion.reason}</p>
                      {answer.finalScore !== null ? <p className="mt-2 font-bold">目前教師分數：{answer.finalScore}／{answer.maxScore}</p> : null}
                      <TeacherScoreForm
                        answerId={answer.id}
                        updatedAt={answer.updatedAt}
                        maxScore={answer.maxScore}
                        initialScore={answer.finalScore ?? answer.suggestion.suggestedScore ?? answer.aiReview?.suggestedScore ?? null}
                        allowAi={answer.suggestion.suggestedScore === null && answer.finalScore === null && Boolean(answer.rawAnswer.trim())}
                        savedAi={answer.aiReview}
                      />
                      {answer.history.length ? (
                        <details className="mt-3 rounded-lg bg-muted p-3">
                          <summary className="cursor-pointer font-bold">覆核與改分紀錄（{answer.history.length}）</summary>
                          <ol className="mt-2 space-y-2">
                            {answer.history.map((entry, index) => (
                              <li key={`${entry.occurredAt}:${index}`}>
                                {schoolTime().format(new Date(entry.occurredAt))} · {entry.teacher} · {entry.previousScore ?? '未評'} → {entry.score} 分 · {entry.reason}
                              </li>
                            ))}
                          </ol>
                        </details>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </article>
            ))}
          </>
        ) : (
          <section id="answers" className="surface-card scroll-mt-20">
            <h1 className="font-heading text-2xl font-black">待批改總覽</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              每份測驗照 ① AI 先批 → ② 你確認剩下的 → ③ 抽查 → ④ 匯出 的順序完成。完成的步驟會打勾。
            </p>
            <p className="mt-3 text-base font-black">{totalPending ? `全部測驗共有 ${totalPending} 題待你確認` : '目前沒有待確認的題目 ✓'}</p>
            {groups.length === 0 ? <p className="mt-4 rounded-lg bg-muted p-4 text-sm">目前還沒有學生交卷。</p> : null}
            <div className="mt-4 space-y-4">
              {quizGroups.map(([key, title]) => {
                const rows = groups.filter(group => `${group.quizId}:${group.version}` === key);
                const first = rows[0];
                const setting = settingFor(settings, first.quizId, first.version);
                const awaiting = rows.reduce((sum, group) => sum + group.awaitingAi, 0);
                const adopted = rows.reduce((sum, group) => sum + group.aiAdopted, 0);
                const pendingTotal = rows.reduce((sum, group) => sum + group.pendingAnswers, 0);
                const step = (n: string, label: string, done: boolean) => <p className="flex items-center gap-2 font-black">
                  <span className={`inline-flex size-7 items-center justify-center rounded-full text-sm ${done ? 'bg-emerald-700 text-white' : 'bg-[#12313e] text-white'}`}>{done ? '✓' : n}</span>{label}</p>;
                return (
                  <div key={key} className="rounded-xl border-2 border-border p-4">
                    <h2 className="text-lg font-black">
                      <span className={`mr-2 rounded-full px-2 py-0.5 text-sm text-white ${first.grade === 8 ? 'bg-teal-700' : 'bg-indigo-700'}`}>G{first.grade}</span>{title}
                    </h2>
                    <ol className="mt-3 space-y-4 text-sm">
                      <li className="rounded-lg bg-emerald-50 p-3">
                        {step('1', 'AI 先批', setting.enabled && awaiting === 0)}
                        <p className="mt-1 text-muted-foreground">
                          {setting.enabled ? `AI 自動採用開啟中（門檻 ${Math.round(setting.threshold * 100)}%）· 已由 AI 定稿 ${adopted} 題` : 'AI 自動採用已關閉，所有題目都要你逐題確認。'}
                          {awaiting ? ` · 還有 ${awaiting} 題尚未經 AI 判讀` : ''}
                        </p>
                        <div className="mt-2"><AiFirstPass quizId={first.quizId} version={first.version} enabled={setting.enabled}
                          threshold={setting.threshold} awaiting={awaiting} /></div>
                      </li>
                      <li className="rounded-lg bg-muted p-3">
                        {step('2', `你確認剩下的題目${pendingTotal ? `（共 ${pendingTotal} 題）` : ''}`, pendingTotal === 0)}
                        <ul className="mt-2 space-y-2">
                          {rows.map(group => (
                            <li key={group.classCode} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white px-3 py-2">
                              <span>
                                <b className="text-base">{group.classCode} 班</b>
                                {group.opensAt ? <> · {schoolTime().format(new Date(group.opensAt))} 開放</> : null}
                                {' '}· 已交 {group.submitted} 份 · 已定稿 {group.finalized} 份
                              </span>
                              <span className="flex flex-wrap gap-2">
                                {group.appealAnswers ? <PageNavLink href={groupHref(group, false, true)}
                                  className="inline-flex min-h-11 items-center rounded-lg bg-rose-600 px-4 text-sm font-black text-white">
                                  學生評議 {group.appealAnswers} 題 → 先批</PageNavLink> : null}
                                {group.pendingAnswers
                                  ? <PageNavLink href={groupHref(group)} className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-black text-primary-foreground">開始批改（{group.pendingAnswers} 題）</PageNavLink>
                                  : <span className="inline-flex min-h-11 items-center px-2 font-black text-emerald-800">全部定稿 ✓</span>}
                                <PageNavLink href={groupHref(group, true)} className={chip(false)}>看全部作答</PageNavLink>
                              </span>
                            </li>
                          ))}
                        </ul>
                      </li>
                      <li className="rounded-lg bg-muted p-3">
                        {step('3', '抽查 AI 批得對不對', false)}
                        <div className="mt-2 flex flex-wrap gap-2">
                          <PageNavLink href={`/review?spot=${encodeURIComponent(first.quizId)}#tools`} className={chip(false)}>每班抽查 10 題</PageNavLink>
                          <PageNavLink href={`/review?calib=${encodeURIComponent(first.quizId)}#tools`} className={chip(false)}>校準報告</PageNavLink>
                        </div>
                      </li>
                      <li className="rounded-lg bg-muted p-3">
                        {step('4', '匯出成績貼進平時成績表', false)}
                        {pendingTotal ? <p className="mt-1 text-amber-900">還有 {pendingTotal} 題未定稿；現在匯出，那些學生的分數會是空白。</p> : null}
                        <div className="mt-2 flex flex-wrap gap-2">
                          {rows.map(group => <a key={group.classCode}
                            href={`/api/teacher/grades/export?quiz=${encodeURIComponent(group.quizId)}&version=${group.version}&class=${group.classCode}&format=column`}
                            className="inline-flex min-h-11 items-center rounded-lg bg-primary px-3 font-bold text-primary-foreground">
                            {group.classCode} 貼表格用（座號＋分數）</a>)}
                        </div>
                      </li>
                    </ol>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {!error ? <div id="tools" className="scroll-mt-20 space-y-4">
          <details className="surface-card" open={Boolean(query.spot || query.calib)}>
            <summary className="cursor-pointer text-xl font-black">AI 自動採用：抽查與校準</summary>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              自動定稿的題目不必逐題看；每班只抽信心最低的 10 題確認。校準報告顯示不同信心區間有多少題，以及你親自評分的題目中 AI 與你一致的比例，可用來調整門檻。
            </p>
            {autoQuizIds.length === 0 ? <p className="mt-3 rounded-lg bg-muted p-3 text-sm">目前沒有開啟 AI 自動採用的測驗。</p> : null}
              {quizzes.filter(quiz => autoQuizIds.includes(quiz.quizId)).map(quiz =>
                <div key={`${quiz.quizId}:${quiz.version}`} className="mt-3 flex flex-wrap items-center gap-2">
                  <b className="mr-1">{quiz.title}</b>
                  <PageNavLink href={`/review?spot=${encodeURIComponent(quiz.quizId)}#tools`} className={chip(query.spot === quiz.quizId)}>每班抽查 10 題</PageNavLink>
                  <PageNavLink href={`/review?calib=${encodeURIComponent(quiz.quizId)}#tools`} className={chip(query.calib === quiz.quizId)}>校準報告</PageNavLink>
                </div>)}
              {extrasError ? <p role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm">{extrasError}</p> : null}
              {calibration ? <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[32rem] text-sm">
                  <thead><tr className="border-b border-border text-left"><th className="py-2">AI 信心</th><th>題數</th><th>你親自評分</th><th>與 AI 一致</th><th>一致率</th></tr></thead>
                  <tbody>{calibration.map(row => <tr key={row.label} className="border-b border-border">
                    <td className="py-2 font-bold">{row.label}</td><td>{row.total}</td><td>{row.teacherChecked}</td><td>{row.teacherAgreed}</td>
                    <td>{row.teacherChecked ? `${Math.round(row.teacherAgreed / row.teacherChecked * 100)}%` : '尚無資料'}</td></tr>)}</tbody>
                </table>
                <p className="mt-2 text-sm text-muted-foreground">門檻選項：{CONFIDENCE_BUCKETS.map(bucket => bucket.label).join('、')}。一致率沒有資料時，請先在抽查清單確認幾題，再回來看。</p>
              </div> : null}
              {query.spot ? <div className="mt-4 space-y-4">
                <p className="text-sm font-bold">抽查清單：共 {spotItems.length} 題（每班信心最低的 10 題）。你改分後，該題會記為你親自覆核。</p>
                {spotItems.length === 0 ? <p className="rounded-lg bg-muted p-3 text-sm">目前還沒有 AI 自動採用且需要抽查的題目。</p> : null}
                {spotItems.map(item => {
                  const answer = item.attempt.answers.find(entry => entry.id === item.answerId)!;
                  return <article key={item.answerId} className="rounded-xl border border-border p-4 text-sm leading-6">
                    <p className="font-black">{item.classCode} 班 {item.attempt.seatNumber} 號 · {answer.questionKey} · {answer.prompt}（{answer.maxScore} 分）</p>
                    <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-muted p-3">學生作答：{answer.rawAnswer}</p>
                    <p className="mt-1 break-words font-mono text-muted-foreground">參考答案：{answer.textbookAnswer}</p>
                    <p className="mt-2 font-bold text-primary">AI 給 {answer.finalScore} 分 · 信心 {Math.round(item.confidence * 100)}%：{answer.aiReview?.reason}</p>
                    <TeacherScoreForm answerId={answer.id} updatedAt={answer.updatedAt} maxScore={answer.maxScore}
                      initialScore={answer.finalScore} allowAi={false} savedAi={answer.aiReview} />
                  </article>;
                })}
              </div> : null}
          </details>
          <details className="surface-card" open>
            <summary className="cursor-pointer text-xl font-black">匯出已定稿成績</summary>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">「貼表格用」只有座號與分數兩欄，依座號排好、缺考留空白，開啟後直接複製分數欄貼進平時成績表。「完整 CSV」含測驗名稱、提交時間等欄位。只包含已定稿的分數；尚未定稿者不會當作 0 分。請勿公開檔案。</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {quizzes.filter(quiz => quiz.status === 'published' || quiz.status === 'closed' || quiz.status === 'archived').flatMap(quiz => quiz.targets.map(target => (
                <span key={`${quiz.quizId}:${quiz.version}:${target.classCode}`} className="inline-flex flex-wrap gap-2">
                  <a href={`/api/teacher/grades/export?quiz=${encodeURIComponent(quiz.quizId)}&version=${quiz.version}&class=${target.classCode}&format=column`}
                    className="inline-flex min-h-11 items-center rounded-lg bg-primary px-3 text-sm font-bold text-primary-foreground">
                    {target.classCode} · {quiz.title} 貼表格用
                  </a>
                  <a href={`/api/teacher/grades/export?quiz=${encodeURIComponent(quiz.quizId)}&version=${quiz.version}&class=${target.classCode}`}
                    className="inline-flex min-h-11 items-center rounded-lg border border-primary px-3 text-sm font-bold text-primary hover:bg-muted">
                    完整 CSV
                  </a>
                </span>
              )))}
            </div>
          </details>
          {releasable.length ? <details className="surface-card">
            <summary className="cursor-pointer text-xl font-black">測驗後發布學生回饋（練習測驗）</summary>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {releasable.map(quiz =>
                <ReleaseFeedback key={`${quiz.quizId}:${quiz.version}`} quizId={quiz.quizId} version={quiz.version} title={quiz.title} />)}
            </div>
          </details> : null}
        </div> : null}
      </div>
      <a href="#top" aria-label="回到頁面頂端"
        className="fixed bottom-4 left-4 z-40 inline-flex min-h-12 items-center rounded-full bg-[#12313e] px-5 text-sm font-black text-white shadow-lg">
        ↑ 回頂端
      </a>
    </main>
  );
}
