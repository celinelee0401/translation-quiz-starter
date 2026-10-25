'use client';

import { useState } from 'react';

export type ConfirmCandidate = {
  quizId: string; version: number; title: string; grade: number;
  questionCount: number; total: number; needsContent: boolean; needsRubric: boolean;
};

/**
 * Records the teacher's two confirmations for many drafts at once. Each quiz
 * goes through the same endpoints as the single buttons, so every quiz still
 * gets its own approval record tied to its exact content.
 */
export function BatchConfirm({ candidates }: { candidates: ConfirmCandidate[] }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(candidates.map(item => `${item.quizId}:${item.version}`)));
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  if (!candidates.length) return null;

  const key = (item: ConfirmCandidate) => `${item.quizId}:${item.version}`;
  const chosen = candidates.filter(item => selected.has(key(item)));

  async function post(path: string, item: ConfirmCandidate) {
    const response = await fetch(path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ quizId: item.quizId, quizVersion: item.version }),
    });
    const body = await response.json() as { status?: string; error?: string };
    if (!response.ok || body.status !== 'ok') throw new Error(body.error || '核定紀錄未確認。');
  }

  async function run() {
    setBusy(true);
    let ok = 0;
    let failed = 0;
    for (const [index, item] of chosen.entries()) {
      setMessage(`記錄中：${item.title}（${index + 1}／${chosen.length}）`);
      try {
        if (item.needsContent) await post('/api/teacher/confirm-content', item);
        if (item.needsRubric) await post('/api/teacher/confirm-generic-rubric', item);
        ok++;
        setResults(current => ({ ...current, [key(item)]: '已確認 ✓' }));
      } catch (error) {
        failed++;
        setResults(current => ({ ...current, [key(item)]: `失敗：${error instanceof Error ? error.message : '未確認'}` }));
      }
    }
    setBusy(false);
    setMessage(`完成：${ok} 份已確認${failed ? `，${failed} 份失敗，可再按一次重試` : ''}。這些測驗仍是未發布草稿，設定班級時段後才能發布。`);
  }

  return <section className="mt-4 rounded-xl border-2 border-amber-400 bg-amber-50 p-4 text-sm text-amber-950" aria-label="批次確認題目與評分細則">
    <h3 className="text-lg font-black">批次確認：題目、配分與評分細則（{candidates.length} 份草稿待確認）</h3>
    <p className="mt-1 leading-6">
      一次記錄多份草稿的「教師確認題目與配分」和「教師確認評分細則」。每份測驗仍會各自留下你的確認紀錄；
      確認後若再修改題目內容，該份需要重新確認。這不會發布任何測驗。
    </p>
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => setSelected(new Set(candidates.map(key)))}
        className="min-h-10 rounded-lg border border-amber-700 px-3 font-bold">全選</button>
      <button type="button" disabled={busy} onClick={() => setSelected(new Set())}
        className="min-h-10 rounded-lg border border-amber-700 px-3 font-bold">全部取消</button>
      {[8, 9].map(grade => <button key={grade} type="button" disabled={busy}
        onClick={() => setSelected(new Set(candidates.filter(item => item.grade === grade).map(key)))}
        className="min-h-10 rounded-lg border border-amber-700 px-3 font-bold">只選 G{grade}</button>)}
    </div>
    <ul className="mt-3 max-h-80 space-y-1 overflow-y-auto rounded-lg bg-white p-2">
      {candidates.map(item => <li key={key(item)} className="flex flex-wrap items-center gap-2 border-b border-amber-100 py-1">
        <label className="flex flex-1 items-center gap-2">
          <input type="checkbox" className="size-4" disabled={busy} checked={selected.has(key(item))}
            onChange={event => setSelected(current => {
              const next = new Set(current);
              if (event.target.checked) next.add(key(item)); else next.delete(key(item));
              return next;
            })} />
          <span className="font-bold">{item.title}</span>
          <span className="text-muted-foreground">{item.questionCount} 題 · 總分 {item.total}</span>
        </label>
        <span className={results[key(item)]?.startsWith('失敗') ? 'text-red-800' : 'text-emerald-800'}>
          {results[key(item)] ?? [item.needsContent ? '待確認題目配分' : '', item.needsRubric ? '待確認評分細則' : ''].filter(Boolean).join('、')}
        </span>
      </li>)}
    </ul>
    <label className="mt-3 flex items-start gap-2 font-bold">
      <input type="checkbox" className="mt-1 size-4" checked={acknowledged} disabled={busy}
        onChange={event => setAcknowledged(event.target.checked)} />
      我已核對勾選的 {chosen.length} 份測驗的中文題目、英文參考答案、學習提示與配分，同意記錄為教師確認。
    </label>
    <button type="button" onClick={() => void run()} disabled={busy || !acknowledged || chosen.length === 0}
      className="mt-3 min-h-11 rounded-lg bg-amber-800 px-4 font-black text-white disabled:opacity-50">
      {busy ? '記錄中，請保持此頁開啟…' : `確認勾選的 ${chosen.length} 份`}
    </button>
    {message ? <p role="status" className="mt-2 font-bold leading-6">{message}</p> : null}
    {message.startsWith('完成') ? <button type="button" onClick={() => window.location.reload()}
      className="mt-2 min-h-11 rounded-lg border-2 border-amber-800 px-4 font-black">重新整理查看狀態</button> : null}
  </section>;
}
