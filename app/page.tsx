import { QuizStudio } from '@/components/quiz-studio';
import { TeacherLogin } from '@/components/teacher-login';
import { headers } from 'next/headers';
import { getDataConfig } from '@/lib/server/config';
import { isTeacherAuthenticated } from '@/lib/server/teacher-auth';
import { loadTeacherOverview, type TeacherQuiz } from '@/lib/server/teacher-overview';
import { loadAutoFinalizeSettings, type AutoFinalizeSetting } from '@/lib/server/auto-finalize';

export const dynamic = 'force-dynamic';

export default async function Home() {
  if (!await isTeacherAuthenticated(new Request('https://translation.local/', { headers: await headers() }))) return <TeacherLogin />;
  const config = getDataConfig();
  let quizzes: TeacherQuiz[] = [];
  let overviewError: string | null = null;
  let autoSettings: Record<string, AutoFinalizeSetting> = {};
  if (!config) {
    overviewError = '後端設定尚未完成，暫時無法讀取草稿。';
  } else {
    try {
      quizzes = await loadTeacherOverview(config);
      autoSettings = Object.fromEntries(await loadAutoFinalizeSettings(config).catch(() => new Map()));
    } catch (error) {
      console.error('Teacher overview unavailable:', error);
      overviewError = '目前無法讀取後端草稿，請稍後再試；測驗發布狀態未變更。';
    }
  }
  return <QuizStudio quizzes={quizzes} overviewError={overviewError} now={Date.now()} autoSettings={autoSettings} />;
}
