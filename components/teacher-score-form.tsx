'use client';

import { useState, type SyntheticEvent } from 'react';
import type { AiScoreSuggestion } from '@/lib/server/teacher-review';

export function TeacherScoreForm({
  answerId, updatedAt, maxScore, initialScore, allowAi, savedAi,
}: {
  answerId: string;
  updatedAt: string;
  maxScore: number;
  initialScore: number | null;
  allowAi: boolean;
  savedAi: AiScoreSuggestion | null;
}) {
  const [score, setScore] = useState(initialScore === null ? '' : String(initialScore));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [ai, setAi] = useState<AiScoreSuggestion | null>(savedAi);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMessage, setAiMessage] = useState('');

  async function requestAiSuggestion() {
    setAiBusy(true);
    setAiMessage('正在分析原始作答…');
    try {
      const response = await fetch('/api/teacher/ai-score-suggestion', {
        method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ answerId, updatedAt }),
      });
      const payload = await response.json() as { status?: string; error?: string; suggestion?: AiScoreSuggestion };
      if (!response.ok || payload.status !== 'ok' || !payload.suggestion) {
        setAiMessage(payload.error || '目前無法取得 AI 建議。');
        return;
      }
      setAi(payload.suggestion);
      setAiMessage('建議已保存於此題；仍需教師核對並定稿。');
    } catch {
      setAiMessage('目前無法取得 AI 建議，請稍後重試。');
    } finally {
      setAiBusy(false);
    }
  }

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Number(score);
    if (score.trim() === '' || !Number.isFinite(value) || value < 0 || value > maxScore || Math.round(value * 100) !== value * 100) {
      setMessage(`請填寫 0 到 ${maxScore} 分，最多兩位小數。`);
      return;
    }
    if (reason.trim().length < 4) {
      setMessage('請寫至少四個字的評分理由。');
      return;
    }
    setBusy(true);
    setMessage('儲存中，請勿關閉頁面。');
    try {
      const response = await fetch('/api/teacher/review-answer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ answerId, updatedAt, score: value, reason: reason.trim() }),
      });
      const payload = await response.json() as { status?: string; error?: string };
      if (!response.ok || payload.status !== 'ok') {
        setMessage(payload.error || '未確認儲存，請重新整理核對。');
        return;
      }
      setMessage('已儲存；正在更新覆核紀錄。');
      window.location.reload();
    } catch {
      setMessage('未確認儲存，請重新整理核對後再操作。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-3">
      {allowAi || ai ? <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
        {ai ? <>
          <p className="font-black">AI 建議 {ai.suggestedScore}／{maxScore} 分 · 模型自評信心 {Math.round(ai.confidence * 100)}%</p>
          <p className="mt-1">{ai.reason}</p>
          <p className="mt-1 text-xs">{ai.model} · {ai.version} · 僅供教師參考，並非定稿成績。</p>
          {allowAi ? <button type="button" onClick={() => { setScore(String(ai.suggestedScore)); setReason(ai.reason); }}
            className="mt-2 min-h-10 rounded-lg border border-amber-800 px-3 font-bold hover:bg-amber-100">填入建議，仍由我確認</button> : null}
        </> : <button type="button" disabled={aiBusy} onClick={requestAiSuggestion}
          className="min-h-10 rounded-lg border border-amber-800 px-3 font-bold hover:bg-amber-100 disabled:opacity-50">
          {aiBusy ? '分析中…' : '取得 AI 評分建議'}
        </button>}
        {aiMessage ? <p role="status" className="mt-2 font-semibold">{aiMessage}</p> : null}
      </section> : null}
      <form onSubmit={submit} className="grid gap-3 rounded-xl border border-cyan-200 bg-cyan-50 p-4 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-end">
      <label className="block text-sm font-bold">
        教師確認分數
        <input
          type="number" min="0" max={maxScore} step="0.01" required
          value={score} onChange={(event) => setScore(event.target.value)}
          className="mt-1 block h-11 w-full rounded-lg border border-slate-400 bg-white px-3 text-base"
        />
      </label>
      <label className="block text-sm font-bold">
        評分理由（留存紀錄）
        <input
          type="text" minLength={4} maxLength={1000} required
          value={reason} onChange={(event) => setReason(event.target.value)}
          placeholder="例如：語意正確，句型不同但文法合理"
          className="mt-1 block h-11 w-full rounded-lg border border-slate-400 bg-white px-3 text-base"
        />
      </label>
      <button type="submit" disabled={busy} className="h-11 rounded-lg bg-[#12313e] px-4 text-sm font-bold text-white disabled:opacity-50">
        {busy ? '儲存中…' : '確認並儲存'}
      </button>
      {message ? <output className="text-sm font-bold sm:col-span-3">{message}</output> : null}
      </form>
    </div>
  );
}
