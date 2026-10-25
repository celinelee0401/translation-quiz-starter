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
