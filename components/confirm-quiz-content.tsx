'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function ConfirmQuizContent({ quizId, quizVersion }: { quizId: string; quizVersion: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function confirm() {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/teacher/confirm-content', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quizId, quizVersion }),
      });
      const body = await response.json() as { status?: string; error?: string };
      if (!response.ok || body.status !== 'ok') throw new Error(body.error || '核定紀錄未儲存。');
      setMessage('題目與配分已記錄；測驗仍是未發布草稿。');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '核定紀錄未儲存。');
    } finally {
      setBusy(false);
    }
  }

  return <div className="mt-3 text-sm">
    <button type="button" onClick={() => void confirm()} disabled={busy}
      className="min-h-11 rounded-lg border border-primary px-4 font-black text-primary disabled:opacity-50">
      {busy ? '正在記錄…' : '教師確認題目與配分'}
    </button>
    {message ? <output className="mt-2 block font-bold">{message}</output> : null}
  </div>;
}
