'use client';

import { useState } from 'react';

export function ReleaseFeedback({ quizId, version, title }: { quizId: string; version: number; title: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function release() {
    if (!window.confirm(`確認 ${title} 的所有目標班級都已考完，且分數已逐題覆核？發布後學生可看到分數、錯題說明與參考答案。`)) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/teacher/feedback/release', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quizId, version }),
      });
      const body = await response.json() as { error?: string };
      setMessage(response.ok ? '回饋已發布；學生再次以 PIN 登入測驗頁即可查看。' : body.error ?? '發布失敗，請稍後再試。');
    } catch { setMessage('連線失敗，請稍後再試。'); }
    finally { setBusy(false); }
  }
  return <div className="rounded-lg border border-border p-3">
    <p className="text-sm font-bold">{title}</p>
    <button type="button" disabled={busy} onClick={() => void release()}
      className="mt-2 min-h-11 rounded-lg bg-primary px-3 text-sm font-bold text-primary-foreground disabled:opacity-50">
      {busy ? '正在確認…' : '發布分數與錯題回饋'}
    </button>
    {message ? <p role="status" className="mt-2 text-sm">{message}</p> : null}
  </div>;
}
