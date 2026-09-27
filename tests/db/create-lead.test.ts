import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asOwner, asUser, createTestDatabase, errorOf, signUp, type Session } from "./harness";

let db: PGlite;
let staff: Session;

beforeAll(async () => {
  db = await createTestDatabase();
  staff = await signUp(db, "intake@example.com", { first_name: "Ida", last_name: "Intake" });
});

async function projectCount(name: string): Promise<number> {
  await asOwner(db);
  const { rows } = await db.query<{ n: number }>("select count(*)::int as n from projects where homeowner_name = $1", [name]);
  return rows[0].n;
}

describe("create_lead", () => {
  it("creates the project and every requested program application together", async () => {
    await asUser(db, staff);
    const { rows } = await db.query<{ id: string }>(
      "select create_lead('Jamie Sample', array['HOMES','hear'], 'new_pre_qualified', '(804) 555-0100', 'Jamie@Example.com', '10 Test Way') as id");
    await asOwner(db);
    const apps = await db.query<{ program_track: string }>(
      "select program_track from project_applications where project_id = $1 order by 1", [rows[0].id]);
    expect(apps.rows.map((row) => row.program_track)).toEqual(["HEAR", "HOMES"]);
    const project = await db.query<{ email: string; owner: string }>(
      "select p.email, s.auth_user_id as owner from projects p join staff s on s.id = p.assigned_owner_id where p.id = $1", [rows[0].id]);
    expect(project.rows[0]).toEqual({ email: "jamie@example.com", owner: staff.sub });
  });

  it("rolls back the project when an application cannot be created", async () => {
    await asUser(db, staff);
    expect(await errorOf(db, "select create_lead('Rollback Case', array['HOMES'], 'not_a_stage', null, null, '1 Main St')"))
      .toMatch(/Unknown pipeline stage/);
    expect(await projectCount("Rollback Case")).toBe(0);
  });

  it("validates required fields and program tracks before writing anything", async () => {
    await asUser(db, staff);
    expect(await errorOf(db, "select create_lead('  ', array['HOMES'], 'new_pre_qualified', null, null, '1 Main St')"))
      .toMatch(/Homeowner name is required/);
    expect(await errorOf(db, "select create_lead('No Address', array['HOMES'])")).toMatch(/Address is required/);
    expect(await errorOf(db, "select create_lead('No Track', array[]::text[], 'new_pre_qualified', null, null, '1 Main St')"))
      .toMatch(/at least one program track/);
    expect(await errorOf(db, "select create_lead('Bad Track', array['SOLAR'], 'new_pre_qualified', null, null, '1 Main St')"))
      .toMatch(/Unknown program track/);
    expect(await projectCount("No Track")).toBe(0);
  });
});
