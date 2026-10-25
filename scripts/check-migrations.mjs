// 在記憶體中的 Postgres（PGlite）套用 supabase/setup.sql，並驗證登入、提交與改分流程。
// 用法：npm run check:db（不連線任何外部資料庫）。
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
const db = new PGlite({ extensions: { pgcrypto } });
// Supabase provides these roles and schema; recreate them for a faithful check.
await db.exec(`create role anon; create role authenticated; create role service_role; create schema extensions;`);
// Run the single file teachers paste into the SQL Editor.
await db.exec(readFileSync(new URL('../supabase/setup.sql', import.meta.url), 'utf8'));
console.log('applied supabase/setup.sql');
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const one = async (sql, p) => Object.values((await q(sql, p))[0])[0];
let ok = 0; const check = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } ok++; console.log('ok', m); };

const id = await one(`select public.upsert_student_enrollment('115','801',8::smallint,7,'135790')`);
check(id.classCode === '801' && id.seatNumber === 7, 'upsert creates enrollment');
let r = await one(`select public.verify_student_login('115','801',7,'135790',true)`);
check(r.status === 'ok' && r.identity.enrollmentId === id.enrollmentId, 'correct PIN logs in');
for (let i = 0; i < 4; i++) { r = await one(`select public.verify_student_login('115','801',7,'000000',true)`); check(r.status === 'failed', `wrong PIN ${i + 1} fails`); }
r = await one(`select public.verify_student_login('115','801',7,'000000',true)`);
check(r.status === 'failed', 'fifth wrong PIN fails');
r = await one(`select public.verify_student_login('115','801',7,'135790',true)`);
check(r.status === 'locked', 'locked after 5 failures even with right PIN');
check((await one(`select public.verify_student_login('115','801',99,null,false)`)).status === 'failed', 'unknown seat fails');
check(await one(`select public.resolve_student_session($1, $2)`, [id.enrollmentId, id.credentialVersion]) !== null, 'session resolves');
await one(`select public.upsert_student_enrollment('115','801',8::smallint,7,'246802')`);
check(await one(`select public.resolve_student_session($1, $2)`, [id.enrollmentId, id.credentialVersion]) === null, 'PIN reset ends old session');
const seat = await one(`select public.upsert_student_enrollment('115','1001',10::smallint,3,null)`);
check((await one(`select public.verify_student_login('115','1001',3,null,false)`)).status === 'ok', 'seat mode logs in without PIN (grade 10)');
check((await one(`select public.verify_student_login('115','1001',3,'111111',true)`)).status === 'failed', 'pin mode rejects seat without PIN');

await q(`insert into translation_quizzes (quiz_id, quiz_version, title, grade_level, unit_label, score_mode, rubric_version, status, feedback_policy)
  values ('CUSTOM-G10-T', 1, 'T', 10, 'U', 'formal', 'generic-v1', 'published', 'teacher-release')`);
await q(`insert into translation_questions (quiz_id, quiz_version, question_key, display_order, prompt_zh, segmented_answer, hint, max_score)
  values ('CUSTOM-G10-T', 1, 'Q1', 1, '你好', 'Hello.', 'h', 10)`);
await q(`insert into translation_quiz_targets (quiz_id, quiz_version, school_year, grade_level, class_code, opens_at, closes_at, dashboard_visible)
  values ('CUSTOM-G10-T', 1, '115', 10, '1001', now() - interval '1 hour', now() + interval '1 hour', true)`);
const start = await one(`select public.start_translation_attempt('CUSTOM-G10-T', 1, $1, $2, '115', '1001', 10::smallint)`, [seat.studentId, seat.enrollmentId]);
check(start.status === 'in-progress', 'attempt starts');
const key = '11111111-1111-4111-8111-111111111111';
const answers = JSON.stringify([{ questionId: 'Q1', rawAnswer: 'Hello.' }]);
const s1 = await one(`select public.submit_translation_attempt($1, $2, $3, $4, $5::jsonb)`, [start.attemptId, seat.studentId, seat.enrollmentId, key, answers]);
const s2 = await one(`select public.submit_translation_attempt($1, $2, $3, $4, $5::jsonb)`, [start.attemptId, seat.studentId, seat.enrollmentId, key, answers]);
check(s1.status === 'submitted' && s2.serverSubmitTime === s1.serverSubmitTime, 'resubmit with same key is idempotent');
let threw = false;
try { await q(`select public.submit_translation_attempt($1, $2, $3, $4, $5::jsonb)`, [start.attemptId, seat.studentId, seat.enrollmentId, '22222222-2222-4222-8222-222222222222', answers]); } catch (e) { threw = /ATTEMPT_ALREADY_SUBMITTED/.test(e.message); }
check(threw, 'second submission with a new key is refused');
const ans = (await q(`select id, updated_at from translation_attempt_answers`))[0];
const rev = await one(`select public.review_translation_answer($1, $2, 'teacher:translation-studio', 9, '少了句點以外都對')`, [ans.id, ans.updated_at]);
check(rev.attemptStatus === 'finalized' && Number(rev.attemptFinalScore) === 9, 'teacher review finalizes with actor label');
check((await one(`select raw_answer from translation_attempt_answers`)) === 'Hello.', 'raw answer unchanged after review');
check(Number(await one(`select count(*) from translation_audit_log where actor_id = 'teacher:translation-studio'`)) === 1, 'review is audited');
const grants = await q(`select grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated')`);
check(grants.length === 0, 'browser roles have no table access');
const fnGrants = await q(`select p.proname from pg_proc p where p.pronamespace='public'::regnamespace and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`);
check(fnGrants.length === 0, 'browser roles cannot execute functions: ' + fnGrants.map(x => x.proname).join(','));
console.log(`\nALL ${ok} CHECKS PASSED`);
