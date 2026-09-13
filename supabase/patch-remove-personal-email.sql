-- Run once against a project that already has demo-schema.sql + demo-seed.sql
-- applied from before the personal-email bypass was removed.

create or replace function enforce_stonebridge_domain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is null or lower(new.email) not like '%@stonebridgehomeenergy.com' then
    raise exception 'Sign-up is restricted to @stonebridgehomeenergy.com accounts';
  end if;
  return new;
end;
$$;

create or replace function is_ops_hub_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'email', '') ilike '%@stonebridgehomeenergy.com';
$$;

delete from staff where email = 'chrismedrano.pro@gmail.com';
