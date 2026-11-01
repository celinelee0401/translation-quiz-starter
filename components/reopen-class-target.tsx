'use client';

import { useState } from 'react';

export function ReopenClassTarget({ quizId, quizVersion, classCode }: {
  quizId: string; quizVersion: number; classCode: string;
}) {
  const [opensAtLocal, setOpensAtLocal] = useState('');
  const [closesAtLocal, setClosesAtLocal] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [retainFeedbackAfterClose, setRetainFeedbackAfterClose] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmed) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/teacher/reopen-target', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quizId, quizVersion, classCode, opensAtLocal, closesAtLocal, retainFeedbackAfterClose }),
      });
      const body = await response.json() as { status?: string; error?: string };
      if (!response.ok || body.status !== 'ok') throw new Error(body.error || '補考時段未確認。');
      setMessage(`${classCode} 班補考已排定；到開放時間學生才能從作答連結進入。`);
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '補考時段未確認。');
    } finally {
      setBusy(false);
    }
  }

  return <details className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950">
    <summary className="cursor-pointer font-black">為 {classCode} 班重新發布補考時段</summary>
    <p className="mt-2 text-sm leading-6">只在原時段截止後使用。已交卷者不能重考；原時段與學生答案保留在紀錄中。先前已交卷學生在補考期間看不到答案。</p>
    <form onSubmit={submit} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <label className="text-sm font-bold">補考開放時間（學校時間）
        <input type="datetime-local" required value={opensAtLocal} onChange={event => setOpensAtLocal(event.target.value)}
          className="mt-1 min-h-11 w-full rounded-lg border border-input bg-background px-2 text-base text-foreground" />
      </label>
      <label className="text-sm font-bold">補考截止時間（學校時間）
        <input type="datetime-local" required value={closesAtLocal} onChange={event => setClosesAtLocal(event.target.value)}
          className="mt-1 min-h-11 w-full rounded-lg border border-input bg-background px-2 text-base text-foreground" />
      </label>
      <label className="flex items-start gap-2 text-sm font-bold sm:col-span-3">
        <input type="checkbox" checked={retainFeedbackAfterClose} onChange={event => setRetainFeedbackAfterClose(event.target.checked)}
          className="mt-1 size-4" />
        補考截止後，已交卷學生仍可重新登入查看暫估分數、參考答案與訂正；不會再收回。
      </label>
      <label className="flex items-start gap-2 text-sm font-bold sm:col-span-3">
        <input type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1 size-4" />
        我確認只重新開放 {classCode} 班未交卷學生；已交卷者不能重考。
      </label>
      <button type="submit" disabled={busy || !confirmed} className="min-h-11 rounded-lg bg-primary px-4 font-black text-primary-foreground disabled:opacity-50">
        {busy ? '儲存中…' : '確認重新發布'}
      </button>
    </form>
    {message ? <output className="mt-2 block text-sm font-bold">{message}</output> : null}
  </details>;
}
