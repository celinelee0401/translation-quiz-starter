// 產生「教師通行碼」的 SQL。用法：
//   node --experimental-strip-types scripts/teacher-code-sql.ts
// 依提示輸入通行碼（至少 8 字元，畫面不顯示），把印出的 SQL 貼到
// Supabase 的 SQL Editor 執行。重設通行碼也用同一個指令，舊的登入會全部失效。
import { createInterface } from 'node:readline';

const code = await readHidden('教師通行碼（8–64 字元）：');
if (code.length < 8 || code.length > 64) {
  console.error('通行碼需為 8–64 字元。');
  process.exit(1);
}
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 }, key, 256);
const hash = `v2.${Buffer.from(salt).toString('base64url')}.${Buffer.from(bits).toString('base64url')}`;

console.log(`
insert into public.teacher_access_settings (id, access_code_hash, updated_at)
values (true, '${hash}', now())
on conflict (id) do update set access_code_hash = excluded.access_code_hash, updated_at = now();
`);

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const output = rl as unknown as { _writeToOutput: (text: string) => void };
    process.stdout.write(prompt);
    output._writeToOutput = () => {};
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}
