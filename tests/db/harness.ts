import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const root = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(file, "utf8");

/** Fresh in-process Postgres with the Supabase shim, every migration, and the seed. */
export async function createTestDatabase(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec("create extension if not exists pgcrypto;");
  await db.exec(read(path.join(root, "tests/db/supabase-shim.sql")));
  const migrationsDir = path.join(root, "supabase/migrations");
  for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(read(path.join(migrationsDir, file)));
  }
  await db.exec(read(path.join(root, "supabase/seed.sql")));
  return db;
}

export interface Session {
  sub: string;
  email: string;
}

/** Create an auth user exactly as Supabase sign-up would (fires the provisioning trigger). */
export async function signUp(db: PGlite, email: string, meta: Record<string, string> = {}): Promise<Session> {
  await asOwner(db);
  const { rows } = await db.query<{ id: string }>(
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id",
    [email, JSON.stringify(meta)],
  );
  return { sub: rows[0].id, email };
}

/** Behave like a PostgREST request from a signed-in browser session. */
export async function asUser(db: PGlite, session: Session): Promise<void> {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: session.sub, email: session.email, role: "authenticated" }),
  ]);
  await db.exec("set role authenticated");
}

/** Behave like an unauthenticated request with only the public anon key. */
export async function asAnon(db: PGlite): Promise<void> {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role: "anon" })]);
  await db.exec("set role anon");
}

/** Database owner (SQL editor / migrations / seed). */
export async function asOwner(db: PGlite): Promise<void> {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', '', false)");
}

/** Run a statement and return the Postgres error message, or null if it succeeded. */
export async function errorOf(db: PGlite, sql: string, params: unknown[] = []): Promise<string | null> {
  try {
    await db.query(sql, params);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Link an auth user to an existing (seeded) staff row, the way an administrator would. */
export async function linkToStaff(db: PGlite, session: Session, staffEmail: string): Promise<string> {
  await asOwner(db);
  await db.query("delete from staff where auth_user_id = $1", [session.sub]);
  const { rows } = await db.query<{ id: string }>(
    "update staff set auth_user_id = $1 where email = $2 returning id",
    [session.sub, staffEmail],
  );
  if (!rows.length) throw new Error(`No staff row for ${staffEmail}`);
  return rows[0].id;
}
