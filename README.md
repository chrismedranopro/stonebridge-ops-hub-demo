# Cascadia Ops Hub (Demo)

A portfolio demo of an operations hub built for home energy-efficiency contractors — lead pipeline, AI-assisted estimating with a multi-step human approval flow, compliance document tracking, portal status ingestion, and an action-center inbox that surfaces what needs attention.

**This is a sanitized demo, not a real company.** "Cascadia Home Energy Solutions" is a fictional brand, and every homeowner, staff member, and project shown is synthetic sample data seeded for demonstration. It's built on the architecture and workflow design of a real production system I built for an energy-efficiency program operator, with all client-identifying details, real people, and live integrations removed or replaced.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Supabase (Postgres, Auth, Row Level Security)
- Tailwind CSS

## Running it locally

```bash
npm install
cp .env.local.example .env.local   # fill in your own Supabase project's URL + anon key
npm run dev
```

The database schema and seed data for a demo Supabase project are in `supabase/demo-schema.sql` and `supabase/demo-seed.sql` — run them (in that order) in a fresh Supabase project's SQL Editor.

## What this demo shows

- Lead pipeline with stage tracking and manual intake
- AI-drafted estimates with a concurrent, role-based human review/approval chain before anything reaches a homeowner
- Compliance document checklist per project, synced against a program checklist
- An action-center queue that consolidates everything needing staff attention into one place
- Estimate PDF generation (quotation + terms package)

## Not included

This demo intentionally omits real third-party integrations from the original system (webhook-based lead intake, e-signature delivery, document-storage sync) — those pieces called live external services in production and aren't meaningful to reproduce against fake data.
