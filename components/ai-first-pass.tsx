'use client';

import { useState } from 'react';

type Totals = { adopted: number; skipped: number; failed: number; processed: number };

/**
 * Step ①: turns automatic adoption on if needed, then lets the AI score every
 * submitted answer it has not seen yet. Answers it is unsure about stay for the teacher.
 */
export function AiFirstPass({ quizId, version, enabled, threshold, awaiting }: {
  quizId: string; version: number; enabled: boolean; threshold: number; awaiting: number;
}) {
  const [level, setLevel] = useState(String(threshold));
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const [totals, setTotals] = useState<Totals | null>(null);

  async function saveSetting(on: boolean) {
    const response = await fetch('/api/teacher/auto-finalize', {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ quizId, version, enabled: on, threshold: Number(level) }),
    });
    const body = await response.json() as { status?: string; error?: string };
    if (!response.ok || body.status !== 'ok') throw new Error(body.error || '設定未確認。');
  }

  async function run() {
    setRunning(true);
    setMessage('AI 批改中，請保持此頁開啟…');
    const sum: Totals = { adopted: 0, skipped: 0, failed: 0, processed: 0 };
    const errors = new Set<string>();
    try {
      if (!enabled || Number(level) !== threshold) await saveSetting(true);
      let after = '';
      for (let round = 0; round < 500; round++) {
        const response = await fetch('/api/teacher/auto-finalize-run', {
          method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
          body: JSON.stringify({ quizId, version, after }),
        });
        const body = await response.json() as { status?: string; error?: string; processed?: number; adopted?: number;
          skipped?: number; failed?: number; aiErrors?: string[]; next?: string; done?: boolean };
        if (!response.ok || body.status !== 'ok') throw new Error(body.error || 'AI 批改中斷。');
        sum.processed += body.processed ?? 0; sum.adopted += body.adopted ?? 0;
        sum.skipped += body.skipped ?? 0; sum.failed += body.failed ?? 0;
        for (const text of body.aiErrors ?? []) errors.add(text);
        setTotals({ ...sum });
        if (body.done) break;
        after = body.next ?? after;
      }
      if (errors.size) {
        setMessage(`AI 批改完成，但有提醒：${[...errors].join('；')}。已定稿 ${sum.adopted} 題，其餘保留。`);
        setRunning(false);
        return;
      }
      setMessage(`完成：AI 定稿 ${sum.adopted} 題，留給你 ${sum.skipped} 題。正在更新畫面…`);
      window.location.reload();
    } catch (error) {
      setMessage(`${error instanceof Error ? error.message : 'AI 批改中斷。'} 已定稿的題目不受影響，可再按一次繼續。`);
      setRunning(false);
    }
  }

  async function switchOff() {
    if (!window.confirm('關閉後，之後交卷的作答都要由你逐題確認。已定稿的分數不會改變。確定關閉？')) return;
    setRunning(true);
    try { await saveSetting(false); window.location.reload(); }
    catch (error) { setMessage(error instanceof Error ? error.message : '設定未確認。'); setRunning(false); }
  }

  return <div className="text-sm">
    <div className="flex flex-wrap items-center gap-2">
      {awaiting > 0 || !enabled ? <button type="button" onClick={() => void run()} disabled={running}
        className="min-h-11 rounded-lg bg-emerald-800 px-4 font-black text-white disabled:opacity-50">
        {running ? `AI 批改中（已檢查 ${totals?.processed ?? 0} 份）` : enabled ? `AI 先批（${awaiting} 題未判讀）` : '開啟並由 AI 先批'}
      </button> : <span className="font-black text-emerald-800">AI 已批完 ✓</span>}
      <details className="inline-block">
        <summary className="cursor-pointer px-2 text-muted-foreground underline">設定</summary>
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-border bg-white p-3">
          <label className="font-bold">AI 信心門檻
            <select value={level} onChange={event => setLevel(event.target.value)} disabled={running}
              className="mt-1 block min-h-11 rounded-lg border border-border bg-white px-2">
              {['0.8', '0.85', '0.9', '0.95'].map(value => <option key={value} value={value}>{Math.round(Number(value) * 100)}%</option>)}
            </select>
          </label>
          <button type="button" onClick={() => void run()} disabled={running}
            className="min-h-11 rounded-lg border border-emerald-800 px-3 font-bold">套用門檻並重新處理</button>
          {enabled ? <button type="button" onClick={() => void switchOff()} disabled={running}
            className="min-h-11 rounded-lg border border-border px-3 font-bold">關閉 AI 自動採用</button> : null}
          <p className="w-full text-xs leading-5 text-muted-foreground">信心達門檻的題目自動定稿；低於門檻、學生評議、空白答案留給你。</p>
        </div>
      </details>
    </div>
    {message ? <p role="status" className="mt-2 font-semibold leading-6">{message}</p> : null}
  </div>;
}
