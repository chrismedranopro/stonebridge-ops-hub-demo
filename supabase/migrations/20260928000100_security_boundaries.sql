-- ============================================================================
-- Security boundaries: identity, authorization, workflow guards, EXECUTE grants
-- ============================================================================
-- Moves every access decision that previously lived only in the browser to
-- the database, where a client talking to the REST API directly cannot skip it.
--
--  1. Identity   staff rows are bound to auth.users by id (not by email), and
--                provisioned by a trigger on sign-up instead of by the client.
--  2. Access     is_ops_hub_user() = "has an ACTIVE linked staff row". Every
--                RLS policy already routes through it, so deactivating a staff
--                row now revokes API access, not just the UI.
--  3. Workflow   application roles cannot write estimate workflow state
--                (status, approvals, delivery, snapshots) directly; only the
--                SECURITY DEFINER workflow functions can.
--  4. Approvals  the approver is derived from the session, never from a
--                client-supplied staff id.
--  5. EXECUTE    no function is callable by anon/authenticated unless it is
--                granted explicitly at the bottom of this file.
--
-- "Application role" below means the PostgREST request roles `anon` and
-- `authenticated`. Inside a SECURITY DEFINER function current_user is the
-- function owner, so the guards let the workflow functions (and the seed,
-- the service role and SQL-editor sessions) through while stopping direct
-- table writes from the browser.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Identity: staff <-> auth.users
-- ----------------------------------------------------------------------------
alter table staff add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;

comment on column staff.auth_user_id is
  'The auth.users id this staff record belongs to. The only link used for authorization -- email is display data and is never trusted for identity.';

-- Link rows created before this migration to the auth user with the same email.
-- Runs once, at migration time; new sign-ups are never linked to an existing
-- row by email (see handle_new_auth_user), which is what prevents someone from
-- signing up with a seeded persona's address and inheriting that persona.
update staff s
set auth_user_id = u.id
from auth.users u
where s.auth_user_id is null
  and s.email is not null
  and lower(s.email) = lower(u.email);

create or replace function current_staff_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from staff where auth_user_id = auth.uid() and active limit 1;
$$;

comment on function current_staff_id() is
  'Active staff id for the current session, or null. Server-side source of truth for "who is acting".';

create or replace function is_ops_hub_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from staff where auth_user_id = auth.uid() and active);
$$;

comment on function is_ops_hub_user() is
  'Gate used by every RLS policy: the session belongs to an ACTIVE staff record. Signed-in but unprovisioned or deactivated accounts get nothing.';

-- Sign-up provisioning. Runs inside the auth.users insert, so the staff row
-- exists before the first session does. access_level is left to its column
-- default ('staff'); self-service sign-up can never grant leadership.
create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  first_name text := nullif(trim(meta->>'first_name'), '');
  last_name text := nullif(trim(meta->>'last_name'), '');
  display_name text;
begin
  display_name := coalesce(
    nullif(concat_ws(' ', first_name, last_name), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'New staff member'
  );
  insert into staff (full_name, email, role, initials, auth_user_id)
  values (
    left(display_name, 120),
    lower(new.email),
    left(nullif(trim(meta->>'role'), ''), 80),
    coalesce(nullif(upper(left(coalesce(first_name, ''), 1) || left(coalesce(last_name, ''), 1)), ''), upper(left(display_name, 2))),
    new.id
  )
  -- An email already on a staff row is never claimed by a new sign-up. The
  -- account is created but stays unauthorized until an administrator links it.
  on conflict (email) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- Staff table: readable by active staff; each person may edit only their own
-- display fields. No client inserts or deletes; access_level/active/email/
-- auth_user_id are administrator-only.
drop policy if exists "authenticated read staff" on staff;
drop policy if exists "self insert staff" on staff;
drop policy if exists "self update own staff row" on staff;

create policy "Ops Hub staff read staff directory" on staff
  for select to authenticated using (is_ops_hub_user());
create policy "Staff update own display fields" on staff
  for update to authenticated
  using (auth_user_id = auth.uid() and active)
  with check (auth_user_id = auth.uid() and active);

revoke all on staff from anon;
revoke insert, update, delete on staff from authenticated;
grant select on staff to authenticated;
grant update (full_name, role, initials) on staff to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Shared authorization helper for SECURITY DEFINER entry points
-- ----------------------------------------------------------------------------
create or replace function require_ops_hub_user()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') and not is_ops_hub_user() then
    raise exception 'Ops Hub access required' using errcode = '42501';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Estimate workflow guard
-- ----------------------------------------------------------------------------
-- Application roles may only edit these estimate columns directly. Everything
-- else (status, delivery state, totals, validation score, approval snapshot,
-- test-mode fields, ...) is owned by the workflow functions. Deny-by-default:
-- a column added later is protected automatically.
create or replace function guard_estimate_workflow_columns()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  client_editable constant text[] := array['ai_gap_resolution', 'modeled_savings_percent', 'updated_at'];
begin
  if current_user not in ('anon', 'authenticated') then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'ai_draft'
       or new.delivery_status <> 'not_ready'
       or new.is_test
       or new.approved_at is not null
       or new.approved_snapshot is not null
       or new.package_snapshot is not null
       or new.reviewed_by_staff_id is not null
       or new.homeowner_sent_at is not null
       or new.signed_at is not null then
      raise exception 'A new estimate must start as an unapproved draft' using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - client_editable) is distinct from (to_jsonb(old) - client_editable) then
      raise exception 'Estimate status, totals and approval fields change only through the estimate workflow'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- DELETE
  if old.status in ('pending_review', 'approved', 'sent_for_signature', 'signed') then
    raise exception 'An estimate in review or approved cannot be deleted' using errcode = '42501';
  end if;
  return old;
end;
$$;

drop trigger if exists guard_estimate_workflow_columns_trigger on estimates;
create trigger guard_estimate_workflow_columns_trigger
  before insert or update or delete on estimates
  for each row execute function guard_estimate_workflow_columns();

-- Pricing assumptions feed the homeowner PDF (material/labor split) and the
-- generated fee lines, so they freeze with the approved estimate, exactly like
-- its line items (protect_final_estimate_line_items).
create or replace function guard_final_estimate_assumptions()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if exists (
    select 1 from estimates
    where id = new.estimate_id and status in ('approved', 'sent_for_signature', 'signed')
  ) then
    raise exception 'Pricing assumptions are locked on an approved estimate; create a revision instead'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_final_estimate_assumptions_trigger on estimate_pricing_assumptions;
create trigger guard_final_estimate_assumptions_trigger
  before insert or update on estimate_pricing_assumptions
  for each row execute function guard_final_estimate_assumptions();

-- Approval steps are created by initialize_estimate_approvals() and decided
-- only through decide_estimate_approval() / activate_marcus_final_fallback().
revoke insert, update, delete on estimate_approval_steps from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Server-derived approver identity
-- ----------------------------------------------------------------------------
create or replace function decide_estimate_approval(p_step_id uuid, p_decision text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := current_staff_id();
begin
  if actor is null then
    raise exception 'Ops Hub access required' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'changes_requested', 'rejected') then
    raise exception 'Unknown review decision: %', p_decision using errcode = '22023';
  end if;

  -- decided_by_staff_id comes from the session. enforce_estimate_approval_transition
  -- then checks it is the assigned reviewer (or the controlled-test operator).
  update estimate_approval_steps
  set status = p_decision,
      decided_by_staff_id = actor,
      decided_at = now(),
      note = coalesce(nullif(trim(p_note), ''), note)
  where id = p_step_id and status = 'pending';

  if not found then
    raise exception 'This review step is not awaiting a decision' using errcode = '55000';
  end if;
end;
$$;

-- Same checks as the baseline, plus: an application-role write can never
-- choose who the decider is (defense in depth; direct writes are also revoked).
create or replace function enforce_estimate_approval_transition()
returns trigger language plpgsql security definer set search_path = public as $$
declare estimate_is_test boolean; test_operator uuid; estimate_status text;
begin
  if new.status = old.status then return new; end if;

  if old.status = 'locked' and new.status = 'pending' then
    if old.reviewer_key <> 'christina' and exists (
      select 1 from estimate_approval_steps
      where estimate_id=old.estimate_id and reviewer_key='christina' and status <> 'approved'
    ) then raise exception 'Christina must complete the draft review first'; end if;
    return new;
  end if;

  if old.status = 'pending' and new.status = 'locked' then
    select status into estimate_status from estimates where id=old.estimate_id;
    if estimate_status not in ('approved','ai_draft','rejected') then
      raise exception 'An active review cannot be closed before the estimate is finalized or returned';
    end if;
    return new;
  end if;

  if old.status = 'pending' and new.status in ('approved','changes_requested','rejected') then
    -- A user session never gets to name the decider; it is always the session's
    -- own staff record. Only trusted callers (service role, database owner) keep
    -- an explicit value.
    if coalesce(auth.role(), '') in ('anon', 'authenticated') then
      new.decided_by_staff_id := current_staff_id();
    end if;
    if old.reviewer_staff_id is null then raise exception 'Reviewer account is not linked to staff'; end if;
    select is_test,test_operator_staff_id into estimate_is_test,test_operator from estimates where id=old.estimate_id;
    if new.decided_by_staff_id is distinct from old.reviewer_staff_id
      and not (estimate_is_test and new.decided_by_staff_id is not distinct from test_operator) then
      raise exception 'Only the assigned reviewer can decide this review' using errcode = '42501';
    end if;
    if new.decided_at is null then new.decided_at := now(); end if;
    if estimate_is_test and new.decided_by_staff_id is not distinct from test_operator
      and new.decided_by_staff_id is distinct from old.reviewer_staff_id then
      new.note := concat_ws(' | ',nullif(new.note,''),
        'CONTROLLED TEST: simulated ' || old.reviewer_label || '; actual operator staff id ' || test_operator::text);
    end if;
    return new;
  end if;

  raise exception 'Invalid estimate approval transition: % to %', old.status, new.status;
end;
$$;

-- Fallback final approval: caller resolved from the session, not by email.
create or replace function activate_marcus_final_fallback(p_estimate_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare e estimates%rowtype; marcus_id uuid; caller_staff uuid;
begin
  perform require_ops_hub_user();
  if nullif(trim(p_reason),'') is null then raise exception 'Fallback reason is required'; end if;
  select * into e from estimates where id=p_estimate_id for update;
  if not found or e.status<>'pending_review' then raise exception 'Estimate is not awaiting final approval'; end if;
  select reviewer_staff_id into marcus_id from estimate_approval_steps where estimate_id=p_estimate_id and reviewer_key='marcus';
  caller_staff := current_staff_id();
  if marcus_id is null then raise exception 'Fallback reviewer account is not linked'; end if;
  if auth.role() is distinct from 'service_role' and caller_staff is distinct from marcus_id and not(e.is_test and caller_staff is not distinct from e.test_operator_staff_id) then raise exception 'Only the designated fallback reviewer may execute fallback final approval' using errcode = '42501'; end if;
  if not exists(select 1 from estimate_approval_steps where estimate_id=p_estimate_id and reviewer_key='christina' and status='approved') then raise exception 'Christina must complete the first approval'; end if;
  if exists(select 1 from estimate_approval_steps where estimate_id=p_estimate_id and reviewer_key='marcus' and status='approved') then
    if recompute_estimate_validation(p_estimate_id)<95 then raise exception 'Compliance validation must be at least 95%%'; end if;
    update estimate_approval_steps set note=concat_ws(' | ',note,'Final fallback reason: '||trim(p_reason)||'; operator: '||coalesce(caller_staff,marcus_id)::text||'; time: '||now()::text) where estimate_id=p_estimate_id and reviewer_key='marcus';
    update estimates x set status='approved',delivery_status='ready',reviewed_by_staff_id=coalesce(caller_staff,marcus_id),reviewed_at=now(),approved_at=now(),package_snapshot=jsonb_build_object('estimate',to_jsonb(x),'terms_version',x.terms_version,'terms_document_path',x.terms_document_path,'lines',(select coalesce(jsonb_agg(to_jsonb(li) order by sort_order),'[]') from estimate_line_items li where li.estimate_id=x.id)),updated_at=now() where x.id=p_estimate_id;
    update estimate_work_items set readiness_status='approved',updated_at=now() where latest_estimate_id=p_estimate_id;
    update estimate_approval_steps set status='locked',note=concat_ws(' | ',note,'Review closed after fallback final approval') where estimate_id=p_estimate_id and status='pending';
    return;
  end if;
  update estimate_approval_steps set status='pending' where estimate_id=p_estimate_id and reviewer_key='marcus' and status='locked';
  update estimate_approval_steps set status='approved',decided_by_staff_id=coalesce(caller_staff,marcus_id),decided_at=now(),note=concat_ws(' | ',note,'Final fallback reason: '||trim(p_reason)) where estimate_id=p_estimate_id and reviewer_key='marcus' and status='pending';
end $$;

-- Controlled test mode: the operator is the session's own staff record.
create or replace function enable_estimate_review_simulation(
  p_estimate_id uuid,
  p_test_recipient_email text
)
returns void language plpgsql security definer set search_path = public as $$
declare actor uuid; actor_email text; estimate_status text;
begin
  perform require_ops_hub_user();
  select id,email into actor,actor_email from staff where id = current_staff_id();
  if actor is null then raise exception 'Your authenticated account is not linked to active staff' using errcode = '42501'; end if;
  if lower(trim(coalesce(p_test_recipient_email,''))) <> lower(trim(coalesce(actor_email,''))) then
    raise exception 'The test recipient must be your authenticated staff email';
  end if;
  select status into estimate_status from estimates where id=p_estimate_id for update;
  if estimate_status is null then raise exception 'Estimate not found'; end if;
  if estimate_status <> 'ai_draft' then
    raise exception 'Enable simulation before submitting the estimate for review';
  end if;

  perform set_config('app.test_mode_authorized','true',true);
  update estimates set is_test=true,test_operator_staff_id=actor,
    test_recipient_email=lower(trim(p_test_recipient_email)),updated_at=now()
  where id=p_estimate_id;
end;
$$;

-- Line-item audit history: actor resolved from the session, not by email.
create or replace function audit_estimate_line_item_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A project-level delete cascades through estimates and line items. At that
  -- point the parent estimate is already being removed, so creating a fresh
  -- history row would immediately violate its estimate FK.
  if tg_op = 'DELETE' and not exists (
    select 1 from public.estimates where id = old.estimate_id
  ) then
    return old;
  end if;

  insert into public.estimate_line_item_history(
    estimate_id, line_item_id, changed_by_staff_id, old_row, new_row
  )
  values(
    coalesce(new.estimate_id, old.estimate_id),
    coalesce(new.id, old.id),
    current_staff_id(),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );

  return coalesce(new, old);
end;
$$;

-- "Homeowner agreed; ready for e-sign." Replaces a direct status write from
-- the browser. Only a fully approved estimate can move forward.
create or replace function mark_estimate_ready_for_esign(p_estimate_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform require_ops_hub_user();
  update estimates set status = 'sent_for_signature', updated_at = now()
  where id = p_estimate_id and status = 'approved';
  if not found then
    raise exception 'Only a fully approved estimate can be marked ready for e-signature' using errcode = '55000';
  end if;
  update estimate_work_items set readiness_status = 'sent_for_signature', updated_at = now()
  where latest_estimate_id = p_estimate_id;
end;
$$;

-- One checked entry point for "recalculate derived numbers". The underlying
-- recompute/recalculate functions stay internal (not granted to clients).
-- The rebate is only recalculated while the estimate is still editable, so an
-- approved package's numbers cannot drift after sign-off.
create or replace function refresh_estimate_calculations(p_estimate_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare current_status text;
begin
  perform require_ops_hub_user();
  select status into current_status from estimates where id = p_estimate_id;
  if current_status is null then raise exception 'Estimate not found' using errcode = 'P0002'; end if;
  if current_status in ('ai_draft', 'pending_review') then
    perform recalculate_esrp_rebate(p_estimate_id);
  end if;
  return recompute_estimate_validation(p_estimate_id);
end;
$$;

-- Resolving an Action Center item records who resolved it from the session.
create or replace function stamp_resolver_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') and new.resolved and not coalesce(old.resolved, false) then
    new.resolved_by_staff_id := current_staff_id();
    new.resolved_at := coalesce(new.resolved_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_resolver_identity_trigger on mailbox_triage_events;
create trigger stamp_resolver_identity_trigger
  before update on mailbox_triage_events
  for each row execute function stamp_resolver_identity();

drop trigger if exists stamp_resolver_identity_trigger on portal_status_events;
create trigger stamp_resolver_identity_trigger
  before update on portal_status_events
  for each row execute function stamp_resolver_identity();

-- ----------------------------------------------------------------------------
-- 5. Explicit function permissions
-- ----------------------------------------------------------------------------
-- Postgres grants EXECUTE to PUBLIC by default, and Supabase additionally
-- grants it to anon/authenticated. Take all of that back, then grant only the
-- entry points the app calls. Trigger functions need no EXECUTE grant to fire.
revoke execute on all functions in schema public from public, anon, authenticated;
-- Future functions: PUBLIC's EXECUTE is a global default (cannot be removed
-- per-schema); Supabase's anon/authenticated grants are per-schema defaults.
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

grant execute on all functions in schema public to service_role;

-- Used inside RLS policies and invoker triggers, so the request role needs them.
grant execute on function is_ops_hub_user() to authenticated;
grant execute on function current_staff_id() to authenticated;

-- RPCs called by the Ops Hub UI. Each one authorizes internally.
grant execute on function decide_estimate_approval(uuid, text, text) to authenticated;
grant execute on function activate_marcus_final_fallback(uuid, text) to authenticated;
grant execute on function enable_estimate_review_simulation(uuid, text) to authenticated;
grant execute on function promote_estimate_to_review(uuid) to authenticated;
grant execute on function mark_estimate_ready_for_esign(uuid) to authenticated;
grant execute on function refresh_estimate_calculations(uuid) to authenticated;
grant execute on function apply_estimate_pricing_assumptions(uuid) to authenticated;
grant execute on function create_estimate_revision(uuid, text) to authenticated;
grant execute on function start_estimate_return_revision(uuid) to authenticated;
grant execute on function rename_estimate_for_migration(uuid, text, text) to authenticated;
