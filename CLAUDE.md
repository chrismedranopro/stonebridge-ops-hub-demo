# Stonebridge Ops Hub (demo) — guide for Claude Code

Next.js 16 (App Router) + React 19 + TypeScript, talking to Supabase (Postgres, Auth, RLS)
directly from client components. Business rules live in the database; see `README.md`.

## Hard rules

1. **Synthetic data only.** Every company, person, address, program, price and URL in this
   repository is fictional. Use reserved domains (`*.example`, `example.com`) and 555 phone
   numbers for anything new.
2. **Never copy from sibling or private repositories.** Do not read, quote, adapt or "sanitize"
   code, prompts, data, pricing, identifiers, configuration or documents from any other project
   on this machine, including client work. If a task seems to need them, stop and ask.
3. **Never weaken a safeguard.** Do not loosen RLS policies, `is_ops_hub_user()`, the estimate
   workflow guard, the approval-step revokes, function `EXECUTE` grants, or the validation gate
   (≥95% before review/approval) to make something work. Fix the caller instead. A change that
   touches any of these needs a test in `tests/db/` proving the boundary still holds.
4. **Never commit credentials.** `.env*` is gitignored except `.env.local.example`, which holds
   placeholders only. There is no service-role key in this app and there must not be one.
5. **Critical multi-table writes are atomic or recoverable.** Put them in one Postgres function
   (one call = one transaction), like `create_lead`, rather than chaining client requests.
6. **AI output never bypasses deterministic validation or human approval.** AI-generated lines
   are candidates (`ai_generated`, "AI candidate only" notes) until a person verifies them;
   `recompute_estimate_validation` and the reviewer chain decide, not the model.
7. **Identity comes from the session.** Server code and SQL derive "who is acting" from
   `auth.uid()` → `current_staff_id()`. Never accept a staff id from the browser for
   authorization or audit fields.

## Where things are

- `supabase/migrations/` — schema, in order. Add a new timestamped file for every change;
  never edit a migration that has already been applied somewhere.
- `supabase/seed.sql` — fictional demo data (runs as the database owner).
- `app/api/estimator/*` — the only server code; each route calls `requireOpsHubUser()`.
- `lib/db.ts` — `unwrap`, `PartialLoad`, `expectRowsChanged`: a failed query must never render
  as an empty, successful result.
- `lib/contract-package.ts` — quotation content shared by the preview and the PDF route.
- `tests/db/` — security tests against the real migrations (PGlite + `supabase-shim.sql`).

## Verify before every commit

```bash
npm run lint
npm run typecheck
npm test          # unit + database security tests (no Docker needed)
npm run build     # needs NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY; placeholders are fine
```

CI (`.github/workflows/ci.yml`) runs the same four steps. For UI changes, also run
`npm run dev` against a demo Supabase project and exercise the feature in a browser.
