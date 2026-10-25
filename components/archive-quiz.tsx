'use client';

import { useState } from 'react';

export function ArchiveQuiz({ quizId, version, archived }: { quizId: string; version: number; archived: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function change() {
    const action = archived ? 'restore' : 'archive';
    if (!window.confirm(archived
      ? '還原後可回到教師管理清單；已考資料與成績都會保留。確定還原？'
      : '封存只會從學生入口與主要清單移開；題目、作答、覆核與成績仍保留並可匯出。確定封存？')) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/teacher/archive', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quizId, quizVersion: version, action }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || '操作未確認。');
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作未確認，請重新整理核對。');
      setBusy(false);
    }
  }
  return <div className="mt-3 text-sm"><button type="button" disabled={busy} onClick={change}
    className="min-h-11 rounded-lg border border-primary px-4 font-bold text-primary disabled:opacity-50">
    {busy ? '確認中…' : archived ? '還原到教師清單' : '封存這份測驗（保留所有資料）'}
  </button>{error ? <p role="alert" className="mt-2 text-red-900">{error}</p> : null}</div>;
}
