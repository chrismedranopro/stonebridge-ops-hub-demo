-- ============================================================================
-- create_lead: one atomic call for "new homeowner + their program applications"
-- ============================================================================
-- The Add Lead form used to insert the project and then the applications as
-- two separate requests; if the second failed, an orphan project with no
-- program row was left behind. A single function call runs in a single
-- transaction, so either both writes land or neither does.
--
-- SECURITY INVOKER on purpose: the caller's RLS policies still apply to both
-- inserts. The function adds validation and atomicity, not extra privilege.
-- ============================================================================

create or replace function create_lead(
  p_homeowner_name text,
  p_program_tracks text[],
  p_internal_status_code text default 'new_pre_qualified',
  p_phone text default null,
  p_email text default null,
  p_address_line1 text default null,
  p_address_line2 text default null,
  p_lead_source text default 'unknown',
  p_ami_tier text default 'unknown'
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_project_id uuid;
  v_tracks text[];
begin
  if not is_ops_hub_user() then
    raise exception 'Ops Hub access required' using errcode = '42501';
  end if;
  if nullif(trim(p_homeowner_name), '') is null then
    raise exception 'Homeowner name is required' using errcode = '22023';
  end if;
  if nullif(trim(p_address_line1), '') is null then
    raise exception 'Address is required' using errcode = '22023';
  end if;

  select array_agg(distinct upper(trim(t)))
  into v_tracks
  from unnest(coalesce(p_program_tracks, '{}'::text[])) as t
  where nullif(trim(t), '') is not null;

  if v_tracks is null then
    raise exception 'Select at least one program track (HOMES and/or HEAR)' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_tracks) as t where t not in ('HOMES', 'HEAR')) then
    raise exception 'Unknown program track' using errcode = '22023';
  end if;
  if not exists (select 1 from pipeline_stages where code = p_internal_status_code) then
    raise exception 'Unknown pipeline stage: %', p_internal_status_code using errcode = '22023';
  end if;

  insert into projects (
    homeowner_name, phone, email, address_line1, address_line2,
    lead_source, ami_tier, assigned_owner_id
  ) values (
    trim(p_homeowner_name),
    nullif(trim(p_phone), ''),
    nullif(lower(trim(p_email)), ''),
    trim(p_address_line1),
    nullif(trim(p_address_line2), ''),
    coalesce(nullif(p_lead_source, ''), 'unknown'),
    coalesce(nullif(p_ami_tier, ''), 'unknown'),
    current_staff_id()
  )
  returning id into v_project_id;

  insert into project_applications (project_id, program_track, internal_status_code)
  select v_project_id, t, p_internal_status_code
  from unnest(v_tracks) as t;

  return v_project_id;
end;
$$;

comment on function create_lead(text, text[], text, text, text, text, text, text, text) is
  'Creates a project and its HOMES/HEAR applications in one transaction. Validates input; RLS still applies (security invoker).';

revoke execute on function create_lead(text, text[], text, text, text, text, text, text, text) from public, anon;
grant execute on function create_lead(text, text[], text, text, text, text, text, text, text) to authenticated, service_role;
