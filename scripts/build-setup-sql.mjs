// 把 supabase/migrations/ 依檔名順序合併成 supabase/setup.sql，
// 讓老師在 Supabase SQL Editor 一次貼上執行。改了 migration 後執行：npm run build:sql
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

export function buildSetupSql(dir) {
  const files = readdirSync(dir).filter((name) => name.endsWith('.sql')).sort();
  const parts = files.map((name) => `-- ===== ${name} =====\n${readFileSync(`${dir}/${name}`, 'utf8').trimEnd()}\n`);
  return [
    '-- 句子翻譯線上測驗：資料庫一次建立檔（由 npm run build:sql 自動產生，請勿手動修改）',
    '-- 使用方式：Supabase → SQL Editor → New query → 全選貼上這整個檔案 → Run。',
    '-- 只能在「全新」的 Supabase 專案執行一次；已經建立過的專案再執行會出現「already exists」錯誤。',
    '',
    ...parts,
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = new URL('..', import.meta.url).pathname;
  writeFileSync(`${root}supabase/setup.sql`, buildSetupSql(`${root}supabase/migrations`));
  console.log('已更新 supabase/setup.sql');
}
