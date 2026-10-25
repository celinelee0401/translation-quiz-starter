'use client';

import { useEffect, useState } from 'react';

export function ClassLiveFeedback({ quizId, version, classCode, closesAt }: {
  quizId: string; version: number; classCode: string; closesAt: string;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    void fetch(`/api/teacher/feedback/live?quiz=${encodeURIComponent(quizId)}&version=${version}&class=${classCode}`, { cache: 'no-store' })
      .then(async response => {
        const body = await response.json() as { enabled?: boolean; error?: string };
        if (!active) return;
        if (!response.ok) setMessage(body.error ?? '無法確認設定。');
        else setEnabled(body.enabled === true);
      }).catch(() => { if (active) setMessage('無法確認設定。'); });
    return () => { active = false; };
  }, [quizId, version, classCode]);

  async function enable() {
    if (!window.confirm(`確認讓 ${classCode} 班交卷學生，在本班測驗時段內立即看到參考答案、提示和暫估／定稿分數？尚未交卷的同學可能從已交卷同學得知答案。截止後系統會收回網頁回饋。`)) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/teacher/feedback/live', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quizId, version, classCode }),
      });
      const body = await response.json() as { error?: string; enabled?: boolean };
      if (!response.ok || body.enabled !== true) setMessage(body.error ?? '尚未確認設定。');
      else { setEnabled(true); setMessage('已啟用；只在本班測驗時段內顯示。'); }
    } catch { setMessage('連線中斷，請重新整理核對設定。'); }
    finally { setBusy(false); }
  }

  const ended = Date.now() >= Date.parse(closesAt);
  return <div className="mt-2">
    {enabled ? <p className="font-bold text-emerald-800">課堂即時回饋已啟用 · 本班截止時自動收回</p> :
      <button type="button" disabled={busy || ended || enabled === null} onClick={() => void enable()}
        className="min-h-11 rounded-lg border border-primary px-3 font-bold text-primary disabled:opacity-50">
        {ended ? '本班已截止' : busy ? '正在確認…' : enabled === null ? '正在確認設定…' : '啟用本班課堂即時回饋'}
      </button>}
    {message ? <p role="status" className="mt-1 text-sm">{message}</p> : null}
  </div>;
}
