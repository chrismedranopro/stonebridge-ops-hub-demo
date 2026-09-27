// Proves the database-side security boundaries hold for a client that talks to
// the REST API directly (i.e. without going through the Ops Hub UI).
// Each test runs as the same Postgres role PostgREST would use for the request.
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asAnon, asOwner, asUser, createTestDatabase, errorOf, linkToStaff, signUp, type Session } from "./harness";

const APPROVED_ESTIMATE = "a1a1a1a1-1111-4111-8111-aaaaaaaaaa01"; // seed: fully approved
const IN_REVIEW_ESTIMATE = "b2b2b2b2-2222-4222-8222-bbbbbbbbbb01"; // seed: first review done, final pending
const DRAFT_ESTIMATE = "c3c3c3c3-3333-4333-8333-cccccccccc01"; // seed: ai_draft

let db: PGlite;
let visitor: Session; // ordinary self-service sign-up

beforeAll(async () => {
  db = await createTestDatabase();
  visitor = await signUp(db, "visitor@example.com", { first_name: "Vera", last_name: "Visitor", role: "Estimator" });
});

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from (${sql}) q`, params);
  return rows[0].n;
}

describe("C3: access requires an active staff record linked to the session", () => {
  it("provisions a linked, staff-tier record on sign-up, ignoring any requested access level", async () => {
    const eager = await signUp(db, "eager@example.com", { first_name: "Eli", access_level: "leadership" });
    await asOwner(db);
    const { rows } = await db.query<{ access_level: string; active: boolean; full_name: string }>(
      "select access_level, active, full_name from staff where auth_user_id = $1", [eager.sub]);
    expect(rows).toEqual([{ access_level: "staff", active: true, full_name: "Eli" }]);
  });

  it("gives a provisioned staff member access to operational data", async () => {
    await asUser(db, visitor);
    expect(await count("select 1 from projects")).toBeGreaterThan(0);
  });

  it("does not let a new sign-up inherit a seeded persona by reusing its email", async () => {
    const impostor = await signUp(db, "jordan@stonebridge.example");
    await asUser(db, impostor);
    const { rows } = await db.query<{ ok: boolean }>("select is_ops_hub_user() as ok");
    expect(rows[0].ok).toBe(false);
    expect(await count("select 1 from projects")).toBe(0);
    await asOwner(db);
    const persona = await db.query<{ auth_user_id: string | null }>(
      "select auth_user_id from staff where email = 'jordan@stonebridge.example'");
    expect(persona.rows[0].auth_user_id).toBeNull();
  });

  it("revokes API access immediately when a staff record is deactivated", async () => {
    const leaver = await signUp(db, "leaver@example.com", { first_name: "Lee" });
    await asOwner(db);
    await db.query("update staff set active = false where auth_user_id = $1", [leaver.sub]);
    await asUser(db, leaver);
    expect(await count("select 1 from projects")).toBe(0);
    expect(await count("select 1 from estimates")).toBe(0);
    expect(await errorOf(db, "select create_lead('X', array['HOMES'], 'new_pre_qualified', null, null, '1 Main St')"))
      .toMatch(/Ops Hub access required/);
    expect(await errorOf(db, "select refresh_estimate_calculations($1)", [DRAFT_ESTIMATE]))
      .toMatch(/Ops Hub access required/);
  });

  it("lets staff edit their own display name but not their access level, status or identity", async () => {
    await asUser(db, visitor);
    await db.query("update staff set full_name = 'Vera V.' where auth_user_id = $1", [visitor.sub]);
    expect(await errorOf(db, "update staff set access_level = 'leadership' where auth_user_id = $1", [visitor.sub]))
      .toMatch(/permission denied/);
    expect(await errorOf(db, "update staff set active = true where auth_user_id = $1", [visitor.sub]))
      .toMatch(/permission denied/);
    expect(await errorOf(db, "update staff set auth_user_id = null where auth_user_id = $1", [visitor.sub]))
      .toMatch(/permission denied/);
    expect(await errorOf(db, "insert into staff (full_name, email) values ('Ghost', 'ghost@example.com')"))
      .toMatch(/permission denied/);
  });
});

describe("C1: estimate workflow state cannot be written directly", () => {
  it("rejects a direct status change that would skip review", async () => {
    await asUser(db, visitor);
    expect(await errorOf(db, "update estimates set status = 'approved' where id = $1", [DRAFT_ESTIMATE]))
      .toMatch(/only through the estimate workflow/);
    expect(await errorOf(db, "update estimates set status = 'sent_for_signature' where id = $1", [APPROVED_ESTIMATE]))
      .toMatch(/only through the estimate workflow/);
  });

  it("rejects direct edits to totals and the validation score", async () => {
    await asUser(db, visitor);
    expect(await errorOf(db, "update estimates set total_project_cost = 1 where id = $1", [DRAFT_ESTIMATE]))
      .toMatch(/only through the estimate workflow/);
    expect(await errorOf(db, "update estimates set ai_confidence = 100 where id = $1", [DRAFT_ESTIMATE]))
      .toMatch(/only through the estimate workflow/);
  });

  it("still allows the documented client-editable fields", async () => {
    await asUser(db, visitor);
    expect(await errorOf(db, "update estimates set ai_gap_resolution = 'Checked against the audit.' where id = $1", [DRAFT_ESTIMATE]))
      .toBeNull();
  });

  it("rejects inserting an estimate that claims to be approved already", async () => {
    await asUser(db, visitor);
    expect(await errorOf(db,
      "insert into estimates (project_id, estimate_number, program_track, status) values ('33333333-3333-4333-8333-333333333303', 'EST-FAKE', 'HOMES', 'approved')"))
      .toMatch(/must start as an unapproved draft/);
  });

  it("rejects deleting an estimate that is in review or approved", async () => {
    await asUser(db, visitor);
    expect(await errorOf(db, "delete from estimates where id = $1", [APPROVED_ESTIMATE])).toMatch(/cannot be deleted/);
    expect(await errorOf(db, "delete from estimates where id = $1", [IN_REVIEW_ESTIMATE])).toMatch(/cannot be deleted/);
  });

  it("freezes pricing assumptions once an estimate is approved", async () => {
    await asUser(db, visitor);
    expect(await errorOf(db, "update estimate_pricing_assumptions set profit_percent = 50 where estimate_id = $1", [APPROVED_ESTIMATE]))
      .toMatch(/locked on an approved estimate/);
  });

  it("moves an estimate to e-signature only through the RPC, and only after approval", async () => {
    await asUser(db, visitor);
    expect(await errorOf(db, "select mark_estimate_ready_for_esign($1)", [DRAFT_ESTIMATE]))
      .toMatch(/Only a fully approved estimate/);
    expect(await errorOf(db, "select mark_estimate_ready_for_esign($1)", [APPROVED_ESTIMATE])).toBeNull();
    await asOwner(db);
    const { rows } = await db.query<{ status: string }>("select status from estimates where id = $1", [APPROVED_ESTIMATE]);
    expect(rows[0].status).toBe("sent_for_signature");
    expect(await count("select 1 from box_sign_delivery_jobs where estimate_id = $1", [APPROVED_ESTIMATE])).toBe(1);
  });
});

describe("C2: the approver is always the signed-in reviewer", () => {
  it("blocks direct writes to approval steps", async () => {
    await asUser(db, visitor);
    expect(await errorOf(db, "update estimate_approval_steps set status = 'approved' where estimate_id = $1", [IN_REVIEW_ESTIMATE]))
      .toMatch(/permission denied/);
    expect(await errorOf(db, "delete from estimate_approval_steps where estimate_id = $1", [IN_REVIEW_ESTIMATE]))
      .toMatch(/permission denied/);
    expect(await errorOf(db,
      "insert into estimate_approval_steps (estimate_id, sequence_number, reviewer_key, reviewer_label, status) values ($1, 3, 'renee', 'x', 'approved')",
      [IN_REVIEW_ESTIMATE])).toMatch(/permission denied/);
  });

  it("refuses a decision from anyone other than the assigned reviewer", async () => {
    await asOwner(db);
    const { rows } = await db.query<{ id: string }>(
      "select id from estimate_approval_steps where estimate_id = $1 and reviewer_key = 'jordan'", [IN_REVIEW_ESTIMATE]);
    await asUser(db, visitor);
    expect(await errorOf(db, "select decide_estimate_approval($1, 'approved')", [rows[0].id]))
      .toMatch(/Only the assigned reviewer/);
  });

  it("records the session's own staff id as the decider", async () => {
    // Put the draft estimate into review as the database owner (the seed's role).
    await asOwner(db);
    await db.query("update estimates set status = 'pending_review' where id = $1", [DRAFT_ESTIMATE]);
    const christina = await signUp(db, "christina.login@example.com");
    const christinaStaffId = await linkToStaff(db, christina, "christina@stonebridge.example");
    const step = await db.query<{ id: string }>(
      "select id from estimate_approval_steps where estimate_id = $1 and reviewer_key = 'christina'", [DRAFT_ESTIMATE]);

    await asUser(db, christina);
    await db.query("select decide_estimate_approval($1, 'approved', 'Costing checked.')", [step.rows[0].id]);

    await asOwner(db);
    const decided = await db.query<{ status: string; decided_by_staff_id: string }>(
      "select status, decided_by_staff_id from estimate_approval_steps where id = $1", [step.rows[0].id]);
    expect(decided.rows[0]).toEqual({ status: "approved", decided_by_staff_id: christinaStaffId });
    const next = await db.query<{ status: string }>(
      "select status from estimate_approval_steps where estimate_id = $1 and reviewer_key = 'jordan'", [DRAFT_ESTIMATE]);
    expect(next.rows[0].status).toBe("pending");
  });

  it("keeps controlled test mode working: one operator may act for every reviewer, and it is recorded", async () => {
    await asOwner(db);
    const { rows: est } = await db.query<{ id: string }>(
      "insert into estimates (project_id, estimate_number, program_track) values ('44444444-4444-4444-8444-444444444404', 'EST-ESRP-9001', 'HOMES') returning id");
    await asUser(db, visitor);
    await db.query("select enable_estimate_review_simulation($1, 'visitor@example.com')", [est[0].id]);
    await asOwner(db);
    await db.query("update estimates set status = 'pending_review' where id = $1", [est[0].id]);
    const step = await db.query<{ id: string }>(
      "select id from estimate_approval_steps where estimate_id = $1 and reviewer_key = 'christina'", [est[0].id]);
    await asUser(db, visitor);
    expect(await errorOf(db, "select decide_estimate_approval($1, 'approved')", [step.rows[0].id])).toBeNull();
    await asOwner(db);
    const decided = await db.query<{ note: string }>("select note from estimate_approval_steps where id = $1", [step.rows[0].id]);
    expect(decided.rows[0].note).toMatch(/CONTROLLED TEST/);
  });
});

describe("H1: functions are only executable when explicitly granted", () => {
  const CLIENT_RPCS = [
    "activate_marcus_final_fallback", "apply_estimate_pricing_assumptions", "create_estimate_revision",
    "create_lead", "current_staff_id", "decide_estimate_approval", "enable_estimate_review_simulation",
    "is_ops_hub_user", "mark_estimate_ready_for_esign", "promote_estimate_to_review",
    "refresh_estimate_calculations", "rename_estimate_for_migration", "start_estimate_return_revision",
  ];

  it("exposes exactly the allow-listed RPCs to signed-in users", async () => {
    await asOwner(db);
    const { rows } = await db.query<{ proname: string }>(`
      select distinct p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
      order by 1`);
    expect(rows.map((row) => row.proname)).toEqual([...CLIENT_RPCS].sort());
  });

  it("exposes no function at all to anonymous requests", async () => {
    await asOwner(db);
    const { rows } = await db.query<{ proname: string }>(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`);
    expect(rows).toEqual([]);
  });

  it("refuses internal SECURITY DEFINER functions to anon and to staff", async () => {
    await asAnon(db);
    expect(await errorOf(db, "select recompute_estimate_validation($1)", [DRAFT_ESTIMATE])).toMatch(/permission denied/);
    expect(await errorOf(db, "select recalculate_estimate_total($1)", [DRAFT_ESTIMATE])).toMatch(/permission denied/);
    await asUser(db, visitor);
    expect(await errorOf(db, "select recalculate_esrp_rebate($1)", [DRAFT_ESTIMATE])).toMatch(/permission denied/);
    expect(await errorOf(db, "select record_estimate_release_artifact($1, 'crm_draft', 'x')", [APPROVED_ESTIMATE]))
      .toMatch(/permission denied/);
  });

  it("still fires triggers for signed-in users, recording who made the change", async () => {
    await asOwner(db);
    const { rows: est } = await db.query<{ id: string }>(
      "insert into estimates (project_id, estimate_number, program_track) values ('55555555-5555-4555-8555-555555555505', 'EST-ESRP-9002', 'HOMES') returning id");
    await asUser(db, visitor);
    await db.query("insert into estimate_line_items (estimate_id, item_type, scope_name) values ($1, 'scope', 'Air sealing')", [est[0].id]);
    await asOwner(db);
    const history = await db.query<{ changed_by: string }>(
      "select s.auth_user_id as changed_by from estimate_line_item_history h join staff s on s.id = h.changed_by_staff_id where h.estimate_id = $1",
      [est[0].id]);
    expect(history.rows).toEqual([{ changed_by: visitor.sub }]);
  });
});

describe("Action Center: the resolver is stamped from the session", () => {
  it("ignores a client-supplied resolved_by_staff_id", async () => {
    await asOwner(db);
    const other = await db.query<{ id: string }>("select id from staff where email = 'renee@stonebridge.example'");
    const event = await db.query<{ id: string }>("select id from mailbox_triage_events where not resolved limit 1");
    await asUser(db, visitor);
    await db.query("update mailbox_triage_events set resolved = true, resolved_by_staff_id = $1 where id = $2",
      [other.rows[0].id, event.rows[0].id]);
    await asOwner(db);
    const { rows } = await db.query<{ auth_user_id: string }>(
      "select s.auth_user_id from mailbox_triage_events m join staff s on s.id = m.resolved_by_staff_id where m.id = $1",
      [event.rows[0].id]);
    expect(rows[0].auth_user_id).toBe(visitor.sub);
  });
});
