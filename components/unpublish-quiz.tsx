'use client';

import { useState } from 'react';

export function UnpublishQuiz({ quizId, quizVersion, title }: { quizId: string; quizVersion: number; title: string }) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function unpublish() {
    if (!confirmed || !window.confirm(`確定撤銷發布「${title}」？\n所有班級的學生會立刻無法從作答連結進入，測驗退回草稿；題目、配分核定與班級時段都保留，修正後可再發布。`)) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/teacher/unpublish', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quizId, quizVersion }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || '撤銷未確認。');
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '撤銷未確認，請重新整理核對。');
      setBusy(false);
    }
  }

  return <details className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-950">
    <summary className="cursor-pointer font-black">發布錯了？撤銷發布（退回草稿）</summary>
    <p className="mt-2 leading-6">
      只在還沒有任何學生開始作答時可以撤銷：所有班級的學生都不能再從作答連結進入，測驗回到「待發布草稿」。
      題目、配分核定與班級時段都保留；修正後重新設定時段即可再發布。已有學生作答時，請改用各班的「立即結束」。
    </p>
    <label className="mt-2 flex items-start gap-2 font-bold">
      <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1 size-4" />
      我確認要讓這份測驗退回草稿。
    </label>
    <button type="button" disabled={!confirmed || busy} onClick={unpublish}
      className="mt-2 min-h-11 rounded-lg bg-red-700 px-4 font-black text-white disabled:opacity-50">
      {busy ? '撤銷中…' : '撤銷發布'}
    </button>
    {message ? <p role="alert" className="mt-2 font-bold">{message}</p> : null}
  </details>;
}
