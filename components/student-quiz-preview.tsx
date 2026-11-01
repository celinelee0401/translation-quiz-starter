'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSchoolSettings } from '@/components/school-settings-provider';
import { classCodesForQuizId } from '@/lib/school-settings';

type Phase = 'checking' | 'login' | 'quiz' | 'complete';
type PublicSession = {
  schoolYear: string;
  classCode: string;
  seatNumber: number;
  gradeLevel: number;
  expiresAt: number;
};

type ApiResult = {
  status?: string;
  error?: string;
  session?: PublicSession;
  attempt?: { attemptId?: string; quizId?: string; quizVersion?: number; status?: string };
  quiz?: StudentQuiz;
  result?: StudentResult;
};

type StudentResult = {
  status: 'pending' | 'provisional' | 'released' | 'expired';
  title: string;
  submittedAt: string;
  score?: number | null;
  maxScore?: number;
  knownScore?: number;
  pendingMaxScore?: number;
  pendingCount?: number;
  endsAt?: string | null;
  availableAt?: string | null;
  appealAllowed?: boolean;
  aiScored?: boolean;
  details?: Array<{ answerId: string; aiFinal?: boolean; questionKey: string; prompt: string; rawAnswer: string; score: number | null; maxScore: number; scoreState: 'final' | 'suggested' | 'pending'; explanation: string | null; textbookAnswer: string | null }>;
};

type StudentQuiz = {
  id: string;
  version: number;
  title: string;
  scoreMode: 'practice' | 'formal';
  questions: Array<{ id: string; prompt: string }>;
};
type PendingSubmission = {
  key: string;
  answers: Array<{ questionId: string; rawAnswer: string }>;
};

export function StudentQuizPreview({
  previewQuiz,
  quizId,
  quizVersion,
  autoPreview = false,
  loginMode = 'pin',
}: {
  previewQuiz: StudentQuiz | null;
  quizId: string | null;
  quizVersion: number;
  autoPreview?: boolean;
  loginMode?: 'seat' | 'pin';
}) {
  const usesPin = loginMode === 'pin';
  const schoolSettings = useSchoolSettings();
  const schoolTimeZone = schoolSettings.timeZone;
  const classOptions = useMemo(() => classCodesForQuizId(schoolSettings, quizId), [schoolSettings, quizId]);
  const [phase, setPhase] = useState<Phase>(autoPreview ? 'quiz' : quizId ? 'checking' : 'login');
  const [classCode, setClassCode] = useState(classOptions[0] ?? '');
  const [seatNumber, setSeatNumber] = useState('');
  const [pin, setPin] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [activeQuiz, setActiveQuiz] = useState<StudentQuiz | null>(autoPreview ? previewQuiz : null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(autoPreview);
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [pendingSubmission, setPendingSubmission] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<StudentResult | null>(null);
  const [appealNotes, setAppealNotes] = useState<Record<string, string>>({});
  const [appealStates, setAppealStates] = useState<Record<string, string>>({});
  // Chinese/Japanese IME candidate bars are drawn by the OS and cannot be turned
  // off from a web page, so we only remind students to switch keyboards.
  const [imeQuestion, setImeQuestion] = useState<string | null>(null);

  useEffect(() => {
    if (!classOptions.includes(classCode)) setClassCode(classOptions[0] ?? '');
  }, [classCode, classOptions]);

  useEffect(() => {
    if (!result?.endsAt) return;
    const expires = Date.parse(result.endsAt);
    const hide = () => {
      if (Date.now() >= expires) setResult({ status: 'expired', title: result.title, submittedAt: result.submittedAt });
    };
    hide();
    const timer = window.setTimeout(hide, Math.max(0, Math.min(expires - Date.now() + 50, 2_147_483_647)));
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pageshow', hide);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', hide); window.removeEventListener('pageshow', hide); };
  }, [result]);

  const latestResult = useCallback(async (): Promise<StudentResult | null> => {
    if (!quizId) return null;
    try {
      const scored = await fetch('/api/attempts/score', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quizId, version: quizVersion }), cache: 'no-store' });
      const scoredBody = await scored.json() as ApiResult;
      if (scored.ok && scoredBody.result) return scoredBody.result;
      const response = await fetch(`/api/attempts/result?quiz=${encodeURIComponent(quizId)}&version=${quizVersion}`, { cache: 'no-store' });
      const body = await response.json() as ApiResult;
      return response.ok ? body.result ?? null : null;
    } catch { return null; }
  }, [quizId, quizVersion]);

  const questions = activeQuiz?.questions ?? [];
  const answeredCount = questions.filter((question) => answers[question.id]?.trim()).length;

  const draftKey = `${activeQuiz?.id ?? quizId ?? 'preview'}:${activeQuiz?.version ?? quizVersion}:${classCode}:${seatNumber || 'preview'}`;

  const restoreDraft = useCallback((key: string, quizQuestions: StudentQuiz['questions'], currentAttemptId?: string) => {
    if (currentAttemptId) {
      const pending = readPendingSubmission(`${key}:${currentAttemptId}:pending`, quizQuestions);
      if (pending) {
        setAnswers(Object.fromEntries(pending.answers.map((answer) => [answer.questionId, answer.rawAnswer])));
        setRestoredDraft(true);
        setPendingSubmission(true);
        return;
      }
    }
    const stored = localStorage.getItem(key);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as Record<string, unknown>;
      const restored: Record<string, string> = {};
      for (const question of quizQuestions) {
        const value = parsed[question.id];
        restored[question.id] = typeof value === 'string' ? value : '';
      }
      setAnswers(restored);
      setRestoredDraft(
        Object.values(restored).some((value) => value.length > 0),
      );
    } catch {
      localStorage.removeItem(key);
    }
  }, []);

  const beginAttempt = useCallback(
    async (session: PublicSession) => {
      if (!quizId) return;
      setMessage('');
      try {
        const resultResponse = await fetch(`/api/attempts/result?quiz=${encodeURIComponent(quizId)}&version=${quizVersion}`, { cache: 'no-store' });
        const resultBody = (await resultResponse.json().catch(() => ({}))) as ApiResult;
        if (resultResponse.ok && resultBody.result) {
          setResult(resultBody.result.status === 'provisional' && resultBody.result.score === null
            ? await latestResult() ?? resultBody.result : resultBody.result);
          setPhase('complete');
          return;
        }
        if (resultResponse.status !== 404) throw new Error(resultBody.error || '目前無法確認是否已有作答，請稍後再試。');
        const response = await fetch('/api/attempts/start', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            quizId,
            quizVersion,
          }),
        });
        const body = (await response.json().catch(() => ({}))) as ApiResult;
        if (!response.ok || !body.attempt?.attemptId || body.attempt.quizId !== quizId ||
            body.attempt.quizVersion !== quizVersion || !isStudentQuiz(body.quiz, quizId, quizVersion)) {
          throw new Error(body.error || '目前無法開始這份測驗。');
        }
        const loadedQuiz = body.quiz;
        setAnswers({});
        setRestoredDraft(false);
        setPendingSubmission(false);
        setClassCode(session.classCode);
        setSeatNumber(String(session.seatNumber));
        setAttemptId(body.attempt.attemptId);
        setActiveQuiz(loadedQuiz);
        restoreDraft(
          `${loadedQuiz.id}:${loadedQuiz.version}:${session.classCode}:${session.seatNumber}`,
          loadedQuiz.questions,
          body.attempt.attemptId,
        );
        setPhase('quiz');
      } catch (error) {
        const baseKey = `${quizId}:${quizVersion}:${session.classCode}:${session.seatNumber}`;
        const pendingPointerKey = `${baseKey}:pending-attempt`;
        const pendingAttemptId = localStorage.getItem(pendingPointerKey);
        const pendingKey = pendingAttemptId ? `${baseKey}:${pendingAttemptId}:pending` : null;
        const pending = pendingKey ? readPendingSubmission(pendingKey) : null;
        if (pendingAttemptId && pendingKey && pending) {
          try {
            const response = await fetch('/api/attempts/submit', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ attemptId: pendingAttemptId, idempotencyKey: pending.key, answers: pending.answers }),
            });
            const result = (await response.json().catch(() => ({}))) as ApiResult;
            if (response.ok && result.status === 'ok' && result.attempt?.status === 'submitted') {
              localStorage.removeItem(baseKey);
              localStorage.removeItem(pendingKey);
              localStorage.removeItem(pendingPointerKey);
              setResult(await latestResult() ?? { status: 'pending', title: '句子翻譯測驗', submittedAt: new Date().toISOString() });
              setPhase('complete');
              return;
            }
          } catch {
            // Keep the same submission snapshot for a later confirmation retry.
          }
        }
        setMessage(
          pending ? '上次送出狀態尚未確認，請保留此裝置資料並稍後重新登入確認。' :
            error instanceof Error ? error.message : '目前無法開始測驗。',
        );
        setPhase('login');
      }
    },
    [quizId, quizVersion, restoreDraft, latestResult],
  );

  useEffect(() => {
    if (!quizId) return;
    let active = true;
    void fetch('/api/auth/session', { cache: 'no-store' })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as ApiResult;
        if (!active) return;
        if (response.ok && body.session) {
          setClassCode(body.session.classCode);
          setSeatNumber(String(body.session.seatNumber));
          await beginAttempt(body.session);
        } else {
          setPhase('login');
        }
      })
      .catch(() => {
        if (active) setPhase('login');
      });
    return () => {
      active = false;
    };
  }, [beginAttempt, quizId]);

  useEffect(() => {
    if (phase !== 'quiz') return;
    localStorage.setItem(draftKey, JSON.stringify(answers));
  }, [answers, draftKey, phase]);

  async function handleLogin(event: { preventDefault(): void }) {
    event.preventDefault();
    if (!quizId) {
      setMessage('尚未指定測驗，請使用老師給的作答連結進入。');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          classCode,
          seatNumber: Number(seatNumber),
          ...(usesPin ? { pin } : {}),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as ApiResult;
      if (!response.ok || !body.session) {
        throw new Error(body.error || '身分驗證失敗，請再試一次。');
      }
      setPin('');
      await beginAttempt(body.session);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '身分驗證失敗。');
    } finally {
      setBusy(false);
    }
  }

  function startPreview() {
    if (!previewQuiz) return;
    setPreviewMode(true);
    setActiveQuiz(previewQuiz);
    setAnswers({});
    setRestoredDraft(false);
    setPendingSubmission(false);
    const previewClass = classOptions[0] ?? 'preview';
    setClassCode(previewClass);
    setSeatNumber('1');
    restoreDraft(`${previewQuiz.id}:${previewQuiz.version}:${previewClass}:1`, previewQuiz.questions);
    setPhase('quiz');
    setResult(null);
  }

  async function logout() {
    setBusy(true);
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setBusy(false);
    setAttemptId(null);
    setActiveQuiz(null);
    setPendingSubmission(false);
    setPreviewMode(false);
    setPhase('login');
    setResult(null);
  }

  async function submit() {
    setMessage('');
    if (!activeQuiz || answeredCount !== activeQuiz.questions.length) {
      setMessage('請完成所有題目後再送出。');
      return;
    }
    if (previewMode) {
      setPhase('complete');
      return;
    }
    if (!attemptId) {
      setMessage('找不到這次作答紀錄，請重新登入。');
      return;
    }

    setBusy(true);
    try {
      const pendingKey = `${draftKey}:${attemptId}:pending`;
      const pendingPointerKey = `${draftKey}:pending-attempt`;
      let submission = readPendingSubmission(pendingKey, activeQuiz.questions);
      if (!submission) {
        submission = {
          key: crypto.randomUUID(),
          answers: activeQuiz.questions.map((question) => ({
            questionId: question.id,
            rawAnswer: answers[question.id] ?? '',
          })),
        };
        localStorage.setItem(pendingKey, JSON.stringify(submission));
      }
      localStorage.setItem(pendingPointerKey, attemptId);
      setPendingSubmission(true);
      const response = await fetch('/api/attempts/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          attemptId,
          idempotencyKey: submission.key,
          answers: submission.answers,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as ApiResult;
      if (!response.ok) {
        if (response.status < 500) {
          localStorage.removeItem(pendingKey);
          localStorage.removeItem(pendingPointerKey);
          setPendingSubmission(false);
        }
        throw new Error(body.error || '作答尚未儲存。');
      }
      if (body.status !== 'ok' || body.attempt?.status !== 'submitted') {
        throw new Error('伺服器回覆不完整，請保留頁面並重試確認。');
      }
      localStorage.removeItem(draftKey);
      localStorage.removeItem(pendingKey);
      localStorage.removeItem(pendingPointerKey);
      const shownResult = await latestResult();
      setResult(shownResult ?? { status: 'pending', title: activeQuiz.title, submittedAt: new Date().toISOString() });
      setPhase('complete');
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : '作答尚未儲存，請保留頁面並再試一次。',
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitAppeal(answerId: string) {
    if (!quizId) return;
    setAppealStates(current => ({ ...current, [answerId]: '送出中…' }));
    try {
      const response = await fetch('/api/attempts/appeal', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quizId, version: quizVersion, answerId, note: appealNotes[answerId] ?? '' }) });
      const body = await response.json() as { status?: string; error?: string };
      if (!response.ok || body.status !== 'ok') throw new Error(body.error || '尚未送達教師覆核區。');
      setAppealStates(current => ({ ...current, [answerId]: '已送交教師覆核，不會更動原始答案。' }));
    } catch (error) {
      setAppealStates(current => ({ ...current, [answerId]: error instanceof Error ? error.message : '送出失敗，請稍後再試。' }));
    }
  }

  if (!quizId && !previewQuiz) {
    return <main className="mx-auto max-w-xl px-5 py-16 text-center">
      <h1 className="font-heading text-2xl font-black">目前沒有指定測驗</h1>
      <p className="mt-4 leading-7">請使用老師給的作答連結進入；尚未發布的草稿無法作答。</p>
    </main>;
  }

  return (
    <main className="min-h-screen bg-background px-5 py-7 text-foreground sm:px-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          {previewQuiz ? <a href="/" className="font-black text-primary hover:underline">← 回教師工作區</a> : <span className="font-black text-primary">線上句子翻譯</span>}
          <span className="rounded-full bg-secondary px-3 py-1 text-sm font-black">
            {activeQuiz?.scoreMode === 'formal' ? '正式平時成績' : activeQuiz?.scoreMode === 'practice' ? '練習測驗' : '翻譯測驗'}
          </span>
        </div>

        {phase === 'checking' ? (
          <section className="surface-card text-center">
            <p className="font-black">正在確認登入狀態…</p>
          </section>
        ) : null}

        {phase === 'login' ? (
          <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <form onSubmit={handleLogin} className="surface-card space-y-5">
              <div>
                <h1 className="font-heading text-3xl font-black">
                  {activeQuiz?.title ?? '句子翻譯測驗'}
                </h1>
                <p className="mt-2 text-base leading-7 text-muted-foreground">
                  {usesPin ? '請輸入班級、座號和老師給你的六位數 PIN。' : '請選擇班級並輸入座號。'}
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="font-bold">
                  班級
                  <select
                    value={classCode}
                    onChange={(event) => setClassCode(event.target.value)}
                    className="mt-2 h-11 w-full rounded-xl border border-input bg-background px-3 text-base"
                  >
                    {classOptions.map((code) =>
                      <option key={code} value={code}>{code} 班</option>)}
                  </select>
                </label>
                <label className="font-bold">
                  座號
                  <input
                    value={seatNumber}
                    onChange={(event) => setSeatNumber(event.target.value)}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={99}
                    required
                    className="mt-2 h-11 w-full rounded-xl border border-input bg-background px-3 text-base"
                    placeholder="例如：12"
                  />
                </label>
              </div>
              {usesPin ? (
                <label className="block font-bold">
                  個人 PIN
                  <input
                    value={pin}
                    onChange={(event) =>
                      setPin(event.target.value.replace(/\D/g, ''))
                    }
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    autoComplete="current-password"
                    className="mt-2 h-11 w-full rounded-xl border border-input bg-background px-3 text-lg tracking-[0.24em]"
                    placeholder="六位數字"
                  />
                </label>
              ) : null}
              {message ? (
                <p
                  role="alert"
                  className="rounded-xl bg-rose-50 p-3 font-semibold text-rose-800"
                >
                  {message}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={busy}
                className="h-12 w-full rounded-xl bg-primary px-5 text-base font-black text-primary-foreground disabled:opacity-50"
              >
                {busy ? '正在驗證…' : '驗證後開始'}
              </button>
              {usesPin ? (
                <p className="text-center text-sm font-bold text-muted-foreground">
                  忘記 PIN？請找老師重設。
                </p>
              ) : null}
              {previewQuiz ? (
                <button
                  type="button"
                  onClick={startPreview}
                  className="h-12 w-full rounded-xl border border-border bg-background px-5 text-base font-black"
                >
                  只預覽作答介面（不驗證）
                </button>
              ) : null}
            </form>
            <aside className="space-y-4">
              <div className="rounded-2xl bg-[#12313e] p-5 text-white shadow-sm">
                <h2 className="text-xl font-black">{usesPin ? '你的 PIN 不會被看到' : '請輸入自己的座號'}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-200">
                  {usesPin ? '系統只保存無法逆向還原的 PIN 雜湊；連續輸錯 5 次會暫停 10 分鐘。' : '這是練習模式，作答紀錄會以你輸入的座號登記。'}
                </p>
              </div>
              <div className="surface-card">
                <h2 className="font-black">時間由伺服器確認</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  未到開放時間、已截止或不是目標班級，都不會允許開始。
                </p>
              </div>
            </aside>
          </section>
        ) : null}

        {phase === 'quiz' ? (
          <section className="space-y-5">
            <div className="surface-card">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <span className="rounded-full bg-secondary px-3 py-1 text-sm font-black">
                    {previewMode ? '教師預覽' : `${classCode} 班・${seatNumber} 號`}
                  </span>
                  <h1 className="mt-3 font-heading text-3xl font-black">
                    {activeQuiz?.title}
                  </h1>
                </div>
                <div className="text-right">
                  <p className="font-bold">
                    {answeredCount} / {questions.length} 題已作答
                  </p>
                  {!previewMode ? <button
                    type="button"
                    onClick={() => void logout()}
                    disabled={busy}
                    className="mt-2 text-sm font-black text-primary hover:underline"
                  >
                    登出
                  </button> : null}
                </div>
              </div>
              <div className="mt-5 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{
                    width: `${questions.length ? (answeredCount / questions.length) * 100 : 0}%`,
                  }}
                />
              </div>
              {restoredDraft && !pendingSubmission ? (
                <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
                  已恢復上次尚未提交的答案。
                </p>
              ) : null}
              {pendingSubmission ? (
                <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900">
                  上次送出結果尚待確認。請按原樣重試，系統會用同一筆送出紀錄核對；確認前無法修改答案。
                </p>
              ) : null}
              {previewMode ? (
                <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900">
                  目前是教師介面預覽，不會傳送答案或產生成績。
                </p>
              ) : null}
            </div>

            {questions.map((question, index) => (
              <article key={question.id} className="surface-card">
                <label
                  htmlFor={`answer-${question.id}`}
                  className="text-lg font-black leading-7"
                >
                  {index + 1}. {question.prompt}
                </label>
                <p className="mt-1 text-sm text-muted-foreground">
                  請輸入完整英文句子。
                </p>
                <textarea
                  id={`answer-${question.id}`}
                  value={answers[question.id] ?? ''}
                  disabled={pendingSubmission || busy}
                  onChange={(event) =>
                    setAnswers((current) => ({
                      ...current,
                      [question.id]: event.target.value,
                    }))
                  }
                  rows={3}
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="off"
                  autoComplete="off"
                  data-gramm="false"
                  onCompositionStart={() => setImeQuestion(question.id)}
                  className="mt-4 min-h-28 w-full rounded-xl border border-input bg-background p-3 text-lg leading-7"
                  placeholder="Type your answer here..."
                />
                {imeQuestion === question.id ? (
                  <p role="status" className="mt-2 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">
                    偵測到中文輸入法。請切換成英文鍵盤再作答，避免出現選字建議。
                    <button type="button" className="ml-2 underline" onClick={() => setImeQuestion(null)}>知道了</button>
                  </p>
                ) : null}
              </article>
            ))}

            <div className="surface-card flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-black">送出前再檢查一次</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {previewMode
                    ? '介面預覽不會傳送答案或產生成績。'
                    : '只有後端確認完整儲存後，才會顯示送出成功。'}
                </p>
                {message ? (
                  <p
                    role="alert"
                    className="mt-3 rounded-xl bg-rose-50 p-3 font-semibold text-rose-800"
                  >
                    {message}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy}
                className="h-12 rounded-xl bg-primary px-6 text-base font-black text-primary-foreground disabled:opacity-50"
              >
                {busy
                  ? '正在確認儲存…'
                  : previewMode
                    ? '完成介面預覽'
                    : '送出答案並查看回饋'}
              </button>
            </div>
          </section>
        ) : null}

        {phase === 'complete' ? (
          <section className="mx-auto max-w-2xl rounded-3xl border border-emerald-200 bg-card p-8 text-center shadow-sm sm:p-12">
            <span className="mx-auto grid size-16 place-items-center rounded-full bg-emerald-100 text-3xl text-emerald-700">
              ✓
            </span>
            <h1 className="mt-5 font-heading text-3xl font-black">
              {previewMode ? '介面預覽完成' : '作答已完整儲存'}
            </h1>
            <p className="mt-3 text-base leading-7 text-muted-foreground">
              {previewMode
                ? '這次沒有傳送答案，也不會產生真實成績。'
                : result?.status === 'released'
                  ? result.aiScored
                    ? `評分完成：${result.score}／${result.maxScore} 分。本次由 AI 評分，老師會抽查覆核；如對某題有疑義，可在下方送交老師評議。`
                    : `教師定稿：${result.score}／${result.maxScore} 分。`
                  : result?.status === 'provisional'
                    ? result.score === null
                      ? `已交卷。已判讀部分暫估 ${result.knownScore ?? 0} 分；另有 ${result.pendingCount ?? 0} 題待判讀，總分暫介於 ${result.knownScore ?? 0}～${(result.knownScore ?? 0) + (result.pendingMaxScore ?? 0)}／${result.maxScore} 分。這不是正式成績。`
                      : `系統暫定 ${result.score}／${result.maxScore} 分；如對某題有疑義，可在下方送交教師覆核。`
                    : result?.status === 'expired'
                      ? result.availableAt
                        ? `補考期間暫不顯示答案；${new Intl.DateTimeFormat('zh-TW', { timeZone: schoolTimeZone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(result.availableAt))} 後，可再重新登入查看暫估分數與訂正。`
                        : '本班測驗時段已截止，學生回饋已收回。教師仍可在覆核區查看作答。'
                      : '伺服器已確認收到完整作答；暫定分數與回饋尚未完成，請稍後重新登入確認。'}
            </p>
            {result?.status === 'provisional' && result.score === null && !previewMode ?
              <button type="button" onClick={() => void latestResult().then(next => { if (next) setResult(next); })}
                className="mt-3 min-h-11 rounded-lg border border-primary px-4 font-bold text-primary">重新查詢暫估分數</button> : null}
            {result?.endsAt && (result.status === 'provisional' || result.status === 'released') ?
              <p className="mt-3 text-sm font-bold text-amber-900">本班回饋僅顯示至 {new Intl.DateTimeFormat('zh-TW', { timeZone: schoolTimeZone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(result.endsAt))}；截圖或已記住的內容無法由系統收回。</p> : null}
            {(result?.status === 'released' || result?.status === 'provisional') ? <ol className="mt-6 space-y-4 text-left">
              {result.details?.map(item =>
                <li key={item.questionKey} className="rounded-xl border border-border p-4 text-sm leading-6">
                  <p className="font-black">{item.questionKey} · {item.prompt}（{item.scoreState === 'pending' ? '待教師覆核' : `${item.score}／${item.maxScore} 分${item.scoreState === 'suggested' ? '，暫估' : item.aiFinal ? '，系統評分' : ''}`}）</p>
                  <p className="mt-2 break-words">你的答案：{item.rawAnswer || '（空白）'}</p>
                  <p className="mt-2 break-words">參考答案：{item.textbookAnswer}</p>
                  {item.explanation ? <p className="mt-2 break-words">{item.scoreState === 'pending' ? '說明' : '回饋與句型重點'}：{item.explanation}</p> : null}
                  {!previewMode && result.appealAllowed ? <div className="mt-3 border-t border-border pt-3">
                    <label className="block font-bold" htmlFor={`appeal-${item.answerId}`}>覺得這題評分有疑義？簡述原因</label>
                    <textarea id={`appeal-${item.answerId}`} rows={2} maxLength={300}
                      value={appealNotes[item.answerId] ?? ''}
                      onChange={event => setAppealNotes(current => ({ ...current, [item.answerId]: event.target.value }))}
                      className="mt-2 w-full rounded-lg border border-border p-2" placeholder="例如：我的英文意思相同，請老師再看一次。" />
                    <button type="button" onClick={() => void submitAppeal(item.answerId)}
                      disabled={!appealNotes[item.answerId]?.trim() || appealStates[item.answerId] === '送出中…' || appealStates[item.answerId]?.startsWith('已送交')}
                      className="mt-2 min-h-10 rounded-lg border border-primary px-3 font-bold text-primary disabled:opacity-50">送交教師覆核</button>
                    {appealStates[item.answerId] ? <p role="status" className="mt-2 font-semibold">{appealStates[item.answerId]}</p> : null}
                  </div> : null}
                </li>)}
            </ol> : !previewMode && quizId && result?.status !== 'expired' ? <a className="mt-5 inline-block font-bold text-primary underline" href={`/quiz?quiz=${encodeURIComponent(quizId)}&version=${quizVersion}`}>稍後重新登入查看測驗成果</a> : null}
            <p className="mt-7 text-sm font-bold">
              {previewMode ? '可返回教師工作區查看其他測驗。' : '可以關閉這個頁面了。'}
            </p>
            {!previewMode ? <button type="button" onClick={() => void logout()} disabled={busy}
              className="mt-3 min-h-11 rounded-lg bg-primary px-4 font-bold text-primary-foreground">完成並登出此裝置</button> : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}

function isStudentQuiz(value: unknown, expectedId: string, expectedVersion: number): value is StudentQuiz {
  if (!value || typeof value !== 'object') return false;
  const quiz = value as Partial<StudentQuiz>;
  if (quiz.id !== expectedId || quiz.version !== expectedVersion ||
      typeof quiz.title !== 'string' || !quiz.title.trim() ||
      (quiz.scoreMode !== 'practice' && quiz.scoreMode !== 'formal') ||
      !Array.isArray(quiz.questions) || quiz.questions.length < 1 || quiz.questions.length > 100) return false;
  const keys = new Set<string>();
  for (const item of quiz.questions) {
    if (!item || typeof item.id !== 'string' || !item.id ||
        typeof item.prompt !== 'string' || !item.prompt.trim() || keys.has(item.id)) return false;
    keys.add(item.id);
  }
  return true;
}

function readPendingSubmission(key: string, questions?: StudentQuiz['questions']): PendingSubmission | null {
  const stored = localStorage.getItem(key);
  if (!stored) return null;
  try {
    const value = JSON.parse(stored) as Partial<PendingSubmission>;
    if (typeof value.key !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.key) ||
        !Array.isArray(value.answers) || value.answers.length < 1 || value.answers.length > 100 ||
        (questions && value.answers.length !== questions.length) ||
        value.answers.some((answer, index) => !answer || typeof answer.questionId !== 'string' ||
          typeof answer.rawAnswer !== 'string' || answer.rawAnswer.length > 1000 ||
          (questions && answer.questionId !== questions[index].id))) throw new Error('Invalid pending submission');
    return value as PendingSubmission;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}
