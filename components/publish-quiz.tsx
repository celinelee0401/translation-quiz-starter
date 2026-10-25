'use client';

import { useState } from 'react';

export function PublishQuiz({ quizId, quizVersion, classes, ready }: {
  quizId: string; quizVersion: number; classes: string[]; ready: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function publish() {
    if (!ready || !window.confirm(`確定發布「${quizId}」給 ${classes.join('、')} 班？發布後，符合各班開放時段時會自動出現在 Dashboard；學生也可開始作答。`)) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/teacher/publish', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quizId, quizVersion }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || '發布未確認。');
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '發布未確認，請重新整理核對。');
      setBusy(false);
    }
  }

  return <div className="mt-3 rounded-xl border border-cyan-300 bg-cyan-50 p-4 text-sm">
    <p className="font-black">發布到學生端與 Dashboard</p>
    <p className="mt-1 leading-6">儲存班級時間只會保留草稿。發布後仍依每班開放與截止時間顯示；不會提前公開答案。</p>
    <button type="button" disabled={!ready || busy} onClick={publish}
      className="mt-3 min-h-11 rounded-lg bg-primary px-4 font-black text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">
      {busy ? '發布中…' : ready ? '確認發布這份測驗' : '請先完成所有發布檢查'}
    </button>
    {message ? <p role="alert" className="mt-2 font-bold text-red-900">{message}</p> : null}
  </div>;
}
