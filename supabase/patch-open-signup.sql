-- Run once against a project that already has demo-schema.sql applied from
-- before the domain-gate was removed. Opens sign-up to any email address.

drop trigger if exists enforce_stonebridge_domain_trigger on auth.users;
drop function if exists enforce_stonebridge_domain();

create or replace function is_ops_hub_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.jwt() ->> 'email' is not null;
$$;
