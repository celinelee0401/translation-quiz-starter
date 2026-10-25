'use client';

import { useState } from 'react';

export function ConfirmGenericRubric({ quizId, quizVersion }: { quizId: string; quizVersion: number }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function confirm() {
    if (!window.confirm('我已逐題核對語意、文法句型與書寫配分。未列明的合理替代表達不會自動判零，會交由教師覆核。確定核定這版評分細則？')) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/teacher/confirm-generic-rubric', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quizId, quizVersion }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || '核定未確認。');
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '核定未確認，請重新整理。');
      setBusy(false);
    }
  }
  return <div className="mt-3 text-sm"><button type="button" disabled={busy} onClick={confirm}
    className="min-h-11 rounded-lg border border-primary px-4 font-bold text-primary disabled:opacity-50">
    {busy ? '記錄中…' : '教師核定這份測驗的評分細則'}
  </button>{message ? <p role="alert" className="mt-2 text-red-900">{message}</p> : null}</div>;
}
