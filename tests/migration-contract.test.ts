import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  new URL(
    '../supabase/migrations/202609040001_translation_quiz_core.sql',
    import.meta.url,
  ),
  'utf8',
);
const reviewMigration = await readFile(
  new URL('../supabase/migrations/202609200001_translation_teacher_review.sql', import.meta.url),
  'utf8',
);

void test('attempt RPCs enforce enrollment, schedule, ownership, and idempotency', () => {
  assert.match(
    migration,
    /create or replace function public\.start_translation_attempt/i,
  );
  assert.match(
    migration,
    /create or replace function public\.submit_translation_attempt/i,
  );
  assert.match(migration, /e\.id = p_enrollment_id/i);
  assert.match(migration, /e\.student_id = p_student_id/i);
  assert.match(migration, /t\.opens_at <= now\(\)/i);
  assert.match(migration, /t\.closes_at > now\(\)/i);
  assert.match(migration, /for update/i);
  assert.match(migration, /submit_idempotency_key = p_idempotency_key/i);
  assert.match(migration, /item ->> 'rawAnswer'/i);
});

void test('translation tables deny browser roles and grant only the service role', () => {
  const tables = [
    'translation_quizzes',
    'translation_questions',
    'translation_rubric_units',
    'translation_quiz_targets',
    'translation_attempts',
    'translation_attempt_answers',
    'translation_review_queue',
    'translation_audit_log',
  ];
  for (const table of tables) {
    assert.match(
      migration,
      new RegExp(
        `alter table public\\.${table} enable row level security`,
        'i',
      ),
    );
    assert.match(
      migration,
      new RegExp(
        `revoke all on public\\.${table} from anon, authenticated`,
        'i',
      ),
    );
  }
  assert.match(
    migration,
    /grant select, insert, update, delete on public\.translation_attempts to service_role/i,
  );
  assert.doesNotMatch(
    migration,
    /grant\s+.+\s+on\s+public\.translation_\w+\s+to\s+(anon|authenticated)/i,
  );
});

void test('teacher review is one locked transaction with grade boundaries and an audit event', () => {
  assert.match(reviewMigration, /create or replace function public\.review_translation_answer/i);
  assert.match(reviewMigration, /for update/i);
  assert.match(reviewMigration, /updated_at is distinct from p_expected_updated_at/i);
  assert.match(reviewMigration, /p_score > v_max_score/i);
  assert.match(reviewMigration, /insert into public\.translation_review_queue/i);
  assert.match(reviewMigration, /insert into public\.translation_audit_log/i);
  assert.match(reviewMigration, /where final_score is null/i);
  assert.match(reviewMigration, /from public, anon, authenticated/i);
  assert.match(reviewMigration, /to service_role/i);
});
