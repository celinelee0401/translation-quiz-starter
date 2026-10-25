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
