'use client';

import { useState } from 'react';

export function SetupTeacherCode() {
  const [setupCode, setSetupCode] = useState('');
  const [teacherCode, setTeacherCode] = useState('');
  const [confirmCode, setConfirmCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (teacherCode !== confirmCode) {
      setMessage('兩次輸入的教師通行碼不一樣。');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/setup/teacher-code', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ setupCode, teacherCode }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || '儲存失敗。');
      setSetupCode(''); setTeacherCode(''); setConfirmCode('');
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '儲存失敗。');
      setBusy(false);
    }
  }

  const field = 'mt-2 h-11 w-full rounded-xl border border-input bg-background px-3 text-base';
  return (
    <form onSubmit={submit} className="space-y-4">
      <h2 className="text-xl font-black">設定或重設教師通行碼</h2>
      <p className="text-sm leading-6 text-muted-foreground">
        「設定碼」是部署時你在 SETUP_CODE 填的那組密語，用來證明你是這個網站的管理者。重設後，所有已登入的教師都要重新登入。
      </p>
      <label className="block font-bold">設定碼（SETUP_CODE）
        <input type="password" value={setupCode} onChange={(event) => setSetupCode(event.target.value)} required autoComplete="off" className={field} />
      </label>
      <label className="block font-bold">新的教師通行碼（8–64 字元）
        <input type="password" value={teacherCode} onChange={(event) => setTeacherCode(event.target.value)} required minLength={8} maxLength={64} autoComplete="new-password" className={field} />
      </label>
      <label className="block font-bold">再輸入一次
        <input type="password" value={confirmCode} onChange={(event) => setConfirmCode(event.target.value)} required minLength={8} maxLength={64} autoComplete="new-password" className={field} />
      </label>
      {message ? <p role="alert" className="rounded-xl bg-rose-50 p-3 font-semibold text-rose-800">{message}</p> : null}
      <button type="submit" disabled={busy} className="h-12 rounded-xl bg-primary px-6 font-black text-primary-foreground disabled:opacity-50">
        {busy ? '儲存中…' : '儲存教師通行碼'}
      </button>
    </form>
  );
}
