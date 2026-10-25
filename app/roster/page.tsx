import { headers } from 'next/headers';
import { RosterImport } from '@/components/roster-import';
import { TeacherLogin } from '@/components/teacher-login';
import { getDataConfig } from '@/lib/server/config';
import { loadRoster, type RosterEntry } from '@/lib/server/roster';
import { isTeacherAuthenticated } from '@/lib/server/teacher-auth';

export const dynamic = 'force-dynamic';

export default async function RosterPage() {
  if (!await isTeacherAuthenticated(new Request('https://translation.local/', { headers: await headers() }))) return <TeacherLogin />;
  const config = getDataConfig();
  let roster: RosterEntry[] = [];
  let error: string | null = config ? null : '後端設定尚未完成。';
  if (config) {
    try { roster = await loadRoster(config); } catch { error = '目前無法讀取名冊。'; }
  }
  const usesPin = config?.loginMode !== 'seat';
  const byClass = Map.groupBy(roster, (entry) => entry.classCode);
  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <a href="/" className="font-black text-primary hover:underline">← 回教師工作區</a>
      <h1 className="mt-4 font-heading text-3xl font-black">學生名冊與 PIN</h1>
      <p className="mt-2 leading-7 text-muted-foreground">
        學年 {config?.schoolYear ?? '—'}｜登入方式：{usesPin ? '班級＋座號＋PIN' : '班級＋座號（練習用，無密碼）'}
      </p>
      <section className="surface-card mt-6">
        <RosterImport usesPin={usesPin} />
      </section>
      <section className="surface-card mt-6">
        <h2 className="text-xl font-black">目前名冊</h2>
        {error ? <p role="alert" className="mt-3 font-bold text-rose-800">{error}</p> : null}
        {!error && !roster.length ? <p className="mt-3 text-muted-foreground">尚無學生。</p> : null}
        {[...byClass].map(([classCode, entries]) => (
          <div key={classCode} className="mt-4">
            <h3 className="font-black">{classCode} 班（{entries.length} 人）</h3>
            <p className="mt-1 text-sm leading-6">
              {entries.map((entry) => `${entry.seatNumber}${usesPin && !entry.hasPin ? '（未設 PIN）' : ''}`).join('、')}
            </p>
          </div>
        ))}
      </section>
    </main>
  );
}
