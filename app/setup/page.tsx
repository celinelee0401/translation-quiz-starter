import { SetupTeacherCode } from '@/components/setup-teacher-code';
import { loadSetupChecks, type CheckState } from '@/lib/server/setup';

export const dynamic = 'force-dynamic';

const badge: Record<CheckState, { label: string; className: string }> = {
  ok: { label: '完成', className: 'bg-emerald-100 text-emerald-900' },
  todo: { label: '待完成', className: 'bg-amber-100 text-amber-900' },
  error: { label: '需修正', className: 'bg-rose-100 text-rose-900' },
};

export default async function SetupPage() {
  const checks = await loadSetupChecks();
  const ready = checks.every((check) => check.state === 'ok');
  const canSetCode = checks.some((check) => check.key === 'teacher-code') &&
    checks.find((check) => check.key === 'setup-code')?.state === 'ok';
  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <p className="text-sm font-black tracking-widest text-primary">SETUP</p>
      <h1 className="mt-2 font-heading text-3xl font-black">網站設定檢查</h1>
      <p className="mt-3 leading-7 text-muted-foreground">
        照順序完成每一項。改了 Cloudflare 的變數之後，要按「Deploy」或等它重新部署，再回來重新整理這一頁。
        本頁不會顯示任何金鑰。
      </p>
      <ol className="mt-6 space-y-3">
        {checks.map((check, index) => (
          <li key={check.key} className="surface-card">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-black">{index + 1}. {check.title}</span>
              <span className={`rounded-full px-3 py-0.5 text-sm font-black ${badge[check.state].className}`}>{badge[check.state].label}</span>
            </div>
            <p className="mt-2 leading-7">{check.detail}</p>
          </li>
        ))}
      </ol>
      {canSetCode ? (
        <section className="surface-card mt-6">
          <SetupTeacherCode />
        </section>
      ) : null}
      {ready ? (
        <p className="mt-6 rounded-xl bg-emerald-50 p-4 font-bold text-emerald-900">
          全部完成！到 <a className="underline" href="/">教師工作區</a> 用教師通行碼登入，開始建立測驗。
        </p>
      ) : null}
    </main>
  );
}
