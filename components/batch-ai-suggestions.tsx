'use client';

import { useState } from 'react';

const MAX_BATCH = 20;
const CONCURRENCY = 3;

export function BatchAiSuggestions({ answers }: { answers: Array<{ answerId: string; updatedAt: string }> }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [done, setDone] = useState(false);
  if (!answers.length) return null;

  async function runBatch() {
    const batch = answers.slice(0, MAX_BATCH);
    setBusy(true);
    setDone(false);
    setProgress(0);
    setMessage('正在取得 AI 建議；離開頁面會中斷尚未送出的題目。');
    let next = 0;
    let completed = 0;
    let successful = 0;
    const reasons = new Map<string, number>();
    async function worker() {
      while (next < batch.length) {
        const item = batch[next++];
        try {
          const response = await fetch('/api/teacher/ai-score-suggestion', {
            method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
            body: JSON.stringify(item),
          });
          const body = await response.json() as { status?: string; error?: string };
          if (response.ok && body.status === 'ok') successful++;
          else reasons.set(body.error || `HTTP ${response.status}`, (reasons.get(body.error || `HTTP ${response.status}`) ?? 0) + 1);
        } catch {
          // Failed items remain available for a later batch; no grade is written.
          reasons.set('網路中斷或逾時', (reasons.get('網路中斷或逾時') ?? 0) + 1);
        } finally {
          setProgress(++completed);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, () => worker()));
    setBusy(false);
    setDone(true);
    const why = [...reasons].map(([text, count]) => `${text}（${count} 題）`).join('；');
    setMessage(`已取得 ${successful}／${batch.length} 題建議。失敗的題目不會變更分數${why ? `。失敗原因：${why}` : ''}；請重新整理後核對。`);
  }

  return <section className="surface-card" aria-label="批次 AI 評分建議">
    <h2 className="text-xl font-black">待判讀題目 AI 建議</h2>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">
      本頁尚有 {answers.length} 題沒有固定規則或 AI 建議。每批最多分析 {MAX_BATCH} 題；結果只供教師覆核，不會自動定稿。
    </p>
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button type="button" onClick={runBatch} disabled={busy || done}
        className="min-h-11 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50">
        {busy ? `分析中 ${progress}／${Math.min(answers.length, MAX_BATCH)}` : '分析本頁下一批'}
      </button>
      {done ? <button type="button" onClick={() => window.location.reload()}
        className="min-h-11 rounded-lg border border-primary px-4 text-sm font-bold text-primary">重新整理查看結果</button> : null}
    </div>
    {message ? <p role="status" className="mt-2 text-sm font-semibold">{message}</p> : null}
  </section>;
}
