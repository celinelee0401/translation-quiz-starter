'use client';

import { useState } from 'react';
import type { TargetPhase } from '@/lib/quiz-management';
import { useSchoolSettings } from '@/components/school-settings-provider';
import { toSchoolLocal } from '@/lib/school-time';

export function AdjustClassTarget({ quizId, quizVersion, classCode, phase, opensAt, closesAt, attemptLimit, showsAnswers }: {
  quizId: string; quizVersion: number; classCode: string; phase: Exclude<TargetPhase, 'ended'>;
  opensAt: string; closesAt: string; attemptLimit: number;
  /** 交卷後本班時段內會看到參考答案（正式測驗即時回饋或立即回饋）。 */
  showsAnswers: boolean;
}) {
  const { timeZone } = useSchoolSettings();
  const toTaipeiLocal = (iso: string) => toSchoolLocal(new Date(iso), timeZone);
  const [opensAtLocal, setOpensAtLocal] = useState(() => toTaipeiLocal(opensAt));
  const [closesAtLocal, setClosesAtLocal] = useState(() => toTaipeiLocal(closesAt));
  const [grace, setGrace] = useState(0);
  const [limit, setLimit] = useState(attemptLimit);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function send(payload: Record<string, unknown>, confirmText: string, done: string) {
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/teacher/adjust-target', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quizId, quizVersion, classCode, ...payload }),
      });
      const body = await response.json() as { status?: string; error?: string };
      if (!response.ok || body.status !== 'ok') throw new Error(body.error || '時段調整未確認。');
      setMessage(`${done} 正在重新整理…`);
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '時段調整未確認。');
    } finally {
      setBusy(false);
    }
  }

  const button = 'min-h-11 rounded-lg px-4 font-black disabled:opacity-50';
  return <details className="mt-2 rounded-lg border border-sky-300 bg-sky-50 p-3 text-sky-950">
    <summary className="cursor-pointer font-black">
      調整 {classCode} 班：{phase === 'upcoming' ? '立即開放、改時段' : '立即結束、延長或提早截止'}、作答次數
    </summary>
    <div className="mt-3 flex flex-wrap items-end gap-3 text-sm">
      {phase === 'upcoming' ? (
        <button type="button" disabled={busy} className={`${button} bg-emerald-700 text-white`}
          onClick={() => send({ action: 'open-now' },
            `確定現在就開放 ${classCode} 班？學生會立刻可以從作答連結進入，截止時間不變。`,
            `${classCode} 班已開放。`)}>
          立即開放
        </button>
      ) : (
        <>
          <label className="font-bold">結束時機
            <select value={grace} onChange={event => setGrace(Number(event.target.value))}
              className="mt-1 block min-h-11 rounded-lg border border-input bg-background px-2 text-base">
              <option value={0}>現在立刻結束</option>
              <option value={2}>2 分鐘後結束</option>
              <option value={5}>5 分鐘後結束</option>
              <option value={10}>10 分鐘後結束</option>
            </select>
          </label>
          <button type="button" disabled={busy} className={`${button} bg-red-700 text-white`}
            onClick={() => send({ action: 'end-now', graceMinutes: grace },
              `確定${grace ? ` ${grace} 分鐘後` : '現在'}結束 ${classCode} 班？\n結束後還在作答、尚未交卷的學生將無法送出；已交卷的作答與成績都會保留。`,
              grace ? `${classCode} 班將在 ${grace} 分鐘後結束。` : `${classCode} 班已結束。`)}>
            {grace ? `${grace} 分鐘後結束` : '立即結束'}
          </button>
        </>
      )}
    </div>
    <form className="mt-4 grid gap-3 border-t border-sky-200 pt-3 text-sm sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      onSubmit={event => {
        event.preventDefault();
        void send({ action: 'reschedule', closesAtLocal, ...(phase === 'upcoming' ? { opensAtLocal } : {}) },
          `確定把 ${classCode} 班時段改為 ${phase === 'upcoming' ? `${opensAtLocal.replace('T', ' ')} 開放、` : ''}${closesAtLocal.replace('T', ' ')} 截止？`,
          `${classCode} 班時段已更新。`);
      }}>
      <label className="font-bold">開放時間（學校時間）
        <input type="datetime-local" required value={opensAtLocal} disabled={phase !== 'upcoming'}
          onChange={event => setOpensAtLocal(event.target.value)}
          className="mt-1 min-h-11 w-full rounded-lg border border-input bg-background px-2 text-base disabled:opacity-60" />
      </label>
      <label className="font-bold">截止時間（學校時間）
        <input type="datetime-local" required value={closesAtLocal} onChange={event => setClosesAtLocal(event.target.value)}
          className="mt-1 min-h-11 w-full rounded-lg border border-input bg-background px-2 text-base" />
      </label>
      <button type="submit" disabled={busy} className={`${button} border border-primary text-primary`}>儲存新時段</button>
      {phase === 'active' ? <p className="text-muted-foreground sm:col-span-3">進行中只能改截止時間（延長或提早）；開放時間不變。</p> : null}
    </form>
    <form className="mt-4 flex flex-wrap items-end gap-3 border-t border-sky-200 pt-3 text-sm"
      onSubmit={event => {
        event.preventDefault();
        void send({ action: 'attempt-limit', attemptLimit: limit },
          `確定把 ${classCode} 班作答次數改為每人 ${limit} 次？${limit > 1 && showsAnswers ? '\n注意：學生交卷後會在時段內看到參考答案，再次作答等於看過答案再考。' : ''}`,
          `${classCode} 班作答次數已改為每人 ${limit} 次。`);
      }}>
      <label className="font-bold">每位學生可作答次數
        <select value={limit} onChange={event => setLimit(Number(event.target.value))}
          className="mt-1 block min-h-11 rounded-lg border border-input bg-background px-2 text-base">
          {[1, 2, 3, 4, 5].map(count => <option key={count} value={count}>{count} 次{count === 1 ? '（預設）' : ''}</option>)}
        </select>
      </label>
      <button type="submit" disabled={busy || limit === attemptLimit} className={`${button} border border-primary text-primary`}>儲存次數</button>
      <p className="basis-full leading-6 text-muted-foreground">
        目前每人 {attemptLimit} 次。多次作答時，「貼表格用」成績取最後一次定稿；完整 CSV 會列出每一次。
        {showsAnswers ? ' 這份測驗交卷後會在時段內顯示參考答案，開放多次作答前請先評估。' : ''}
      </p>
    </form>
    {message ? <output className="mt-2 block text-sm font-bold">{message}</output> : null}
  </details>;
}
