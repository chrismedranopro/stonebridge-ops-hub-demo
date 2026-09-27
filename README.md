# Stonebridge Ops Hub (Demo)

A portfolio demo of an operations hub built for home energy-efficiency contractors — lead pipeline, AI-assisted estimating with a multi-step human approval flow, compliance document tracking, portal status ingestion, and an action-center inbox that surfaces what needs attention.

**This is a sanitized demo, not a real company.** "Stonebridge Home Energy Solutions", its rebate program (ESRP), the state agency (SERO), every homeowner, staff member, price and project are synthetic. It's built on the architecture and workflow design of a real production system I built for an energy-efficiency program operator, with all client-identifying details, real people, pricing and live integrations removed or replaced.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Supabase (Postgres, Auth, Row Level Security)
- Tailwind CSS
- Vitest + PGlite (in-process Postgres) for tests

## Running it locally

```bash
npm install
cp .env.local.example .env.local   # your own demo Supabase project's URL + anon key
npm run dev
```

Database setup for a **new** Supabase project:

- **Supabase CLI:** `supabase db reset` (local) applies `supabase/migrations/*` in order, then `supabase/seed.sql`.
- **SQL Editor:** run each file in `supabase/migrations/` in filename order, then `supabase/seed.sql`.

Projects created from the older single-file `demo-schema.sql` should be recreated rather than upgraded in place.

To try the reviewer flow, sign up, open an AI draft in the Estimator and choose **Start reviewer simulation** (controlled test mode, below). The draft must pass the 95% validation gate first. To act as a named persona instead, link your auth user to a seeded staff row from the SQL editor: `update staff set auth_user_id = '<your auth.users id>' where email = 'jordan@stonebridge.example';`

## What this demo shows

- Lead pipeline with stage tracking and manual intake
- AI-drafted estimates with a concurrent, role-based human review/approval chain before anything reaches a homeowner
- Compliance document checklist per project, synced against a program checklist
- An action-center queue that consolidates everything needing staff attention into one place
- Estimate PDF generation (quotation + terms package)

## Architecture

```
Browser (Next.js client components)
  │  supabase-js with the user's session (anon key + JWT)
  ▼
Supabase PostgREST ──► Postgres
                        ├─ RLS on every table: is_ops_hub_user()
                        ├─ Workflow functions (SECURITY DEFINER): review, approval,
                        │  revisions, pricing, e-sign hand-off, create_lead
                        ├─ Triggers: validation score, totals, audit history,
                        │  workflow guards, outbox jobs
                        └─ Outbox tables for external automations (not connected)

Next.js route handlers (app/api/estimator/*)
  └─ verify the caller's token, then query AS THAT USER (same RLS) — no service-role key
```

- **The database owns the rules.** Estimate state transitions, the ≥95% validation gate, the two-step approval chain, immutability of approved estimates and audit history are enforced in Postgres, so they hold for any client, not just this UI.
- **The UI is a thin client.** Pages read with RLS-scoped queries and change workflow state only through RPCs.
- **Migrations are the schema's source of truth** (`supabase/migrations/`); `supabase/seed.sql` is fictional data only.

## Security model

| Boundary | Enforced by |
|---|---|
| Who can use the app | A trigger on `auth.users` creates a `staff` row at sign-up, linked by `auth_user_id`. Every RLS policy calls `is_ops_hub_user()` = "an **active** staff row belongs to this session". Deactivating a row revokes API access immediately; there is no client-side provisioning. |
| Privilege level | `access_level`, `active`, `email` and `auth_user_id` are not client-writable (column-level grants). Staff can edit only their own name, role and initials. |
| Estimate workflow | `guard_estimate_workflow_columns` rejects any direct write by the `anon`/`authenticated` roles to status, totals, validation score, approval and delivery fields. Only the workflow functions can change them. Approved estimates, their line items and pricing assumptions are immutable; changes require a revision. |
| Approvals | Clients cannot write `estimate_approval_steps`. `decide_estimate_approval` records the decider from the session (`current_staff_id()`), and a trigger checks it is the assigned reviewer. |
| Function exposure | EXECUTE is revoked from `PUBLIC`/`anon`/`authenticated` on every function, then granted explicitly to the RPCs the UI uses. A test fails if any other function becomes callable. |
| Server routes | `requireOpsHubUser()` verifies the bearer token with Supabase Auth and checks `is_ops_hub_user()`. The PDF route accepts only an estimate id and loads everything else itself, including whether the document is a DRAFT. Error bodies are generic; details go to server logs. |
| Audit fields | Line-item history, approval decisions and Action Center resolutions take the actor from the session, never from the request body. |

**Controlled test mode.** A public demo has no second person to approve with, so `enable_estimate_review_simulation` lets one signed-in user act for every reviewer on an estimate. Such estimates are permanently flagged `is_test`, each simulated decision is annotated with the real operator's id, and outbound jobs for them can only target the operator's own email.

## What's simulated

- **External integrations.** Lead intake, the program portal, shared-inbox classification, the document store and e-signature are represented by their database tables and outbox rows only. Nothing sends email, calls a webhook or contacts a real service. The only live outbound call is the staff-only ENERGY STAR lookup, which uses the public EPA dataset.
- **AI.** Estimate "AI drafts" come from seeded extraction data and database functions; no model is called at runtime. AI-origin lines are labelled as candidates until a person verifies them.
- **Tax and pricing.** County tax rates and pricing defaults are fictional round numbers seeded into the database, not tax or pricing advice.
- **Program portal links** point at a reserved `.example` domain.

## Verification

```bash
npm run lint
npm run typecheck
npm test          # unit tests + database security tests (no Docker required)
npm run build
```

`tests/db/` replays every migration and the seed into PGlite (in-process Postgres) with a small shim for Supabase's `auth` schema, request roles and default grants (`tests/db/supabase-shim.sql`). It then acts as the `anon` and `authenticated` roles to prove that:

- unprovisioned, deactivated or impersonating accounts get no data;
- estimate status and approvals cannot be written directly;
- approvals are attributed to the signed-in reviewer;
- only allow-listed functions are executable;
- `create_lead` is all-or-nothing.

CI (`.github/workflows/ci.yml`) runs all four steps on every push and pull request.

## Demo limitations

- **One shared database.** Every visitor who signs up is an active staff member of the same demo, so visitors can see and change each other's demo data (never anyone's real data). Reset it by re-running the migrations and seed.
- **Reviewer personas have no logins.** Use controlled test mode, or link your own account to a persona as described above.
- **Deleting a whole project** cascades through its estimates, including approved ones. The per-estimate guard does not block that project-level action.
- **Line items are editable while an estimate is `pending_review`.** They lock only at approval, and final approval re-runs validation.
- **Estimate "AI" packages** are seeded, not generated. There is no background job queue or retry loop in this demo.
