'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useSchoolSettings } from '@/components/school-settings-provider';
import { classCodesForGrade } from '@/lib/school-settings';

export function DraftTargetForm({ quizId, quizVersion, grade, mode = 'draft', existingClasses = [] }: {
  quizId: string; quizVersion: number; grade: number;
  mode?: 'draft' | 'published'; existingClasses?: string[];
}) {
  const router = useRouter();
  const classes = classCodesForGrade(useSchoolSettings(), grade)
    .filter(code => mode === 'draft' || !existingClasses.includes(code));
  const [classCode, setClassCode] = useState(classes[0] ?? '');
  const [opensAtLocal, setOpensAtLocal] = useState('');
  const [closesAtLocal, setClosesAtLocal] = useState('');
  const [attemptLimit, setAttemptLimit] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!classes.includes(classCode)) { setMessage('請選擇尚未安排的班級。'); return; }
    if (mode === 'published' && !window.confirm(`確定將 ${classCode} 班加入已發布測驗？原有班級的時段與題目不會變更；新班級要到設定的開放時間才會在 Dashboard 顯示。`)) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(mode === 'published' ? '/api/teacher/published-target' : '/api/teacher/draft-target', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quizId, quizVersion, classCode, opensAtLocal, closesAtLocal, attemptLimit }),
      });
      const body = await response.json() as { status?: string; error?: string };
      if (!response.ok || body.status !== 'ok') throw new Error(body.error || '時段未儲存。');
      setMessage(mode === 'published'
        ? `${classCode} 班已加入；到開放時間才會在 Dashboard 顯示。`
        : `${classCode} 的未公開時段已儲存；學生仍看不到。`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '時段未儲存。');
    } finally {
      setBusy(false);
    }
  }
  if (!classes.length) return null;
  return (
    <form onSubmit={save} className="mt-3 rounded-lg border border-border bg-card p-3 text-sm">
      <p className="font-black">{mode === 'published' ? '新增班級時段 · 已發布測驗' : '設定班級時段 · 僅儲存草稿'}</p>
      {mode === 'published' ? <p className="mt-1 leading-6 text-muted-foreground">只可新增尚未安排的班級；既有班級時段與學生作答不會改動。</p> : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <label className="font-bold">班級
          <select value={classCode} onChange={(event) => setClassCode(event.target.value)}
            className="mt-1 min-h-11 w-full rounded-lg border border-input bg-background px-2 text-base">
            {classes.map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
        </label>
        <label className="font-bold">開放時間（學校時間）
          <input type="datetime-local" required value={opensAtLocal}
            onChange={(event) => setOpensAtLocal(event.target.value)}
            className="mt-1 min-h-11 w-full rounded-lg border border-input bg-background px-2 text-base" />
        </label>
        <label className="font-bold">截止時間（學校時間）
          <input type="datetime-local" required value={closesAtLocal}
            onChange={(event) => setClosesAtLocal(event.target.value)}
            className="mt-1 min-h-11 w-full rounded-lg border border-input bg-background px-2 text-base" />
        </label>
        <label className="font-bold">每人作答次數
          <select value={attemptLimit} onChange={(event) => setAttemptLimit(Number(event.target.value))}
            className="mt-1 min-h-11 w-full rounded-lg border border-input bg-background px-2 text-base">
            {[1, 2, 3, 4, 5].map((count) => <option key={count} value={count}>{count} 次{count === 1 ? '（預設）' : ''}</option>)}
          </select>
        </label>
      </div>
      <button type="submit" disabled={busy}
        className="mt-3 min-h-11 rounded-lg border border-primary px-4 font-black text-primary disabled:opacity-50">
        {busy ? '正在儲存…' : mode === 'published' ? `確認加入 ${classCode} 班` : '儲存未公開時段'}
      </button>
      {message ? <p role="status" className="mt-2 font-bold">{message}</p> : null}
    </form>
  );
}
