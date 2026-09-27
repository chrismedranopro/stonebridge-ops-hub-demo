-- Minimal stand-in for the parts of a Supabase project the migrations depend
-- on, so the real migration files can run inside PGlite (in-process Postgres)
-- in CI without Docker. Mirrors Supabase's behavior where it matters for
-- security tests:
--   * request roles anon / authenticated / service_role
--   * auth.uid() / auth.jwt() / auth.role() read the request's JWT claims
--   * Supabase's default grants on schema public (everything to every role),
--     so the tests prove the migrations' own revokes, not a friendlier setup.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb,
  created_at timestamptz not null default now()
);

create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(auth.jwt() ->> 'role', '');
$$;
create function auth.email() returns text language sql stable as $$
  select nullif(auth.jwt() ->> 'email', '');
$$;
grant execute on all functions in schema auth to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
