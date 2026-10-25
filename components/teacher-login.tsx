'use client';

import { useState, type FormEvent } from 'react';

export function TeacherLogin() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/teacher/login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accessCode: code }), credentials: 'same-origin',
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || '登入失敗，請稍後再試。');
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登入失敗，請稍後再試。');
      setBusy(false);
    }
  }

  return <main className="mx-auto flex min-h-screen max-w-xl items-center px-5 py-12">
    <section className="surface-card w-full">
      <p className="text-sm font-black tracking-widest text-primary">TEACHER QUIZ STUDIO</p>
      <h1 className="mt-3 font-heading text-3xl font-black">教師登入</h1>
      <p className="mt-3 leading-7 text-muted-foreground">請輸入教師通行碼，才能查看題目、發布測驗與覆核成績。學生請從 Dashboard 的測驗入口進入。</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">第一次使用或忘記通行碼？到 <a href="/setup" className="font-bold text-primary underline">網站設定檢查</a>。</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <label htmlFor="teacher-code" className="block font-bold">教師通行碼</label>
        <input id="teacher-code" type="password" value={code} onChange={event => setCode(event.target.value)} autoComplete="current-password" required minLength={8} maxLength={64}
          className="h-12 w-full rounded-xl border border-border bg-white px-4 text-lg" />
        {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-900">{error}</p> : null}
        <button type="submit" disabled={busy} className="min-h-12 rounded-xl bg-primary px-6 font-black text-primary-foreground disabled:opacity-60">{busy ? '驗證中…' : '登入教師工作區'}</button>
      </form>
    </section>
  </main>;
}
