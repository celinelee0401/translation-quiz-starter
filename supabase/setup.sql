-- 句子翻譯線上測驗：資料庫一次建立檔（由 npm run build:sql 自動產生，請勿手動修改）
-- 使用方式：Supabase → SQL Editor → New query → 全選貼上這整個檔案 → Run。
-- 只能在「全新」的 Supabase 專案執行一次；已經建立過的專案再執行會出現「already exists」錯誤。

-- ===== 202609010001_school_roster.sql =====
-- Student roster, optional PINs, and the teacher access code.
-- Every table is server-only: browser roles get no access, and the app server
-- talks to Supabase with the secret key through the functions below.
create extension if not exists pgcrypto with schema extensions;

create table public.students (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id),
  school_year text not null check (school_year ~ '^[0-9]{3,4}$'),
  class_code text not null check (class_code ~ '^[A-Za-z0-9-]{1,16}$'),
  grade_level smallint not null check (grade_level between 1 and 12),
  seat_number integer not null check (seat_number between 1 and 99),
  -- Null when the school uses class + seat login without a PIN.
  pin_hash text,
  -- Changing the PIN bumps this value, which invalidates existing sessions.
  credential_version timestamptz not null default now(),
  failed_logins integer not null default 0,
  locked_until timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index enrollments_active_seat_key
  on public.enrollments (school_year, class_code, seat_number)
  where active;

create table public.teacher_access_settings (
  id boolean primary key default true check (id),
  access_code_hash text not null,
  updated_at timestamptz not null default now()
);

alter table public.students enable row level security;
alter table public.enrollments enable row level security;
alter table public.teacher_access_settings enable row level security;

revoke all on public.students from anon, authenticated;
revoke all on public.enrollments from anon, authenticated;
revoke all on public.teacher_access_settings from anon, authenticated;

grant select on public.students to service_role;
grant select on public.enrollments to service_role;
grant select, insert, update on public.teacher_access_settings to service_role;

create or replace function public.student_identity_json(e public.enrollments)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'studentId', e.student_id,
    'enrollmentId', e.id,
    'schoolYear', e.school_year,
    'classCode', e.class_code,
    'seatNumber', e.seat_number,
    'gradeLevel', e.grade_level,
    'credentialVersion', e.credential_version
  );
$$;

-- Returns {status:'ok', identity} or {status:'failed'|'locked'}. It never raises
-- on a wrong PIN, so the failure counter is committed.
create or replace function public.verify_student_login(
  p_school_year text,
  p_class_code text,
  p_seat_number integer,
  p_pin text,
  p_require_pin boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_enrollment public.enrollments%rowtype;
begin
  select * into v_enrollment
  from public.enrollments
  where school_year = p_school_year
    and class_code = p_class_code
    and seat_number = p_seat_number
    and active
  for update;

  if not found then
    return jsonb_build_object('status', 'failed');
  end if;
  if v_enrollment.locked_until is not null and v_enrollment.locked_until > now() then
    return jsonb_build_object('status', 'locked', 'lockedUntil', v_enrollment.locked_until);
  end if;

  if p_require_pin then
    if v_enrollment.pin_hash is null
      or p_pin is null
      or extensions.crypt(p_pin, v_enrollment.pin_hash) <> v_enrollment.pin_hash then
      update public.enrollments
        set failed_logins = failed_logins + 1,
            locked_until = case when failed_logins + 1 >= 5
              then now() + interval '10 minutes' else null end
      where id = v_enrollment.id;
      return jsonb_build_object('status', 'failed');
    end if;
  end if;

  if v_enrollment.failed_logins <> 0 or v_enrollment.locked_until is not null then
    update public.enrollments
      set failed_logins = 0, locked_until = null
    where id = v_enrollment.id;
  end if;

  return jsonb_build_object('status', 'ok', 'identity', public.student_identity_json(v_enrollment));
end;
$$;

-- Re-checks a session against the roster: removed students and changed PINs
-- end existing sessions.
create or replace function public.resolve_student_session(
  p_enrollment_id uuid,
  p_credential_version timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.student_identity_json(e)
  from public.enrollments e
  join public.students s on s.id = e.student_id
  where e.id = p_enrollment_id
    and e.active
    and s.archived_at is null
    and e.credential_version = p_credential_version;
$$;

-- Adds a seat to the roster or resets its PIN. A null PIN means no PIN.
create or replace function public.upsert_student_enrollment(
  p_school_year text,
  p_class_code text,
  p_grade_level smallint,
  p_seat_number integer,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_enrollment public.enrollments%rowtype;
  v_student_id uuid;
  v_hash text;
begin
  if p_pin is not null and p_pin !~ '^[0-9]{6}$' then
    raise exception using errcode = 'P0001', message = 'PIN_INVALID';
  end if;
  v_hash := case when p_pin is null then null
    else extensions.crypt(p_pin, extensions.gen_salt('bf', 10)) end;

  select * into v_enrollment
  from public.enrollments
  where school_year = p_school_year
    and class_code = p_class_code
    and seat_number = p_seat_number
    and active
  for update;

  if found then
    update public.enrollments
      set pin_hash = v_hash,
          grade_level = p_grade_level,
          credential_version = now(),
          failed_logins = 0,
          locked_until = null
    where id = v_enrollment.id
    returning * into v_enrollment;
  else
    insert into public.students default values returning id into v_student_id;
    insert into public.enrollments (
      student_id, school_year, class_code, grade_level, seat_number, pin_hash
    ) values (
      v_student_id, p_school_year, p_class_code, p_grade_level, p_seat_number, v_hash
    )
    returning * into v_enrollment;
  end if;

  return public.student_identity_json(v_enrollment);
end;
$$;

revoke all on function public.student_identity_json(public.enrollments) from public, anon, authenticated;
revoke all on function public.verify_student_login(text, text, integer, text, boolean) from public, anon, authenticated;
revoke all on function public.resolve_student_session(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.upsert_student_enrollment(text, text, smallint, integer, text) from public, anon, authenticated;
grant execute on function public.student_identity_json(public.enrollments) to service_role;
grant execute on function public.verify_student_login(text, text, integer, text, boolean) to service_role;
grant execute on function public.resolve_student_session(uuid, timestamptz) to service_role;
grant execute on function public.upsert_student_enrollment(text, text, smallint, integer, text) to service_role;

-- ===== 202609040001_translation_quiz_core.sql =====
-- Depends on the students/enrollments roster from 202609010001_school_roster.sql.
create extension if not exists pgcrypto with schema extensions;

create table public.translation_quizzes (
  quiz_id text not null,
  quiz_version integer not null check (quiz_version > 0),
  title text not null,
  grade_level smallint not null check (grade_level between 1 and 12),
  unit_label text not null,
  score_mode text not null check (score_mode in ('practice', 'formal')),
  rubric_version text not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'closed', 'archived')),
  feedback_policy text not null check (feedback_policy in ('immediate', 'class-closed', 'all-closed', 'teacher-release')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (quiz_id, quiz_version)
);

create table public.translation_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id text not null,
  quiz_version integer not null,
  question_key text not null,
  display_order integer not null check (display_order > 0),
  prompt_zh text not null,
  segmented_answer text not null,
  hint text not null,
  max_score numeric(6,2) not null check (max_score > 0),
  created_at timestamptz not null default now(),
  foreign key (quiz_id, quiz_version)
    references public.translation_quizzes(quiz_id, quiz_version)
    on delete cascade,
  unique (quiz_id, quiz_version, question_key),
  unique (quiz_id, quiz_version, display_order)
);

create table public.translation_rubric_units (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.translation_questions(id) on delete cascade,
  rubric_version text not null,
  unit_type text not null check (unit_type in ('meaning', 'pattern', 'grammar', 'spelling', 'convention')),
  label text not null,
  requirement text not null,
  machine_rule jsonb not null default '{}'::jsonb check (jsonb_typeof(machine_rule) = 'object'),
  points numeric(6,2) not null check (points >= 0),
  accepted_alternatives jsonb not null default '[]'::jsonb check (jsonb_typeof(accepted_alternatives) = 'array'),
  display_order integer not null check (display_order > 0),
  created_at timestamptz not null default now(),
  unique (question_id, rubric_version, display_order)
);

create table public.translation_quiz_targets (
  id uuid primary key default gen_random_uuid(),
  quiz_id text not null,
  quiz_version integer not null,
  school_year text not null,
  grade_level smallint not null check (grade_level between 1 and 12),
  class_code text not null,
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  feedback_at timestamptz,
  dashboard_visible boolean not null default false,
  attempt_limit integer not null default 1 check (attempt_limit between 1 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (quiz_id, quiz_version)
    references public.translation_quizzes(quiz_id, quiz_version)
    on delete cascade,
  check (closes_at > opens_at),
  unique (quiz_id, quiz_version, school_year, class_code)
);

create table public.translation_attempts (
  id uuid primary key default gen_random_uuid(),
  quiz_id text not null,
  quiz_version integer not null,
  rubric_version text not null,
  target_id uuid not null references public.translation_quiz_targets(id),
  student_id uuid not null references public.students(id),
  enrollment_id uuid not null references public.enrollments(id),
  server_start_time timestamptz not null default now(),
  server_submit_time timestamptz,
  status text not null default 'in-progress' check (status in ('in-progress', 'submitted', 'review-pending', 'finalized')),
  submit_idempotency_key uuid,
  rule_score numeric(7,2),
  provisional_score numeric(7,2),
  final_score numeric(7,2),
  confidence numeric(5,4) check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (quiz_id, quiz_version)
    references public.translation_quizzes(quiz_id, quiz_version),
  unique (enrollment_id, submit_idempotency_key)
);

create table public.translation_attempt_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.translation_attempts(id) on delete cascade,
  question_id uuid not null references public.translation_questions(id),
  raw_answer text not null check (char_length(raw_answer) <= 1000),
  normalized_answer text,
  rule_breakdown jsonb,
  ai_review jsonb,
  provisional_score numeric(6,2),
  final_score numeric(6,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (attempt_id, question_id)
);

create table public.translation_review_queue (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.translation_attempts(id) on delete cascade,
  answer_id uuid not null references public.translation_attempt_answers(id) on delete cascade,
  reason text not null check (reason in ('low-confidence', 'student-appeal', 'rule-conflict')),
  status text not null default 'open' check (status in ('open', 'resolved')),
  teacher_score numeric(6,2),
  teacher_reason text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.translation_audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_type text not null check (actor_type in ('teacher', 'student', 'system')),
  actor_id text not null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  before_data jsonb,
  after_data jsonb
);

create index idx_translation_targets_availability
  on public.translation_quiz_targets(school_year, class_code, opens_at, closes_at);
create index idx_translation_attempts_student_time
  on public.translation_attempts(student_id, server_start_time desc);
create index idx_translation_attempts_target_status
  on public.translation_attempts(target_id, status);
create index idx_translation_review_queue_status
  on public.translation_review_queue(status, created_at);
create index idx_translation_audit_entity
  on public.translation_audit_log(entity_type, entity_id, occurred_at desc);

alter table public.translation_quizzes enable row level security;
alter table public.translation_questions enable row level security;
alter table public.translation_rubric_units enable row level security;
alter table public.translation_quiz_targets enable row level security;
alter table public.translation_attempts enable row level security;
alter table public.translation_attempt_answers enable row level security;
alter table public.translation_review_queue enable row level security;
alter table public.translation_audit_log enable row level security;

revoke all on public.translation_quizzes from anon, authenticated;
revoke all on public.translation_questions from anon, authenticated;
revoke all on public.translation_rubric_units from anon, authenticated;
revoke all on public.translation_quiz_targets from anon, authenticated;
revoke all on public.translation_attempts from anon, authenticated;
revoke all on public.translation_attempt_answers from anon, authenticated;
revoke all on public.translation_review_queue from anon, authenticated;
revoke all on public.translation_audit_log from anon, authenticated;

grant select, insert, update, delete on public.translation_quizzes to service_role;
grant select, insert, update, delete on public.translation_questions to service_role;
grant select, insert, update, delete on public.translation_rubric_units to service_role;
grant select, insert, update, delete on public.translation_quiz_targets to service_role;
grant select, insert, update, delete on public.translation_attempts to service_role;
grant select, insert, update, delete on public.translation_attempt_answers to service_role;
grant select, insert, update, delete on public.translation_review_queue to service_role;
grant select, insert on public.translation_audit_log to service_role;
grant usage, select on sequence public.translation_audit_log_id_seq to service_role;

create or replace function public.start_translation_attempt(
  p_quiz_id text,
  p_quiz_version integer,
  p_student_id uuid,
  p_enrollment_id uuid,
  p_school_year text,
  p_class_code text,
  p_grade_level smallint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target record;
  v_attempt public.translation_attempts%rowtype;
  v_attempt_count integer;
begin
  if not exists (
    select 1
    from public.enrollments e
    where e.id = p_enrollment_id
      and e.student_id = p_student_id
      and e.school_year = p_school_year
      and e.class_code = p_class_code
      and e.grade_level = p_grade_level
      and e.active = true
  ) then
    raise exception using errcode = 'P0001', message = 'ATTEMPT_NOT_ALLOWED';
  end if;

  select t.*, q.rubric_version
    into v_target
  from public.translation_quiz_targets t
  join public.translation_quizzes q
    on q.quiz_id = t.quiz_id
   and q.quiz_version = t.quiz_version
  where t.quiz_id = p_quiz_id
    and t.quiz_version = p_quiz_version
    and t.school_year = p_school_year
    and t.class_code = p_class_code
    and t.grade_level = p_grade_level
    and q.grade_level = p_grade_level
    and q.status = 'published'
    and t.opens_at <= now()
    and t.closes_at > now();

  if not found then
    raise exception using errcode = 'P0001', message = 'ATTEMPT_NOT_ALLOWED';
  end if;

  select a.*
    into v_attempt
  from public.translation_attempts a
  where a.target_id = v_target.id
    and a.enrollment_id = p_enrollment_id
    and a.status = 'in-progress'
  order by a.server_start_time desc
  limit 1;

  if found then
    return jsonb_build_object(
      'attemptId', v_attempt.id,
      'quizId', v_attempt.quiz_id,
      'quizVersion', v_attempt.quiz_version,
      'serverStartTime', v_attempt.server_start_time,
      'status', v_attempt.status
    );
  end if;

  select count(*)
    into v_attempt_count
  from public.translation_attempts a
  where a.target_id = v_target.id
    and a.enrollment_id = p_enrollment_id
    and a.status in ('submitted', 'review-pending', 'finalized');

  if v_attempt_count >= v_target.attempt_limit then
    raise exception using errcode = 'P0001', message = 'ATTEMPT_LIMIT_REACHED';
  end if;

  insert into public.translation_attempts (
    quiz_id,
    quiz_version,
    rubric_version,
    target_id,
    student_id,
    enrollment_id
  ) values (
    p_quiz_id,
    p_quiz_version,
    v_target.rubric_version,
    v_target.id,
    p_student_id,
    p_enrollment_id
  )
  returning * into v_attempt;

  insert into public.translation_audit_log (
    actor_type,
    actor_id,
    action,
    entity_type,
    entity_id,
    after_data
  ) values (
    'student',
    p_student_id::text,
    'start-attempt',
    'translation-attempt',
    v_attempt.id::text,
    jsonb_build_object('status', 'in-progress')
  );

  return jsonb_build_object(
    'attemptId', v_attempt.id,
    'quizId', v_attempt.quiz_id,
    'quizVersion', v_attempt.quiz_version,
    'serverStartTime', v_attempt.server_start_time,
    'status', v_attempt.status
  );
end;
$$;

create or replace function public.submit_translation_attempt(
  p_attempt_id uuid,
  p_student_id uuid,
  p_enrollment_id uuid,
  p_idempotency_key uuid,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.translation_attempts%rowtype;
  v_valid_count integer;
  v_distinct_count integer;
  v_expected_count integer;
  v_matched_count integer;
  v_submit_time timestamptz;
begin
  select a.*
    into v_attempt
  from public.translation_attempts a
  where a.id = p_attempt_id
    and a.student_id = p_student_id
    and a.enrollment_id = p_enrollment_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ATTEMPT_NOT_ALLOWED';
  end if;

  if v_attempt.status <> 'in-progress' then
    if v_attempt.submit_idempotency_key = p_idempotency_key
      and v_attempt.status in ('submitted', 'review-pending', 'finalized') then
      return jsonb_build_object(
        'attemptId', v_attempt.id,
        'serverSubmitTime', v_attempt.server_submit_time,
        'status', 'submitted'
      );
    end if;
    raise exception using errcode = 'P0001', message = 'ATTEMPT_ALREADY_SUBMITTED';
  end if;

  if not exists (
    select 1
    from public.translation_quiz_targets t
    where t.id = v_attempt.target_id
      and t.closes_at > now()
  ) then
    raise exception using errcode = 'P0001', message = 'ATTEMPT_CLOSED';
  end if;

  if jsonb_typeof(p_answers) <> 'array' then
    raise exception using errcode = 'P0001', message = 'INVALID_ANSWERS';
  end if;

  select
    count(*),
    count(distinct (item ->> 'questionId'))
    into v_valid_count, v_distinct_count
  from jsonb_array_elements(p_answers) item
  where jsonb_typeof(item) = 'object'
    and jsonb_typeof(item -> 'questionId') = 'string'
    and jsonb_typeof(item -> 'rawAnswer') = 'string'
    and char_length(item ->> 'rawAnswer') <= 1000;

  if v_valid_count <> jsonb_array_length(p_answers)
    or v_distinct_count <> v_valid_count then
    raise exception using errcode = 'P0001', message = 'INVALID_ANSWERS';
  end if;

  select count(*)
    into v_expected_count
  from public.translation_questions q
  where q.quiz_id = v_attempt.quiz_id
    and q.quiz_version = v_attempt.quiz_version;

  select count(*)
    into v_matched_count
  from jsonb_array_elements(p_answers) item
  join public.translation_questions q
    on q.quiz_id = v_attempt.quiz_id
   and q.quiz_version = v_attempt.quiz_version
   and q.question_key = item ->> 'questionId';

  if v_expected_count = 0
    or v_valid_count <> v_expected_count
    or v_matched_count <> v_expected_count then
    raise exception using errcode = 'P0001', message = 'INVALID_ANSWERS';
  end if;

  insert into public.translation_attempt_answers (
    attempt_id,
    question_id,
    raw_answer
  )
  select
    v_attempt.id,
    q.id,
    item ->> 'rawAnswer'
  from jsonb_array_elements(p_answers) item
  join public.translation_questions q
    on q.quiz_id = v_attempt.quiz_id
   and q.quiz_version = v_attempt.quiz_version
   and q.question_key = item ->> 'questionId';

  v_submit_time := now();
  update public.translation_attempts
    set status = 'submitted',
        server_submit_time = v_submit_time,
        submit_idempotency_key = p_idempotency_key,
        updated_at = v_submit_time
  where id = v_attempt.id;

  insert into public.translation_audit_log (
    actor_type,
    actor_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data
  ) values (
    'student',
    p_student_id::text,
    'submit-attempt',
    'translation-attempt',
    v_attempt.id::text,
    jsonb_build_object('status', 'in-progress'),
    jsonb_build_object('status', 'submitted', 'answerCount', v_valid_count)
  );

  return jsonb_build_object(
    'attemptId', v_attempt.id,
    'serverSubmitTime', v_submit_time,
    'status', 'submitted'
  );
end;
$$;

revoke all on function public.start_translation_attempt(text, integer, uuid, uuid, text, text, smallint) from public, anon, authenticated;
revoke all on function public.submit_translation_attempt(uuid, uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.start_translation_attempt(text, integer, uuid, uuid, text, text, smallint) to service_role;
grant execute on function public.submit_translation_attempt(uuid, uuid, uuid, uuid, jsonb) to service_role;

comment on table public.translation_questions is 'Private translation prompts, answer keys, hints, and scoring inputs; never exposed through DashboardFeed.';
comment on table public.translation_attempt_answers is 'Immutable raw student responses plus later scoring artifacts; raw_answer is never overwritten by normalization.';
comment on function public.start_translation_attempt is 'Atomically verifies enrollment, quiz target, server time, and attempt limit before starting or resuming an attempt.';
comment on function public.submit_translation_attempt is 'Atomically validates ownership, deadline, idempotency, and the complete question set before preserving raw answers.';

-- ===== 202609200001_translation_teacher_review.sql =====
-- Teacher scores are written in one database transaction with the audit trail.
-- No student-facing release is performed by this function.
alter table public.translation_review_queue
  drop constraint if exists translation_review_queue_reason_check;

alter table public.translation_review_queue
  add constraint translation_review_queue_reason_check
  check (reason in ('low-confidence', 'student-appeal', 'rule-conflict', 'teacher-review'));

create or replace function public.review_translation_answer(
  p_answer_id uuid,
  p_expected_updated_at timestamptz,
  p_teacher_email text,
  p_score numeric,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt_id uuid;
  v_attempt public.translation_attempts%rowtype;
  v_answer public.translation_attempt_answers%rowtype;
  v_max_score numeric(6,2);
  v_total numeric(7,2);
  v_unscored integer;
  v_status text;
  v_now timestamptz := now();
  v_reason text := btrim(p_reason);
begin
  -- The app server authenticates the teacher before calling; this value is the
  -- actor label recorded in the audit trail.
  if p_teacher_email is null or char_length(btrim(p_teacher_email)) not between 3 and 200 then
    raise exception using errcode = 'P0001', message = 'REVIEW_NOT_ALLOWED';
  end if;
  if p_score is null or p_score < 0 or p_score <> round(p_score, 2) then
    raise exception using errcode = 'P0001', message = 'REVIEW_INVALID_SCORE';
  end if;
  if v_reason is null or char_length(v_reason) < 4 or char_length(v_reason) > 1000 then
    raise exception using errcode = 'P0001', message = 'REVIEW_REASON_REQUIRED';
  end if;

  select answer.attempt_id into v_attempt_id
  from public.translation_attempt_answers answer
  where answer.id = p_answer_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'REVIEW_NOT_FOUND';
  end if;

  -- All review writes lock the attempt before its answer to serialize totals.
  select * into v_attempt
  from public.translation_attempts
  where id = v_attempt_id
  for update;
  if v_attempt.status not in ('submitted', 'review-pending', 'finalized') then
    raise exception using errcode = 'P0001', message = 'REVIEW_NOT_SUBMITTED';
  end if;

  select * into v_answer
  from public.translation_attempt_answers
  where id = p_answer_id and attempt_id = v_attempt.id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'REVIEW_NOT_FOUND';
  end if;
  if v_answer.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'REVIEW_STALE';
  end if;
  select max_score into v_max_score
  from public.translation_questions
  where id = v_answer.question_id
    and quiz_id = v_attempt.quiz_id
    and quiz_version = v_attempt.quiz_version;
  if not found or p_score > v_max_score then
    raise exception using errcode = 'P0001', message = 'REVIEW_INVALID_SCORE';
  end if;

  update public.translation_attempt_answers
  set final_score = p_score,
      updated_at = v_now
  where id = p_answer_id;

  update public.translation_review_queue
  set status = 'resolved',
      teacher_score = p_score,
      teacher_reason = v_reason,
      reviewed_by = p_teacher_email,
      reviewed_at = v_now
  where answer_id = p_answer_id and status = 'open';

  insert into public.translation_review_queue (
    attempt_id, answer_id, reason, status, teacher_score,
    teacher_reason, reviewed_by, reviewed_at
  ) values (
    v_attempt.id, p_answer_id, 'teacher-review', 'resolved', p_score,
    v_reason, p_teacher_email, v_now
  );

  select count(*) filter (where final_score is null), sum(final_score)
  into v_unscored, v_total
  from public.translation_attempt_answers
  where attempt_id = v_attempt.id;
  v_status := case when v_unscored = 0 then 'finalized' else 'review-pending' end;
  update public.translation_attempts
  set status = v_status,
      final_score = case when v_unscored = 0 then v_total else null end,
      updated_at = v_now
  where id = v_attempt.id;

  insert into public.translation_audit_log (
    actor_type, actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    'teacher', p_teacher_email, 'teacher-review-answer',
    'translation-attempt', v_attempt.id::text,
    jsonb_build_object(
      'answerId', p_answer_id,
      'previousScore', v_answer.final_score,
      'attemptStatus', v_attempt.status,
      'attemptFinalScore', v_attempt.final_score
    ),
    jsonb_build_object(
      'answerId', p_answer_id,
      'score', p_score,
      'reason', v_reason,
      'attemptStatus', v_status,
      'attemptFinalScore', case when v_unscored = 0 then v_total else null end
    )
  );

  return jsonb_build_object(
    'answerId', p_answer_id,
    'attemptId', v_attempt.id,
    'answerScore', p_score,
    'attemptStatus', v_status,
    'attemptFinalScore', case when v_unscored = 0 then v_total else null end,
    'reviewedAt', v_now
  );
end;
$$;

revoke all on function public.review_translation_answer(uuid, timestamptz, text, numeric, text)
  from public, anon, authenticated;
grant execute on function public.review_translation_answer(uuid, timestamptz, text, numeric, text)
  to service_role;
