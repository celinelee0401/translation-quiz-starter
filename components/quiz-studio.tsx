'use client';

import { PageNavLink } from '@/components/page-nav-link';
import { useEffect, useMemo, useState } from 'react';
import { DraftTargetForm } from '@/components/draft-target-form';
import { ConfirmQuizContent } from '@/components/confirm-quiz-content';
import { PublishQuiz } from '@/components/publish-quiz';
import { StudentLink } from '@/components/student-link';
import { TeacherLogout } from '@/components/teacher-logout';
import { ReopenClassTarget } from '@/components/reopen-class-target';
import { AdjustClassTarget } from '@/components/adjust-class-target';
import { UnpublishQuiz } from '@/components/unpublish-quiz';
import { ArchiveQuiz } from '@/components/archive-quiz';
import { NewQuizDraft } from '@/components/new-quiz-draft';
import { SemesterImport } from '@/components/semester-import';
import { BatchConfirm } from '@/components/batch-confirm';
import { ConfirmGenericRubric } from '@/components/confirm-generic-rubric';
import type { AutoFinalizeSetting } from '@/lib/server/auto-finalize';

import { getReleaseChecks } from '@/lib/release-readiness';
import { canArchiveQuiz, compareQuizTitles, draftNextStep, quizGroup, quizMatchesQuery, targetPhase, type QuizGroup } from '@/lib/quiz-management';
import type { TeacherQuiz } from '@/lib/server/teacher-overview';
import { useSchoolSettings } from '@/components/school-settings-provider';
import { gradeLevelsOf } from '@/lib/school-settings';

type View = 'current' | 'draft' | 'upcoming' | 'active' | 'ended' | 'archived' | 'sample' | 'all';
const sampleId = 'G8-DEMO-SCHOOL-DAY-01';
const views: Array<[View, string]> = [
  ['current', '待處理／進行中'], ['draft', '待發布草稿'], ['upcoming', '已發布 · 尚未開放'], ['active', '進行中'],
  ['ended', '已結束'], ['archived', '已封存'], ['sample', '內建示範題'], ['all', '全部未封存'],
];
const phaseLabel = { upcoming: '尚未開放', active: '進行中', ended: '已截止' } as const;
const phaseClass = { upcoming: 'bg-sky-100 text-sky-900', active: 'bg-emerald-100 text-emerald-900', ended: 'bg-amber-100 text-amber-900' } as const;

function inView(quiz: TeacherQuiz, view: View, now: number): boolean {
  const group = quizGroup(quiz, now);
  const sample = quiz.quizId === sampleId;
  if (view === 'sample') return sample;
  if (view === 'archived') return group === 'archived';
  if (view === 'ended') return group === 'ended';
  if (view === 'all') return group !== 'archived';
  if (sample) return false;
  if (view === 'current') return group === 'draft' || group === 'upcoming' || group === 'active';
  return group === view;
}


const groupBadge: Record<QuizGroup, { label: string; className: string }> = {
  draft: { label: '草稿 · 未發布', className: 'bg-slate-200 text-slate-800' },
  upcoming: { label: '已發布 · 尚未開放', className: 'bg-sky-100 text-sky-900' },
  active: { label: '進行中', className: 'bg-emerald-100 text-emerald-900' },
  ended: { label: '已結束', className: 'bg-amber-100 text-amber-900' },
  archived: { label: '已封存', className: 'bg-zinc-200 text-zinc-700' },
};
const gradeStorageKey = 'quiz-studio:grade';

export function QuizStudio({ quizzes, overviewError, now: renderedAt, autoSettings = {} }: {
  quizzes: TeacherQuiz[];
  overviewError: string | null;
  now: number;
  autoSettings?: Record<string, AutoFinalizeSetting>;
}) {
  const schoolSettings = useSchoolSettings();
  const gradeLevels = gradeLevelsOf(schoolSettings);
  const taipeiDateTime = new Intl.DateTimeFormat('zh-TW', {
    timeZone: schoolSettings.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const [view, setView] = useState<View>('current');
  // 頁面開著時也要跟著時間走：班級到了截止時間要自動變成「已截止」並出現補考操作。
  const [now, setNow] = useState(renderedAt);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const [grade, setGradeState] = useState('all');
  useEffect(() => {
    try {
      const saved = localStorage.getItem(gradeStorageKey);
      if (saved && gradeLevels.map(String).includes(saved)) setGradeState(saved);
    } catch { /* 私密瀏覽或停用儲存時略過 */ }
  }, []);
  const setGrade = (value: string) => {
    setGradeState(value);
    try { localStorage.setItem(gradeStorageKey, value); } catch { /* 略過 */ }
  };
  const [classCode, setClassCode] = useState('all');
  const [sort, setSort] = useState('time');
  const [query, setQuery] = useState('');
  const [readyOnly, setReadyOnly] = useState(false);
  const classes = useMemo(() => [...new Set(quizzes.flatMap(quiz => quiz.targets.map(target => target.classCode)))].sort(), [quizzes]);
  const nextSteps = useMemo(() => new Map(quizzes.map(quiz => [quiz, draftNextStep(quiz, new Date(now))])), [quizzes, now]);
  const isReadyDraft = (quiz: TeacherQuiz) => quiz.status === 'draft' && nextSteps.get(quiz) === null;
  // 年段、班級、搜尋三個條件；狀態分類另外算，才能在每個分類上顯示符合份數。
  const filtered = quizzes.filter(quiz =>
    (grade === 'all' || String(quiz.grade) === grade) &&
    (classCode === 'all' || quiz.targets.some(target => target.classCode === classCode)) &&
    quizMatchesQuery(quiz, query));
  const counts = Object.fromEntries(views.map(([value]) => [value, filtered.filter(quiz => inView(quiz, value, now)).length])) as Record<View, number>;
  const readyCount = filtered.filter(quiz => inView(quiz, 'draft', now) && isReadyDraft(quiz)).length;
  const canFilterReady = view === 'current' || view === 'draft' || view === 'all';
  const visibleQuizzes = filtered.filter(quiz => inView(quiz, view, now) && (!readyOnly || !canFilterReady || isReadyDraft(quiz))).sort((a, b) => {
    // 待發布草稿：可直接發布的排最前面，不必往下一份份找。
    if (view === 'draft' && isReadyDraft(a) !== isReadyDraft(b)) return isReadyDraft(a) ? -1 : 1;
    if (sort === 'grade') return a.grade - b.grade || compareQuizTitles(a, b);
    if (sort === 'class') return (a.targets[0]?.classCode ?? '999').localeCompare(b.targets[0]?.classCode ?? '999') || compareQuizTitles(a, b);
    if (sort === 'name') return compareQuizTitles(a, b);
    const aTime = a.targets.length ? Math.min(...a.targets.map(target => Date.parse(target.opensAt))) : Date.parse(a.createdAt ?? '') || 0;
    const bTime = b.targets.length ? Math.min(...b.targets.map(target => Date.parse(target.opensAt))) : Date.parse(b.createdAt ?? '') || 0;
    return bTime - aTime || compareQuizTitles(a, b);
  });
  const otherMatches = query.trim() && visibleQuizzes.length === 0
    ? views.filter(([value]) => value !== view && value !== 'current' && value !== 'all' && counts[value] > 0) : [];
  const anchorId = (quiz: TeacherQuiz) => `quiz-${quiz.quizId}-${quiz.version}`;
  return (
    <main id="top" className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-[#12313e] text-white">
        <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
          <div>
            <p className="text-sm font-bold tracking-[0.16em] text-cyan-300">
              TEACHER QUIZ STUDIO
            </p>
            <h1 className="mt-2 font-heading text-3xl font-black sm:text-4xl">
              句子翻譯測驗工作區
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-slate-200">
              在這裡核對考卷、設定各班時段、發布測驗並覆核成績。
              學生區只顯示已發布且開放中的測驗，不顯示答案。
            </p>
          </div>
        </div>
      </header>
      <div className="sticky top-0 z-30 border-b border-cyan-900 bg-[#12313e] shadow-md">
        <nav className="mx-auto flex max-w-6xl flex-wrap gap-2 px-5 py-2 text-sm sm:px-8" aria-label="教師操作入口">
            <a href="#import" className="inline-flex min-h-11 items-center rounded-xl bg-cyan-300 px-4 font-black text-slate-950">新增／匯入測驗</a>
            <a href="#manage" className="inline-flex min-h-11 items-center rounded-xl border border-cyan-300 px-4 font-black text-cyan-100">管理測驗</a>
            <PageNavLink href="/review" className="inline-flex min-h-11 items-center rounded-xl border border-cyan-300 px-4 font-black text-cyan-100">批改作答</PageNavLink>
            <PageNavLink href="/review#tools" className="inline-flex min-h-11 items-center rounded-xl border border-cyan-300 px-4 font-black text-cyan-100">成績與 CSV 匯出</PageNavLink>
            <a href="/roster" className="inline-flex min-h-11 items-center rounded-xl border border-cyan-300 px-4 font-black text-cyan-100">學生名冊與 PIN</a>
            <TeacherLogout />
        </nav>
      </div>

      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
        <section className="space-y-5">
          <div id="manage" className="surface-card scroll-mt-20">
            <p className="text-sm font-bold text-primary">測驗管理</p>
            <h2 className="mt-2 font-heading text-2xl font-black">考卷、班級時段與發布狀態</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              草稿可設定各班時段後發布；已發布測驗可新增班級，已截止的班級也可另排補考時段。封存不會刪除作答或成績。
            </p>
            <fieldset className="mt-5 flex flex-wrap gap-2" aria-label="年段">
              {([['all', '全部年段'], ...gradeLevels.map(level => [String(level), `G${level}`])] as Array<[string, string]>).map(([value, label]) =>
                <button key={value} type="button" onClick={() => setGrade(value)} aria-pressed={grade === value}
                  className={`min-h-12 rounded-lg px-5 text-base font-black ${grade === value ? 'bg-[#12313e] text-white' : 'border-2 border-[#12313e] text-[#12313e]'}`}>
                  {label}{value === 'all' ? '' : `（${quizzes.filter(quiz => String(quiz.grade) === value && quiz.status !== 'archived').length}）`}</button>)}
            </fieldset>
            <fieldset className="mt-3 flex flex-wrap gap-2" aria-label="測驗狀態">
              {views.map(([value, label]) =>
                <button key={value} type="button" onClick={() => setView(value)} aria-pressed={view === value}
                  className={`min-h-11 rounded-lg px-4 text-sm font-bold ${view === value ? 'bg-primary text-primary-foreground' : 'border border-border'} ${counts[value] === 0 && view !== value ? 'opacity-60' : ''}`}>
                  {label}（{counts[value]}{value === 'draft' && readyCount ? `｜可發布 ${readyCount}` : ''}）</button>)}
            </fieldset>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="text-sm font-bold">搜尋名稱／單元<input value={query} onChange={event => setQuery(event.target.value)}
                className="mt-1 h-11 w-full rounded-lg border border-border bg-white px-3" placeholder="例如 Unit 2、U2 對話、G9 Reading" /></label>
              <label className="text-sm font-bold">班級<select value={classCode} onChange={event => setClassCode(event.target.value)}
                className="mt-1 h-11 w-full rounded-lg border border-border bg-white px-3"><option value="all">全部班級</option>{classes.map(code => <option key={code} value={code}>{code}</option>)}</select></label>
              <label className="text-sm font-bold">排列方式<select value={sort} onChange={event => setSort(event.target.value)}
                className="mt-1 h-11 w-full rounded-lg border border-border bg-white px-3"><option value="time">依開放時間</option><option value="class">依班級</option><option value="grade">依年級</option><option value="name">依名稱（U1→U6）</option></select></label>
            </div>
            {canFilterReady ? (
              <label className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-bold">
                <input type="checkbox" checked={readyOnly} onChange={event => setReadyOnly(event.target.checked)} className="size-4" />
                只看「檢查已通過、可直接發布」的草稿（目前 {readyCount} 份）
              </label>
            ) : null}
            <BatchConfirm candidates={quizzes.filter(quiz => quiz.status === 'draft' && quiz.scoreMode === 'formal' &&
              quiz.questions.length > 0 && (!quiz.contentApproval || (quiz.quizId.startsWith('CUSTOM-') && !quiz.rubricApproval)))
              .map(quiz => ({ quizId: quiz.quizId, version: quiz.version, title: quiz.title, grade: quiz.grade,
                questionCount: quiz.questions.length, total: quiz.questions.reduce((sum, question) => sum + question.points, 0),
                needsContent: !quiz.contentApproval, needsRubric: quiz.quizId.startsWith('CUSTOM-') && !quiz.rubricApproval }))} />
            {overviewError ? (
              <output className="mt-4 block rounded-xl bg-amber-50 p-4 text-sm text-amber-950">{overviewError}</output>
            ) : quizzes.length === 0 ? (
              <p className="mt-4 rounded-xl bg-muted p-4 text-sm">後端目前沒有測驗草稿。</p>
            ) : (
              <div className="mt-4 space-y-3">
                <p className="text-sm text-muted-foreground">符合條件：{visibleQuizzes.length} 份。已封存與內建示範題預設不顯示；可用上方分類找回。搜尋不分大小寫，「Unit 2」「第二課」都會找到 U2。</p>
                {visibleQuizzes.length === 0 ? (
                  <div className="rounded-lg bg-muted p-4 text-sm">
                    {otherMatches.length ? <>
                      <p>這個分類沒有符合「{query.trim()}」的測驗，但其他分類有：</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {otherMatches.map(([value, label]) => <button key={value} type="button" onClick={() => setView(value)}
                          className="min-h-11 rounded-lg border border-primary bg-white px-3 font-bold text-primary">{label}（{counts[value]}）→</button>)}
                      </div>
                    </> : <p>這個分類目前沒有測驗，請切換條件或新增草稿。</p>}
                  </div>
                ) : null}
                {visibleQuizzes.length > 4 ? (
                  <nav aria-label="快速跳到測驗" className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                    <p className="font-black">快速跳到（{visibleQuizzes.length} 份）</p>
                    <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                      {visibleQuizzes.map(quiz => {
                        const nextStep = nextSteps.get(quiz);
                        return <li key={anchorId(quiz)}>
                          <a href={`#${anchorId(quiz)}`} className="flex min-h-9 items-center gap-2 rounded px-2 hover:bg-white">
                            <span className={`shrink-0 rounded-full px-2 text-xs font-black ${quiz.status === 'draft' ? (nextStep ? 'bg-slate-200 text-slate-800' : 'bg-emerald-600 text-white') : groupBadge[quizGroup(quiz, now)].className}`}>
                              {quiz.status === 'draft' ? (nextStep ? '草稿' : '可發布') : groupBadge[quizGroup(quiz, now)].label}</span>
                            <span className="truncate font-bold text-primary underline">{quiz.title}</span>
                          </a>
                        </li>;
                      })}
                    </ul>
                  </nav>
                ) : null}
                {visibleQuizzes.map((quiz) => (
                  <article key={`${quiz.quizId}:${quiz.version}`} id={anchorId(quiz)} className="scroll-mt-24 rounded-xl border border-border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="font-black">{quiz.title}</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          G{quiz.grade} · {quiz.scoreMode === 'formal' ? '正式平時成績' : '練習成績'} · 版本 {quiz.version}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          回饋：{quiz.scoreMode === 'formal' && quiz.feedbackPolicy === 'teacher-release' ? '交卷後本班時段內即時暫定回饋；截止後是否保留依各班設定' : quiz.feedbackPolicy === 'teacher-release' ? '教師手動發布' : quiz.feedbackPolicy === 'class-closed' ? '各班截止後' : quiz.feedbackPolicy === 'all-closed' ? '所有班截止後' : '交卷後本班時段內即時回饋'}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-3 py-1 text-sm font-black ${quiz.grade === 8 ? 'bg-teal-700 text-white' : 'bg-indigo-700 text-white'}`}>G{quiz.grade}</span>
                        <span className={`rounded-full px-3 py-1 text-sm font-black ${groupBadge[quizGroup(quiz, now)].className}`}>
                          {groupBadge[quizGroup(quiz, now)].label}
                        </span>
                        {quiz.status === 'draft' ? (nextSteps.get(quiz)
                          ? <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-black text-amber-950">下一步：{nextSteps.get(quiz)}</span>
                          : <span className="rounded-full bg-emerald-600 px-3 py-1 text-sm font-black text-white">✓ 檢查通過，可發布</span>) : null}
                      </div>
                    </div>
                    {quiz.status === 'published' ? <StudentLink quizId={quiz.quizId} version={quiz.version} /> : null}
                    {quiz.targets.length ? (
                      <ul className="mt-3 space-y-2 text-sm leading-6">
                        {quiz.targets.map((target) => {
                          const phase = targetPhase(target, now);
                          return (
                          <li key={target.classCode} className="rounded-lg bg-muted px-3 py-2">
                            <b>{target.classCode}</b> · {taipeiDateTime.format(new Date(target.opensAt))}－{taipeiDateTime.format(new Date(target.closesAt))}
                            {quiz.status === 'published' && target.dashboardVisible
                              ? <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-black ${phaseClass[phase]}`}>{phaseLabel[phase]}</span>
                              : <span className="ml-2 font-bold">{target.dashboardVisible ? '已發布 · 開放時顯示' : '未發布'}</span>}
                            <span className="ml-2 font-bold">每人 {target.attemptLimit ?? 1} 次</span>
                            {quiz.status === 'published' && quiz.scoreMode === 'formal' && quiz.feedbackPolicy === 'teacher-release' && target.dashboardVisible ?
                              <span className="ml-2 font-bold text-emerald-800">{target.feedbackAt ? '本班時段內交卷即回饋，截止後保留答案與訂正' : '本班時段內交卷即回饋，截止後收回'}</span> : null}
                            {quiz.status === 'published' && target.dashboardVisible &&
                              now >= Date.parse(target.closesAt) &&
                              !target.feedbackAt &&
                              (quiz.scoreMode === 'practice' || quiz.feedbackPolicy === 'teacher-release') ?
                              ((target.attemptLimit ?? 1) === 1
                                ? <ReopenClassTarget quizId={quiz.quizId} quizVersion={quiz.version} classCode={target.classCode} />
                                : <p className="mt-1 text-sm text-muted-foreground">此班設定每人 {target.attemptLimit} 次，不能套用缺考補考時段。</p>) : null}
                            {quiz.status === 'published' && target.dashboardVisible && phase === 'ended' &&
                              (target.feedbackAt || (quiz.scoreMode === 'formal' && quiz.feedbackPolicy !== 'teacher-release')) ?
                              <p className="mt-1 text-sm text-muted-foreground">
                                {target.feedbackAt ? '此班截止後保留答案給已交卷學生，不能再開補考時段（會洩漏答案）。' : '這份測驗的回饋政策不支援補考時段。'}
                              </p> : null}
                            {quiz.status === 'published' && target.dashboardVisible && phase !== 'ended' ?
                              <AdjustClassTarget quizId={quiz.quizId} quizVersion={quiz.version} classCode={target.classCode}
                                phase={phase} opensAt={target.opensAt} closesAt={target.closesAt} attemptLimit={target.attemptLimit ?? 1}
                                showsAnswers={quiz.feedbackPolicy === 'immediate' || (quiz.scoreMode === 'formal' && quiz.feedbackPolicy === 'teacher-release')} /> : null}
                          </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="mt-3 text-sm text-muted-foreground">尚未設定目標班級。</p>
                    )}
                    <details open={quiz.status === 'draft' && visibleQuizzes.length <= 3} className="mt-3 rounded-lg bg-muted/40 p-2">
                      <summary className="min-h-11 cursor-pointer px-2 py-2 font-black text-primary">
                        {quiz.status === 'draft' ? '設定、核對與發布' : '核對題目、預覽與新增班級'}
                      </summary>
                    {quiz.status === 'draft' ? (
                      <details className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                        <summary className="cursor-pointer font-black">發布前檢查 · 仍不可開放學生</summary>
                        <p className="mt-2 leading-6">這是唯讀檢查，不是發布核准；「需教師確認」項目不會由系統自動通過。</p>
                        <ul className="mt-2 space-y-2">
                          {getReleaseChecks(quiz).map((check) => (
                            <li key={check.label} className="rounded-lg border border-amber-200 bg-white p-2 leading-6">
                              <b>{check.state === 'pass' ? '已檢查' : check.state === 'manual' ? '需教師確認' : '待補'} · {check.label}</b>
                              <span className="block">{check.detail}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                    <details className="mt-3 rounded-lg border border-border p-3">
                      <summary className="cursor-pointer font-bold">核對 {quiz.questions.length} 題與配分</summary>
                      <ol className="mt-3 space-y-4">
                        {quiz.questions.map((question) => (
                          <li key={question.key} className="border-t border-border pt-3 text-sm leading-6">
                            <p className="font-black">{question.key} · {question.prompt}（{question.points} 分）</p>
                            <p className="mt-2 break-words rounded-lg bg-muted p-3 font-mono">{question.answer}</p>
                            <p className="mt-2">💡 {question.hint}</p>
                            {question.rubric.length ? (
                              <ul className="mt-2 space-y-1 text-muted-foreground">
                                {question.rubric.map((unit) => (
                                  <li key={unit.label}><b>{unit.label} {unit.points} 分：</b>{unit.requirement}</li>
                                ))}
                              </ul>
                            ) : <p className="mt-1 text-muted-foreground">評分單位待檢查</p>}
                          </li>
                        ))}
                      </ol>
                    </details>
                    {quiz.scoreMode === 'formal' ? (
                      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                        <a href={`/quiz?preview=1&quiz=${encodeURIComponent(quiz.quizId)}&version=${quiz.version}`}
                          className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 font-black text-primary-foreground">
                          預覽這份測驗的學生作答畫面
                        </a>
                        {quiz.contentApproval ? (
                          <span className="font-bold text-emerald-800">
                            {quiz.rubricApproval
                              ? quiz.studentE2E
                                ? `題目、配分、固定規則與共用 PIN 學生流程皆已驗收（${quiz.studentE2E.version}）`
                                : `題目、配分與固定規則評分引擎已確認（${quiz.rubricApproval.version}）；仍待學生端驗收`
                              : '題目與配分已確認；評分細則仍待審定'}
                          </span>
                        ) : <span className="text-muted-foreground">題目與配分尚無核定紀錄</span>}
                      </div>
                    ) : null}
                    {quiz.status === 'draft' && quiz.scoreMode === 'formal' && !quiz.contentApproval ? (
                      <ConfirmQuizContent quizId={quiz.quizId} quizVersion={quiz.version} />
                    ) : null}
                    {quiz.status === 'draft' && quiz.scoreMode === 'formal' && quiz.quizId.startsWith('CUSTOM-') &&
                      quiz.contentApproval && !quiz.rubricApproval ?
                      <ConfirmGenericRubric quizId={quiz.quizId} quizVersion={quiz.version} /> : null}
                    {quiz.status === 'draft' ? (
                      <DraftTargetForm quizId={quiz.quizId} quizVersion={quiz.version} grade={quiz.grade} />
                    ) : null}
                    {quiz.status === 'published' &&
                      (quiz.scoreMode === 'practice' || quiz.feedbackPolicy === 'teacher-release') ? (
                      <DraftTargetForm quizId={quiz.quizId} quizVersion={quiz.version} grade={quiz.grade}
                        mode="published" existingClasses={quiz.targets.map(target => target.classCode)} />
                    ) : null}
                    {quiz.status === 'draft' ? (
                      <PublishQuiz quizId={quiz.quizId} quizVersion={quiz.version}
                        classes={quiz.targets.map(target => target.classCode)}
                        ready={getReleaseChecks(quiz).every(check => check.state === 'pass')} />
                    ) : null}
                    </details>
                    {quiz.status === 'published' ?
                      <UnpublishQuiz quizId={quiz.quizId} quizVersion={quiz.version} title={quiz.title} /> : null}
                    {quiz.status === 'published' || quiz.status === 'closed' ?
                      <p className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
                        <b>自動定稿：{(autoSettings[`${quiz.quizId}:${quiz.version}`]?.enabled ?? true) ? '開啟中' : '已關閉'}</b>
                        <span>批改、抽查與匯出都在批改頁。</span>
                        <PageNavLink href="/review" className="font-black text-primary underline">到批改頁 →</PageNavLink>
                      </p> : null}
                    {quiz.targets.length > 0 ?
                      <div className="mt-3 flex flex-wrap gap-2 text-sm">
                        {quiz.targets.map(target => <span key={target.classCode} className="inline-flex flex-wrap gap-2">
                          <a href={`/api/teacher/grades/export?quiz=${encodeURIComponent(quiz.quizId)}&version=${quiz.version}&class=${target.classCode}&format=column`}
                            className="inline-flex min-h-11 items-center rounded-lg bg-primary px-3 font-bold text-primary-foreground">
                            {target.classCode} 貼表格用（座號＋分數）</a>
                          <a href={`/api/teacher/grades/export?quiz=${encodeURIComponent(quiz.quizId)}&version=${quiz.version}&class=${target.classCode}`}
                            className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 font-bold text-primary">
                            {target.classCode} 完整 CSV</a></span>)}
                      </div> : null}
                    {(quiz.status === 'archived' || canArchiveQuiz(quiz, now)) ?
                      <ArchiveQuiz quizId={quiz.quizId} version={quiz.version} archived={quiz.status === 'archived'} /> : null}
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
        <section id="import" className="surface-card mt-6 scroll-mt-20">
          <h2 className="mb-4 text-2xl font-black">新增／匯入測驗草稿</h2>
          <SemesterImport existingTitles={quizzes.map(quiz => quiz.title)} />
          <div className="mt-4"><NewQuizDraft /></div>
        </section>
      </div>
      <a href="#top" aria-label="回到頁面頂端"
        className="fixed bottom-4 left-4 z-40 inline-flex min-h-12 items-center rounded-full bg-[#12313e] px-5 text-sm font-black text-white shadow-lg">
        ↑ 回頂端
      </a>
    </main>
  );
}
