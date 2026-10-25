'use client';

import { useState } from 'react';

type Row = { classCode: string; seatNumber: number; pin: string | null };

export function RosterImport({ usesPin }: { usesPin: boolean }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [issued, setIssued] = useState<Row[]>([]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    setIssued([]);
    try {
      const response = await fetch('/api/teacher/roster', {
        method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ text }),
      });
      const body = await response.json().catch(() => ({})) as { rows?: Row[]; error?: string };
      if (!response.ok || !body.rows) throw new Error(body.error || '名冊匯入失敗。');
      setText('');
      setIssued(usesPin ? body.rows : []);
      setMessage(`已匯入 ${body.rows.length} 位學生。${usesPin ? '下方 PIN 只顯示這一次，請先列印或複製。' : ''}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '名冊匯入失敗。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <h2 className="text-xl font-black">新增學生／重設 PIN</h2>
      <p className="text-sm leading-6 text-muted-foreground">
        每行一位：{usesPin ? '班級,座號,PIN（PIN 留空會自動產生六位數）' : '班級,座號'}。已存在的座號會被更新{usesPin ? '，舊 PIN 立即失效' : ''}。
      </p>
      <textarea value={text} onChange={(event) => setText(event.target.value)} rows={8} required
        className="w-full rounded-xl border border-input bg-background p-3 font-mono text-sm"
        placeholder={usesPin ? '801,1\n801,2,135790' : '801,1\n801,2'} />
      <button type="submit" disabled={busy}
        className="h-11 rounded-xl bg-primary px-5 font-black text-primary-foreground disabled:opacity-50">
        {busy ? '匯入中…' : '匯入名冊'}
      </button>
      {message ? <p role="status" className="font-bold">{message}</p> : null}
      {issued.length ? (
        <table className="mt-2 w-full text-left text-sm">
          <thead><tr><th>班級</th><th>座號</th><th>PIN</th></tr></thead>
          <tbody>{issued.map((row) => (
            <tr key={`${row.classCode}/${row.seatNumber}`}><td>{row.classCode}</td><td>{row.seatNumber}</td><td className="font-mono">{row.pin}</td></tr>
          ))}</tbody>
        </table>
      ) : null}
    </form>
  );
}
