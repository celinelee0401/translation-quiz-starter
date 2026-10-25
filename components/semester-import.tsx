'use client';

import { useState, type ChangeEvent } from 'react';
import { useSchoolSettings } from '@/components/school-settings-provider';
import { isSupportedGrade, type SchoolSettings } from '@/lib/school-settings';

type Question = { prompt: string; answer: string; hint: string; meaning: number; grammar: number };
type Draft = { title: string; unit: string; grade: number; scoreMode: 'practice' | 'formal'; questions: Question[] };
type Row = Draft & { total: number; exists: boolean; problem: string; result?: string };

const total = (draft: Draft) => draft.questions.reduce((sum, q) => sum + Number(q.meaning) + Number(q.grammar) + 1, 0);

function check(value: unknown, settings: SchoolSettings): Draft[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 80) throw new Error('檔案內容應該是 1～80 份測驗的清單。');
  return value.map((item, index) => {
    const draft = item as Partial<Draft>;
    if (!draft || typeof draft.title !== 'string' || typeof draft.unit !== 'string' ||
      !isSupportedGrade(settings, draft.grade) || !Array.isArray(draft.questions)) {
      throw new Error(`第 ${index + 1} 份測驗缺少名稱、單元、年級或題目。`);
    }
    return { title: draft.title, unit: draft.unit, grade: draft.grade,
      scoreMode: draft.scoreMode === 'practice' ? 'practice' : 'formal', questions: draft.questions as Question[] };
  });
}

/**
 * Creates many quiz drafts from one file. Each quiz goes through the normal
 * draft endpoint, so the same checks apply; nothing is published.
 */
export function SemesterImport({ existingTitles }: { existingTitles: string[] }) {
  const settings = useSchoolSettings();
  const [rows, setRows] = useState<Row[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    setRows([]); setDone(false); setMessage('');
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const drafts = check(JSON.parse(await file.text()), settings);
      const taken = new Set(existingTitles.map(title => title.trim()));
      setRows(drafts.map(draft => ({ ...draft, total: total(draft), exists: taken.has(draft.title.trim()),
        problem: draft.questions.length < 1 || draft.questions.length > 50 ? '題數需為 1～50 題' :
          total(draft) !== 100 ? `總分是 ${total(draft)}，不是 100` : '' })));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '無法讀取這個檔案。');
    }
  }

  const ready = rows.filter(row => !row.exists && !row.problem);

  async function importAll() {
    setBusy(true);
    let created = 0;
    let failed = 0;
    for (const row of ready) {
      setMessage(`建立中：${row.title}（${created + failed + 1}／${ready.length}）`);
      let result: string;
      try {
        const response = await fetch('/api/teacher/create-draft', {
          method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
          body: JSON.stringify({ title: row.title, unit: row.unit, grade: row.grade, scoreMode: row.scoreMode, questions: row.questions }),
        });
        const body = await response.json() as { status?: string; error?: string };
        if (!response.ok || body.status !== 'ok') throw new Error(body.error || '建立未確認。');
        created++;
        result = '已建立草稿 ✓';
      } catch (error) {
        failed++;
        result = `失敗：${error instanceof Error ? error.message : '建立未確認。'}`;
      }
      setRows(current => current.map(item => item === row ? { ...item, result } : item));
    }
    setBusy(false);
    setDone(true);
    setMessage(`完成：建立 ${created} 份草稿${failed ? `，${failed} 份失敗（可修正後再匯入一次，已建立的會自動跳過）` : ''}。重新整理頁面後，草稿會出現在「測驗管理」。`);
  }

  return <details className="mt-4 rounded-xl border-2 border-primary p-3" open>
    <summary className="cursor-pointer text-lg font-black text-primary">整學期一次匯入（上傳題庫檔）</summary>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">
      選擇題庫檔（.json），先預覽每份測驗的題數與總分，確認後一次建立成草稿。只會建立「未發布草稿」，不會開放給學生；
      名稱和現有測驗相同的會自動跳過，所以重複匯入同一個檔案也不會產生重複的草稿。
    </p>
    <input type="file" accept=".json,application/json" onChange={event => void readFile(event)} disabled={busy}
      className="mt-3 block text-sm" />
    {rows.length ? <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[36rem] text-sm">
        <thead><tr className="border-b border-border text-left"><th className="py-2">測驗名稱</th><th>年級</th><th>題數</th><th>總分</th><th>狀態</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.title} className="border-b border-border">
          <td className="py-2 font-bold">{row.title}</td><td>G{row.grade}</td><td>{row.questions.length}</td><td>{row.total}</td>
          <td className={row.result?.startsWith('失敗') || row.problem ? 'text-red-800' : row.exists ? 'text-muted-foreground' : 'text-emerald-800'}>
            {row.result ?? (row.problem ? `不會匯入：${row.problem}` : row.exists ? '已存在，跳過' : '待建立')}</td>
        </tr>)}</tbody>
      </table>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {!done ? <button type="button" onClick={() => void importAll()} disabled={busy || ready.length === 0}
          className="min-h-11 rounded-lg bg-primary px-4 font-black text-primary-foreground disabled:opacity-50">
          {busy ? '建立中，請保持此頁開啟…' : `建立 ${ready.length} 份草稿`}</button>
          : <button type="button" onClick={() => window.location.reload()}
            className="min-h-11 rounded-lg border-2 border-primary px-4 font-black text-primary">重新整理查看草稿</button>}
        <span className="text-sm text-muted-foreground">共 {rows.length} 份，其中 {rows.filter(row => row.exists).length} 份已存在。</span>
      </div>
    </div> : null}
    {message ? <p role="status" className="mt-3 text-sm font-bold leading-6">{message}</p> : null}
  </details>;
}
