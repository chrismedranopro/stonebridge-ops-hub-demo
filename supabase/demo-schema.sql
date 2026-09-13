-- ============================================================================
-- Stonebridge Ops Hub -- Demo Schema (Supabase / Postgres)
-- ============================================================================
-- Consolidated, sanitized schema for a standalone portfolio-demo project.
-- Rebuilt from a real production app's incremental migration history, with
-- every table folded to its FINAL column set (no historical ALTERs replayed)
-- so this applies cleanly top-to-bottom on an empty database.
--
-- Fictional identity used throughout: Stonebridge Home Energy Solutions, running
-- the Energy Saver Rebate Program (ESRP). Federal/public program terms
-- (HEAR, HOMES, ENERGY STAR, AHRI) are real program names and kept as-is.
--
-- Sanitization notes (see accompanying report for the full list):
--  - No outbound webhook calls anywhere in this file. The real app dispatched
--    lead-qualification and service-area-recheck events to a live n8n
--    instance via net.http_post; those triggers are intentionally omitted.
--    A future integrator can re-add an outbound call in their own instance.
--  - No one-time data backfills/repairs are included (those only made sense
--    against specific real historical rows).
--  - Reviewer roles are fictional: christina, devon, renee, marcus, jordan.
--  - Scope-evidence columns/functions use a generic "sero_scope_*" naming
--    (renamed from a state-agency-specific original).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ============================================================================
-- AUTH: domain-gated signup + Ops Hub session check
-- ============================================================================
-- Restricts new Supabase Auth accounts to the company's own email domain,
-- with one named demo/developer exception. A session existing at all means
-- access is granted -- the `staff` table is enrichment (name/role/initials),
-- never a login precondition.
create or replace function enforce_stonebridge_domain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is null or (
    lower(new.email) not like '%@stonebridgehomeenergy.com'
    and lower(new.email) <> 'chrismedrano.pro@gmail.com'
  ) then
    raise exception 'Sign-up is restricted to @stonebridgehomeenergy.com accounts';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_stonebridge_domain_trigger on auth.users;
create trigger enforce_stonebridge_domain_trigger
before insert on auth.users
for each row execute function enforce_stonebridge_domain();

-- Every RLS policy below gates on this. Kept as a single, swappable choke
-- point -- re-implement against a different auth model without touching policies.
create or replace function is_ops_hub_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'email', '') ilike '%@stonebridgehomeenergy.com'
      or lower(coalesce(auth.jwt() ->> 'email', '')) = 'chrismedrano.pro@gmail.com';
$$;

-- ============================================================================
-- STAFF
-- ============================================================================
create table staff (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text unique,
  role text,
  initials text,
  access_level text not null default 'staff' check (access_level in ('leadership', 'staff')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on column staff.access_level is 'Dashboard-tier grouping, not fine-grained RBAC -- the app ships one executive dashboard for all staff. Never settable via self-signup; only promoted by direct DB update.';

-- ============================================================================
-- REFERENCE: PIPELINE STAGES (canonical internal status)
-- ============================================================================
create table pipeline_stages (
  code text primary key,
  label text not null,
  stage_group text not null check (stage_group in (
    'lead_intake','site_visit','estimating',
    'submission','pre_construction','construction','closeout','terminal'
  )),
  sort_order int not null,
  source text not null,
  needs_validation boolean not null default false,
  is_critical_alert boolean not null default false,
  notes text
);

-- ============================================================================
-- REFERENCE: PORTAL STATUSES (state-program homeowner-portal status, mirrored)
-- ============================================================================
create table portal_statuses (
  code text primary key,
  label text not null,
  category text not null check (category in (
    'pre_qualification','application','reservation','closeout','payment','terminal'
  )),
  meaning text,
  recommended_action text,
  needs_validation boolean not null default false
);

-- ============================================================================
-- REFERENCE: FIELD-MANAGEMENT PROJECT LABELS (mirrored, hypothesis-mapped)
-- ============================================================================
create table fieldwire_labels (
  code text primary key,
  label text not null,
  mapped_pipeline_stage_code text references pipeline_stages(code),
  needs_validation boolean not null default true
);

-- ============================================================================
-- REFERENCE: COMPLIANCE DOCUMENT TYPES
-- ============================================================================
create table compliance_doc_types (
  code text primary key,
  label text not null,
  lifecycle_stage text not null check (lifecycle_stage in (
    'pre_qualification','pre_reservation','pre_install','mid_install','post_install','closeout'
  )),
  applies_to_track text not null check (applies_to_track in ('HOMES','HEAR','both','conditional')),
  required boolean not null default true,
  condition_note text,
  source_citation text
);

-- ============================================================================
-- PROJECTS (the unified lead -> project record)
-- ============================================================================
create table projects (
  id uuid primary key default gen_random_uuid(),
  display_id text unique,

  homeowner_name text not null,
  phone text,
  email text,
  address_line1 text,
  address_line2 text,
  county text,
  distance_miles_from_office numeric(6,2),

  ami_tier text check (ami_tier in ('tier_1','tier_2','unknown')) default 'unknown',

  lead_source text check (lead_source in (
    'portal','direct_call','direct_email','referral','website_form','other','unknown'
  )) default 'unknown',

  fieldwire_label_code text references fieldwire_labels(code),

  qualification_result text check (qualification_result in (
    'pending','qualified','on_hold_no_audit','declined_out_of_area',
    'routed_devon_eligibility','rejected','unknown'
  )) default 'pending',
  service_area_check text check (service_area_check in ('in_area','out_of_area','gray_zone','not_checked')) default 'not_checked',
  audit_report_on_file boolean not null default false,
  audit_report_url text,
  audit_report_box_file_id text,
  audit_report_box_version_id text,
  audit_report_sha1 text,
  audit_report_date date,

  assigned_owner_id uuid references staff(id),
  site_visit_scheduled_for date,
  site_visit_completed_at timestamptz,

  intake_form_data jsonb,

  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_projects_owner on projects(assigned_owner_id);

comment on column projects.intake_form_data is 'Full homeowner intake questionnaire as submitted via the public website form: interview answers, budget/cost-share, other-funding disclosure, scheduling constraints, preferred site-visit date/window.';
comment on column projects.audit_report_url is 'Permanent document-store shared/web link after intake handoff; an intake-form URL is only temporary transport.';
comment on column projects.audit_report_box_file_id is 'Canonical document-store file ID for the current homeowner audit report.';
comment on column projects.audit_report_box_version_id is 'Current document-store file version ID used by ingestion deduplication.';
comment on column projects.audit_report_sha1 is 'Document hash used to prevent duplicate ingestion of the same file.';

-- ============================================================================
-- PROJECT APPLICATIONS (per-program status tracking)
-- ============================================================================
create table project_applications (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  program_track text not null check (program_track in ('HOMES','HEAR')),

  internal_status_code text not null references pipeline_stages(code),
  portal_status_code text references portal_statuses(code),
  portal_status_updated_at timestamptz,
  portal_status_stale boolean not null default false,
  portal_application_id uuid,
  portal_presence_status text not null default 'unknown' check (portal_presence_status in ('yes','no','unknown')),
  tracker_id text,
  assessment_scheduled_for date,
  assessment_completed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (project_id, program_track)
);

create index idx_pa_project on project_applications(project_id);
create index idx_pa_internal_status on project_applications(internal_status_code);
create index idx_pa_portal_status on project_applications(portal_status_code);
create index idx_pa_portal_application_id on project_applications(portal_application_id);

comment on table project_applications is 'One row PER PROGRAM (HOMES/HEAR) a homeowner applied to. Preconstruction readiness requires EVERY row for a project to independently reach the reservation-approved status before construction starts on ANY of that homeowner''s scopes.';
comment on column project_applications.portal_status_stale is 'Set by a scheduled check: no portal_status_events row for this application in >48h while status is non-terminal.';

-- ============================================================================
-- QUALIFICATION SCREENINGS (audit trail of the 3-step qualification filter)
-- ============================================================================
create table qualification_screenings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  step text not null check (step in ('1_audit_report','2_service_radius','3_program_eligibility')),
  result text not null check (result in ('pass','fail','needs_human_review')),
  rule_version text,
  evaluated_by text not null check (evaluated_by in ('system','human')),
  evaluated_by_staff_id uuid references staff(id),
  notes text,
  evaluated_at timestamptz not null default now()
);

create index idx_qual_screenings_project on qualification_screenings(project_id);

-- ============================================================================
-- PROJECT COMPLIANCE DOCUMENTS (per-project checklist state)
-- ============================================================================
create table project_compliance_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  doc_type_code text not null references compliance_doc_types(code),
  status text not null check (status in ('missing','uploaded','pending_review','rejected')) default 'missing',
  file_url text,
  uploaded_at timestamptz,
  uploaded_by_staff_id uuid references staff(id),
  notes text,
  auto_detected boolean not null default false,
  unique (project_id, doc_type_code)
);

create index idx_pcd_project on project_compliance_documents(project_id);
create index idx_pcd_status on project_compliance_documents(status);

comment on column project_compliance_documents.auto_detected is 'true when this row was created/updated by the document-intake -> compliance bridge trigger, not a human. Staff still confirms (pending_review -> uploaded).';

-- ============================================================================
-- PORTAL STATUS EVENTS (raw email ingestion log)
-- ============================================================================
create table portal_status_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  project_application_id uuid references project_applications(id) on delete set null,
  received_at timestamptz not null default now(),
  subject text,
  body_snippet text,
  parsed_status_code text references portal_statuses(code),
  matched boolean not null default false,
  raw_source text,
  from_address text,
  portal_application_id uuid,
  program_track text,
  status_meaning text,
  event_type text,
  property_address text,
  max_rebate_amount numeric(12,2),
  resolved boolean not null default false,
  resolved_by_staff_id uuid references staff(id),
  resolved_at timestamptz
);

create index idx_pse_project on portal_status_events(project_id);
create index idx_pse_project_application on portal_status_events(project_application_id);
create index idx_pse_portal_application_id on portal_status_events(portal_application_id);
create index idx_pse_unresolved on portal_status_events(resolved) where resolved = false;

comment on table portal_status_events is 'Populated by an inbound-email parsing workflow. Portal status emails often address the CONTRACTOR, not the homeowner, and mostly refer to leads not yet in the pipeline, so matched=false is the norm -- these surface on the Action Center for manual review instead of being dropped.';
comment on column portal_status_events.portal_application_id is 'The portal''s own Application ID (UUID) parsed from the email body. Distinct from project_application_id -- this is the correlation key BEFORE a lead is in the pipeline.';

-- ============================================================================
-- AUTOMATION EVENTS (workflow monitoring / activity feed)
-- ============================================================================
create table automation_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  source_workflow text not null,
  project_id uuid references projects(id) on delete set null,
  project_application_id uuid references project_applications(id) on delete set null,
  event_type text not null,
  message text not null,
  severity text not null check (severity in ('info','warning','critical')) default 'info'
);

create index idx_ae_project on automation_events(project_id);
create index idx_ae_occurred on automation_events(occurred_at desc);

comment on table automation_events is 'Backs the Dashboard activity feed and doubles as the workflow-monitoring surface. Every automation should write here on run.';

-- ============================================================================
-- MAILBOX TRIAGE EVENTS (non-portal mail landing in the shared inbox)
-- ============================================================================
create table mailbox_triage_events (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  from_name text,
  from_address text,
  subject text,
  body_snippet text,
  ai_summary text,
  outlook_web_url text,
  email_type text not null check (email_type in ('subcontractor','homeowner_inquiry','other')),
  raw_source text,
  resolved boolean not null default false,
  resolved_by_staff_id uuid references staff(id),
  resolved_at timestamptz,
  resolved_note text
);

create index idx_mte_resolved on mailbox_triage_events(resolved);
create index idx_mte_received on mailbox_triage_events(received_at desc);

comment on table mailbox_triage_events is 'Populated by an AI classifier: any shared-inbox email that is NOT a portal status notification (subcontractor mail, homeowner inquiries, other) lands here so staff see it without checking the mailbox directly.';
comment on column mailbox_triage_events.ai_summary is 'One-sentence AI summary of the sender''s current message, excluding quoted reply history.';
comment on column mailbox_triage_events.outlook_web_url is 'Deep link for opening the exact source message in the mail client''s web UI.';

-- ============================================================================
-- ESTIMATES
-- ============================================================================
create table estimates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  estimate_number text not null,
  version int not null default 1,
  program_track text not null check (program_track in ('HOMES','HEAR')),
  status text not null default 'ai_draft' check (status in (
    'ai_draft','pending_review','approved','sent_for_signature','signed','rejected'
  )),
  total_project_cost numeric(10,2),
  rebate_amount numeric(10,2),
  homeowner_out_of_pocket numeric(10,2),
  ai_confidence numeric(5,2),
  ai_gap_flags jsonb,
  reviewed_by_staff_id uuid references staff(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  delivery_provider text check (delivery_provider in ('gohighlevel','box_sign')) default 'box_sign',
  delivery_status text not null default 'not_ready' check (delivery_status in (
    'not_ready','ready','box_sign_queued','box_sign_sent','ghl_draft_requested','ghl_draft_created',
    'outlook_draft_created','ready_for_human_release','sent','viewed','signed','declined','failed',
    'ready_for_portal_upload','uploaded_to_portal'
  )),
  ghl_document_id text,
  ghl_contact_id text,

  is_test boolean not null default false,
  test_operator_staff_id uuid references staff(id),
  test_recipient_email text,

  outlook_draft_message_id text,
  outlook_draft_web_url text,
  release_prepared_at timestamptz,
  homeowner_sent_at timestamptz,
  signed_at timestamptz,
  portal_uploaded_at timestamptz,

  parent_estimate_id uuid references estimates(id) on delete set null,
  revision_reason text,
  pricing_status text not null default 'not_started' check (pricing_status in ('not_started','in_progress','ready','blocked')),
  box_approved_file_id text,
  box_approved_file_url text,
  box_signed_file_id text,
  box_signed_file_url text,

  box_sign_request_id text,
  box_sign_status text,
  box_sign_source_file_id text,
  box_sign_signed_file_id text,
  box_sign_signing_log_file_id text,

  validation_checks jsonb not null default '[]'::jsonb,
  approved_snapshot jsonb,
  approved_at timestamptz,

  terms_version text not null default 'v1.0-demo',
  terms_document_path text not null default '/legal/ESRP-Terms-of-Service-v1.0-demo.pdf',
  package_snapshot jsonb,
  ai_gap_resolution text,

  rebate_calculation_notes text,
  modeled_savings_percent numeric(6,2),

  unique (estimate_number, program_track, version)
);

create index idx_estimates_project on estimates(project_id);

comment on table estimates is 'Human review is a hard gate: no estimate reaches a homeowner without final sign-off.';

-- ============================================================================
-- ESTIMATE WORK ITEMS (document-readiness case per project/program)
-- ============================================================================
create table estimate_work_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  project_application_id uuid references project_applications(id) on delete cascade,
  program_track text check (program_track in ('HOMES','HEAR')),
  box_project_folder_id text,
  box_project_folder_name text not null,
  readiness_status text not null default 'collecting_inputs' check (readiness_status in (
    'collecting_inputs','awaiting_site_visit','awaiting_manual_js','ready_for_draft',
    'drafting','draft_ready','in_review','approved','sent_for_signature','signed','blocked'
  )),
  hvac_in_scope boolean,
  manual_j_required boolean not null default false,
  manual_s_required boolean not null default false,
  missing_inputs jsonb not null default '[]'::jsonb,
  readiness_notes text,
  latest_estimate_id uuid references estimates(id) on delete set null,
  last_box_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (box_project_folder_id, program_track)
);

create index idx_estimate_work_items_project on estimate_work_items(project_id);
create index idx_estimate_work_items_status on estimate_work_items(readiness_status);

comment on table estimate_work_items is 'One AI-estimating readiness case per document-store project/program. Missing Manual J/S is a waiting state, not a workflow error.';

-- ============================================================================
-- ESTIMATE SOURCE DOCUMENTS
-- ============================================================================
create table estimate_source_documents (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references estimate_work_items(id) on delete cascade,
  document_type text not null check (document_type in (
    'audit_report','site_visit','manual_j','manual_s','pricing_support','other'
  )),
  box_file_id text not null,
  box_file_version_id text not null default '',
  box_sha1 text,
  box_path text not null,
  file_name text not null,
  mime_type text,
  extraction_status text not null default 'pending' check (extraction_status in (
    'pending','processing','extracted','failed','ignored'
  )),
  extracted_data jsonb,
  extraction_error text,
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (box_file_id, box_file_version_id)
);

create index idx_estimate_source_docs_work_item on estimate_source_documents(work_item_id);
create index idx_estimate_source_docs_type on estimate_source_documents(document_type);

comment on table estimate_source_documents is 'Relevant intake PDFs only. Standalone photo/plan/as-built events are ignored before insertion.';

-- ============================================================================
-- ESTIMATE LINE ITEMS
-- ============================================================================
create table estimate_line_items (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references estimates(id) on delete cascade,
  scope_name text not null,
  description text,
  materials_amount numeric(10,2),
  materials_description text,
  labor_amount numeric(10,2),
  labor_description text,
  sort_order int not null default 0,

  item_type text not null default 'scope' check (item_type in ('scope','material','labor','fee','adjustment')),
  parent_line_item_id uuid references estimate_line_items(id) on delete cascade,
  area_location text,
  material_name text,
  manufacturer text,
  model_number text,
  energy_star_certified boolean,
  ahri_reference text,
  ahri_certificate_url text,
  source_vendor text,
  source_url text,
  source_checked_at date,
  quantity numeric(12,3),
  unit_of_measure text,
  unit_cost numeric(12,2),
  waste_factor_percent numeric(6,2),
  subcontractor_name text,
  labor_pricing_method text check (labor_pricing_method in ('daily','hourly','fixed','area')),
  labor_rate numeric(14,8),
  labor_days numeric(8,2),
  labor_hours numeric(8,2),
  crew_size numeric(6,2),
  permit_amount numeric(12,2),
  tax_amount numeric(12,2),
  markup_amount numeric(12,2),
  rebate_eligible boolean,
  internal_notes text,
  ai_generated boolean not null default false,
  ai_source_document_id uuid references estimate_source_documents(id) on delete set null,
  ai_confidence numeric(5,2),
  updated_at timestamptz not null default now(),

  labor_hours_per_day numeric(8,2),
  subcontractor_quote_amount numeric(12,2),
  program_hourly_rate numeric(12,4),
  subcontractor_quote_url text,
  labor_rate_override_reason text,
  labor_reconciliation_difference numeric(12,2),

  cost_category text check (cost_category in (
    'materials','equipment','labor','permit_fees','overhead','profit',
    'contingency','bonding','mobilization','travel','tax_delivery','unclassified'
  )),
  sero_scope_document_id uuid references estimate_source_documents(id) on delete set null,
  sero_scope_reference text,

  technical_specifications text,
  specification_source text,
  energy_star_source_url text,
  compliance_reference text,

  measured_area numeric(12,2) check (measured_area is null or measured_area >= 0),
  area_unit text,
  coverage_per_unit numeric(12,3) check (coverage_per_unit is null or coverage_per_unit > 0),
  calculated_quantity numeric(12,3),
  area_allowance_percent numeric(6,2) check (area_allowance_percent is null or area_allowance_percent between 0 and 100)
);

create index idx_eli_estimate on estimate_line_items(estimate_id);
create index idx_eli_parent on estimate_line_items(parent_line_item_id);
create index idx_eli_type on estimate_line_items(estimate_id, item_type, sort_order);

comment on column estimate_line_items.sero_scope_document_id is 'Extracted state-program scope-of-work document supporting a HEAR line -- HOMES quotation/technical files do not establish HEAR scope.';
comment on column estimate_line_items.measured_area is 'Field/audit area used for traceable area-based material or labor calculations.';
comment on column estimate_line_items.coverage_per_unit is 'Manufacturer/source coverage per purchasable package; area-based quantity rounds up.';
comment on column estimate_line_items.area_allowance_percent is 'Takeoff allowance applied before rounding area-based package quantity.';

-- ============================================================================
-- ESTIMATE APPROVAL STEPS
-- ============================================================================
create table estimate_approval_steps (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references estimates(id) on delete cascade,
  sequence_number int not null check (sequence_number between 1 and 4),
  reviewer_key text not null check (reviewer_key in ('christina','devon','renee','marcus','jordan')),
  reviewer_label text not null,
  reviewer_staff_id uuid references staff(id),
  status text not null default 'locked' check (status in (
    'locked','pending','approved','changes_requested','rejected'
  )),
  decided_by_staff_id uuid references staff(id),
  decided_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  unique (estimate_id, reviewer_key)
);

create index idx_estimate_approval_steps_estimate on estimate_approval_steps(estimate_id, sequence_number);

comment on table estimate_approval_steps is 'Christina reviews the draft first. Jordan holds final approval; Marcus is the authorized fallback final approver when Jordan is unavailable. Devon and Renee retain view access.';

-- ============================================================================
-- ESTIMATE PROGRAM RETURNS
-- ============================================================================
create table estimate_program_returns (
  id uuid primary key default gen_random_uuid(),
  project_application_id uuid not null references project_applications(id) on delete cascade,
  estimate_id uuid references estimates(id) on delete set null,
  portal_status_event_id uuid references portal_status_events(id) on delete set null,
  returned_reason text,
  affected_items jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open','revision_in_progress','resubmitted','resolved')),
  returned_at timestamptz not null default now(),
  resubmission_due_at timestamptz,
  resolved_at timestamptz,
  created_by_staff_id uuid references staff(id)
);

create index idx_estimate_returns_application on estimate_program_returns(project_application_id, returned_at desc);
create index idx_estimate_returns_status on estimate_program_returns(status);
create unique index idx_estimate_returns_portal_event_unique
  on estimate_program_returns(portal_status_event_id) where portal_status_event_id is not null;

-- ============================================================================
-- ESTIMATE LINE ITEM HISTORY
-- ============================================================================
create table estimate_line_item_history (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references estimates(id) on delete cascade,
  line_item_id uuid not null,
  changed_by_staff_id uuid references staff(id),
  old_row jsonb,
  new_row jsonb,
  changed_at timestamptz not null default now()
);

create index idx_elih_estimate on estimate_line_item_history(estimate_id, changed_at desc);

comment on column estimate_line_item_history.line_item_id is 'Stable identifier of the current or deleted estimate line; intentionally not a foreign key so deletion history is preserved.';

-- ============================================================================
-- ESTIMATE NUMBER HISTORY
-- ============================================================================
create table estimate_number_history (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references estimates(id) on delete cascade,
  previous_number text not null,
  new_number text not null,
  reason text not null,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);

-- ============================================================================
-- ESTIMATE PRICING ASSUMPTIONS
-- ============================================================================
create table estimate_pricing_assumptions (
  estimate_id uuid primary key references estimates(id) on delete cascade,
  county text,
  tax_rate numeric(6,4),
  tax_source_url text,
  tax_checked_at timestamptz,
  overhead_percent numeric(6,2) not null default 7,
  profit_percent numeric(6,2) not null default 7,
  contingency_percent numeric(6,2) not null default 1,
  bonding_percent numeric(6,2) not null default 3,
  mobilization_percent numeric(6,2) not null default 2,
  travel_percent numeric(6,2) not null default 1,
  material_split_percent numeric(6,2) not null default 55,
  labor_split_percent numeric(6,2) not null default 45,
  source_workbook text not null default 'Stonebridge current estimating workbook',
  updated_at timestamptz not null default now(),
  updated_by_staff_id uuid references staff(id),
  check (material_split_percent + labor_split_percent = 100)
);

-- ============================================================================
-- ESTIMATE PRICE BOOK ITEMS
-- ============================================================================
create table estimate_price_book_items (
  id uuid primary key default gen_random_uuid(),
  item_key text not null,
  item_type text not null check (item_type in ('material','labor','permit','fee','markup','rebate')),
  label text not null,
  county text,
  program_track text check (program_track is null or program_track in ('HOMES','HEAR')),
  unit_of_measure text,
  unit_cost numeric(12,4) not null,
  source_name text not null,
  source_url text,
  source_kind text not null default 'workbook' check (source_kind in ('workbook','supplier','government','program','subcontractor')),
  effective_date date not null,
  checked_at timestamptz not null default now(),
  active boolean not null default true,
  notes text,
  unique (item_key, effective_date, county, program_track)
);

comment on table estimate_price_book_items is 'Versioned workbook, supplier, government, program, and subcontractor prices. Never overwrite historical effective versions.';

-- ============================================================================
-- COUNTY PRICING RULES
-- ============================================================================
create table county_pricing_rules (
  county text primary key,
  state_rate numeric(6,4) not null default 5.30,
  local_transit_rate numeric(6,4) not null,
  combined_rate numeric(6,4) generated always as (state_rate + local_transit_rate) stored,
  tax_source_url text not null,
  permit_source_url text,
  effective_date date not null,
  checked_at timestamptz not null default now()
);

-- ============================================================================
-- ESTIMATE DELIVERY SETTINGS + BOX SIGN OUTBOX
-- ============================================================================
create table estimate_delivery_settings (
  singleton boolean primary key default true check (singleton),
  production_auto_send_enabled boolean not null default false,
  box_parent_folder_id text,
  box_template_id text,
  updated_at timestamptz not null default now(),
  updated_by_staff_id uuid references staff(id)
);
insert into estimate_delivery_settings (singleton) values (true) on conflict do nothing;

create table box_sign_delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null unique references estimates(id) on delete cascade,
  recipient_email text,
  status text not null check (status in ('blocked','pending','processing','sent','completed','declined','failed')),
  is_test boolean not null default false,
  blocker text,
  attempt_count int not null default 0,
  box_sign_request_id text,
  prepare_url text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_box_sign_jobs_status on box_sign_delivery_jobs(status, created_at);

comment on table box_sign_delivery_jobs is 'Automatic e-sign outbox created only after final approval. Test estimates are restricted to their controlled test recipient.';
comment on column box_sign_delivery_jobs.prepare_url is 'E-sign provider prepare_url returned when document preparation is required. Staff opens this to place signature fields and click Send -- nothing reaches the homeowner until then.';

-- ============================================================================
-- ESTIMATE REVIEW EMAIL OUTBOX (homeowner "please review" draft, per project)
-- ============================================================================
create table estimate_review_email_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  estimate_ids uuid[] not null,
  recipient_email text,
  status text not null check (status in ('blocked','pending','processing','sent','failed')),
  is_test boolean not null default false,
  blocker text,
  attempt_count int not null default 0,
  outlook_draft_message_id text,
  outlook_draft_web_url text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_review_email_jobs_status on estimate_review_email_jobs(status, created_at);

comment on table estimate_review_email_jobs is 'Outbox for the homeowner review email (estimate PDF(s) attached, "let us know if you would like to proceed"). One row per PROJECT, combining every program-track estimate ready to send together. Status=sent means a draft was created, not that anyone emailed the homeowner -- staff still reviews and sends it by hand.';

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

create or replace function recalculate_estimate_total(p_estimate_id uuid)
returns numeric language plpgsql security definer set search_path = public as $$
declare calculated numeric(12,2);
begin
  select coalesce(sum(
    coalesce(materials_amount,0) + coalesce(labor_amount,0) +
    coalesce(permit_amount,0) + coalesce(tax_amount,0) + coalesce(markup_amount,0)
  ),0)::numeric(12,2)
  into calculated
  from estimate_line_items where estimate_id=p_estimate_id;

  update estimates set total_project_cost=calculated,
    homeowner_out_of_pocket=greatest(calculated-coalesce(rebate_amount,0),0),updated_at=now()
  where id=p_estimate_id;
  return calculated;
end;
$$;

create or replace function try_jsonb_array(p_text text) returns jsonb
language plpgsql immutable as $$
begin
  if nullif(trim(p_text),'') is null then return '[]'::jsonb; end if;
  return case when jsonb_typeof(p_text::jsonb)='array' then p_text::jsonb else '[]'::jsonb end;
exception when others then return '[]'::jsonb;
end $$;

create or replace function try_numeric(p_text text) returns numeric
language plpgsql immutable as $$
begin
  if nullif(trim(p_text),'') is null or trim(p_text) !~ '^[0-9]+([.][0-9]+)?$' then return null; end if;
  return trim(p_text)::numeric;
end $$;

create or replace function recompute_estimate_readiness(p_work_item_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  w estimate_work_items%rowtype;
  has_audit boolean;
  has_site boolean;
  has_j boolean;
  has_s boolean;
  missing jsonb := '[]'::jsonb;
  next_status text;
begin
  select * into w from estimate_work_items where id = p_work_item_id for update;
  if not found then return; end if;

  select coalesce(bool_or(document_type = 'audit_report' and extraction_status = 'extracted'), false)
  into has_audit
  from estimate_source_documents
  where work_item_id = p_work_item_id;

  select
    coalesce(bool_or(d.document_type = 'site_visit' and d.extraction_status = 'extracted'), false),
    coalesce(bool_or(d.document_type = 'manual_j' and d.extraction_status = 'extracted'), false),
    coalesce(bool_or(d.document_type = 'manual_s' and d.extraction_status = 'extracted'), false)
  into has_site, has_j, has_s
  from estimate_source_documents d
  join estimate_work_items sibling on sibling.id = d.work_item_id
  where sibling.project_id = w.project_id;

  if not has_audit then missing := missing || '"audit_report"'::jsonb; end if;
  if not has_site then missing := missing || '"site_visit"'::jsonb; end if;
  if w.manual_j_required and not has_j then missing := missing || '"manual_j"'::jsonb; end if;
  if w.manual_s_required and not has_s then missing := missing || '"manual_s"'::jsonb; end if;

  if not has_audit then next_status := 'collecting_inputs';
  elsif not has_site then next_status := 'awaiting_site_visit';
  elsif w.hvac_in_scope is null then next_status := 'collecting_inputs';
  elsif (w.manual_j_required and not has_j) or (w.manual_s_required and not has_s) then next_status := 'awaiting_manual_js';
  else next_status := 'ready_for_draft';
  end if;

  if w.latest_estimate_id is null and exists (
    select 1 from (
      select distinct on (d.box_file_id) d.extraction_status
      from estimate_source_documents d join estimate_work_items sibling on sibling.id=d.work_item_id
      where sibling.project_id=w.project_id and (d.work_item_id=w.id or d.document_type in ('site_visit','manual_j','manual_s'))
      order by d.box_file_id,d.received_at desc,d.id desc
    ) latest where extraction_status in ('pending','processing','failed')
  ) then
    next_status:='collecting_inputs';
    missing:=missing||jsonb_build_array('Uploaded files still require successful extraction');
  end if;

  if w.readiness_status in ('drafting','draft_ready','in_review','approved','sent_for_signature','signed') then
    next_status := w.readiness_status;
  end if;

  update estimate_work_items
  set readiness_status = next_status, missing_inputs = missing, updated_at = now()
  where id = p_work_item_id;
end;
$$;

comment on function recompute_estimate_readiness(uuid) is
  'Recomputes program-specific readiness while treating an extracted site visit as shared evidence across the homeowner project.';

create or replace function estimate_source_document_readiness_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  affected_project_id uuid;
  source_work_item estimate_work_items%rowtype;
  sibling_id uuid;
begin
  select * into source_work_item
  from estimate_work_items
  where id = coalesce(new.work_item_id, old.work_item_id);
  affected_project_id := source_work_item.project_id;

  -- A shared technical upload opens/updates an estimating workspace for every
  -- program application on the project. The underlying file is still stored once.
  if tg_op <> 'DELETE' and new.document_type in ('site_visit', 'manual_j', 'manual_s') then
    insert into estimate_work_items (
      project_id, project_application_id, program_track,
      box_project_folder_id, box_project_folder_name,
      hvac_in_scope, manual_j_required, manual_s_required,
      last_box_event_at
    )
    select
      app.project_id, app.id, app.program_track,
      source_work_item.box_project_folder_id, source_work_item.box_project_folder_name,
      source_work_item.hvac_in_scope,
      source_work_item.manual_j_required, source_work_item.manual_s_required,
      new.received_at
    from project_applications app
    where app.project_id = affected_project_id
      and app.program_track in ('HOMES', 'HEAR')
      and not exists (
        select 1 from estimate_work_items existing
        where existing.project_id = app.project_id
          and existing.program_track = app.program_track
      );
  end if;

  for sibling_id in
    select id from estimate_work_items where project_id = affected_project_id
  loop
    perform recompute_estimate_readiness(sibling_id);
  end loop;

  return coalesce(new, old);
end;
$$;

create or replace function initialize_estimate_approvals()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status<>'pending_review' then return new; end if;
  if tg_op='UPDATE' and old.status=new.status then return new; end if;
  insert into estimate_approval_steps(estimate_id,sequence_number,reviewer_key,reviewer_label,reviewer_staff_id,status) values
    (new.id,1,'christina','Christina - quotation and costing review',(select id from staff where active and full_name ilike 'Christina%' order by created_at limit 1),'pending'),
    (new.id,2,'marcus','Marcus - final fallback',(select id from staff where active and full_name ilike 'Marcus%' order by created_at limit 1),'locked'),
    (new.id,2,'jordan','Jordan - final approval',(select id from staff where active and full_name ilike 'Jordan%' order by created_at limit 1),'locked')
  on conflict(estimate_id,reviewer_key) do nothing;
  return new;
end $$;

comment on table estimate_approval_steps is 'Christina reviews first; Jordan is final; Marcus is the fallback final approver. Devon and Renee keep visibility; historical decisions are preserved.';

create or replace function guard_estimate_review_roles()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status is distinct from old.status and new.status in ('approved','changes_requested','rejected') then
    if new.reviewer_key in ('devon','renee') then raise exception 'This role has view access, not approval duties'; end if;
    if new.reviewer_key in ('jordan','marcus') and not exists(select 1 from estimate_approval_steps where estimate_id=new.estimate_id and reviewer_key='christina' and status='approved') then raise exception 'Christina must complete the first approval'; end if;
    if new.reviewer_key='marcus' and new.status='approved' and coalesce(new.note,'') not like '%Final fallback reason:%' then raise exception 'Use the final fallback action and record why the primary final approver is unavailable'; end if;
  end if;
  return new;
end $$;

create or replace function enforce_estimate_approval_transition()
returns trigger language plpgsql security definer set search_path = public as $$
declare estimate_is_test boolean; test_operator uuid; estimate_status text;
begin
  if new.status = old.status then return new; end if;

  if old.status = 'locked' and new.status = 'pending' then
    if old.reviewer_key <> 'christina' and exists (
      select 1 from estimate_approval_steps
      where estimate_id=old.estimate_id and reviewer_key='christina' and status <> 'approved'
    ) then raise exception 'Christina must complete the draft review first'; end if;
    return new;
  end if;

  if old.status = 'pending' and new.status = 'locked' then
    select status into estimate_status from estimates where id=old.estimate_id;
    if estimate_status not in ('approved','ai_draft','rejected') then
      raise exception 'An active review cannot be closed before the estimate is finalized or returned';
    end if;
    return new;
  end if;

  if old.status = 'pending' and new.status in ('approved','changes_requested','rejected') then
    if old.reviewer_staff_id is null then raise exception 'Reviewer account is not linked to staff'; end if;
    select is_test,test_operator_staff_id into estimate_is_test,test_operator from estimates where id=old.estimate_id;
    if new.decided_by_staff_id is distinct from old.reviewer_staff_id
      and not (estimate_is_test and new.decided_by_staff_id is not distinct from test_operator) then
      raise exception 'Only the assigned reviewer can decide this review';
    end if;
    if new.decided_at is null then new.decided_at := now(); end if;
    if estimate_is_test and new.decided_by_staff_id is not distinct from test_operator
      and new.decided_by_staff_id is distinct from old.reviewer_staff_id then
      new.note := concat_ws(' | ',nullif(new.note,''),
        'CONTROLLED TEST: simulated ' || old.reviewer_label || '; actual operator staff id ' || test_operator::text);
    end if;
    return new;
  end if;

  raise exception 'Invalid estimate approval transition: % to %', old.status, new.status;
end;
$$;

create or replace function advance_estimate_approval_chain()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='approved' and old.status<>'approved' then
    if new.reviewer_key='christina' then
      update estimate_approval_steps set status='pending' where estimate_id=new.estimate_id and reviewer_key='jordan' and status='locked';
      update estimate_work_items set readiness_status='in_review',updated_at=now() where latest_estimate_id=new.estimate_id;
    elsif new.reviewer_key in ('jordan','marcus') then
      perform recompute_estimate_validation(new.estimate_id);
      if exists(select 1 from estimates where id=new.estimate_id and coalesce(ai_confidence,0)<95) then raise exception 'Compliance validation must be at least 95%%'; end if;
      update estimates e set status='approved',delivery_status='ready',reviewed_by_staff_id=new.decided_by_staff_id,reviewed_at=new.decided_at,
        approved_at=new.decided_at,package_snapshot=jsonb_build_object('estimate',to_jsonb(e),'terms_version',e.terms_version,
          'terms_document_path',e.terms_document_path,'lines',(select coalesce(jsonb_agg(to_jsonb(li) order by sort_order),'[]') from estimate_line_items li where li.estimate_id=e.id)),updated_at=now()
      where e.id=new.estimate_id;
      update estimate_work_items set readiness_status='approved',updated_at=now() where latest_estimate_id=new.estimate_id;
      update estimate_approval_steps set status='locked',note=concat_ws(' | ',nullif(note,''),'Review closed after final approval')
        where estimate_id=new.estimate_id and status='pending' and id<>new.id;
    end if;
  elsif new.status in('changes_requested','rejected') and old.status<>new.status then
    update estimates set status=case when new.status='rejected' then 'rejected' else 'ai_draft' end,updated_at=now() where id=new.estimate_id;
    update estimate_work_items set readiness_status='draft_ready',updated_at=now() where latest_estimate_id=new.estimate_id;
    update estimate_approval_steps set status='locked',note=concat_ws(' | ',nullif(note,''),'Review closed for correction')
      where estimate_id=new.estimate_id and status='pending' and id<>new.id;
  end if;
  return new;
end $$;

create or replace function activate_marcus_final_fallback(p_estimate_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare e estimates%rowtype; marcus_id uuid; caller_staff uuid;
begin
  if auth.role()<>'service_role' and not is_ops_hub_user() then raise exception 'Ops Hub access required'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'Fallback reason is required'; end if;
  select * into e from estimates where id=p_estimate_id for update;
  if not found or e.status<>'pending_review' then raise exception 'Estimate is not awaiting final approval'; end if;
  select reviewer_staff_id into marcus_id from estimate_approval_steps where estimate_id=p_estimate_id and reviewer_key='marcus';
  select id into caller_staff from staff where active and email ilike coalesce(auth.jwt()->>'email','') order by created_at limit 1;
  if marcus_id is null then raise exception 'Fallback reviewer account is not linked'; end if;
  if auth.role()<>'service_role' and caller_staff is distinct from marcus_id and not(e.is_test and caller_staff is not distinct from e.test_operator_staff_id) then raise exception 'Only the designated fallback reviewer may execute fallback final approval'; end if;
  if not exists(select 1 from estimate_approval_steps where estimate_id=p_estimate_id and reviewer_key='christina' and status='approved') then raise exception 'Christina must complete the first approval'; end if;
  if exists(select 1 from estimate_approval_steps where estimate_id=p_estimate_id and reviewer_key='marcus' and status='approved') then
    if recompute_estimate_validation(p_estimate_id)<95 then raise exception 'Compliance validation must be at least 95%%'; end if;
    update estimate_approval_steps set note=concat_ws(' | ',note,'Final fallback reason: '||trim(p_reason)||'; operator: '||coalesce(caller_staff,marcus_id)::text||'; time: '||now()::text) where estimate_id=p_estimate_id and reviewer_key='marcus';
    update estimates x set status='approved',delivery_status='ready',reviewed_by_staff_id=coalesce(caller_staff,marcus_id),reviewed_at=now(),approved_at=now(),package_snapshot=jsonb_build_object('estimate',to_jsonb(x),'terms_version',x.terms_version,'terms_document_path',x.terms_document_path,'lines',(select coalesce(jsonb_agg(to_jsonb(li) order by sort_order),'[]') from estimate_line_items li where li.estimate_id=x.id)),updated_at=now() where x.id=p_estimate_id;
    update estimate_work_items set readiness_status='approved',updated_at=now() where latest_estimate_id=p_estimate_id;
    update estimate_approval_steps set status='locked',note=concat_ws(' | ',note,'Review closed after fallback final approval') where estimate_id=p_estimate_id and status='pending';
    return;
  end if;
  update estimate_approval_steps set status='pending' where estimate_id=p_estimate_id and reviewer_key='marcus' and status='locked';
  update estimate_approval_steps set status='approved',decided_by_staff_id=coalesce(caller_staff,marcus_id),decided_at=now(),note=concat_ws(' | ',note,'Final fallback reason: '||trim(p_reason)) where estimate_id=p_estimate_id and reviewer_key='marcus' and status='pending';
end $$;

create or replace function create_ai_estimate_draft(p_work_item_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare w estimate_work_items%rowtype; eid uuid; n int; eno text; source estimate_source_documents%rowtype; label text; summary text; i int:=0;
begin
  if auth.role()<>'service_role' and not is_ops_hub_user() then raise exception 'Ops Hub access required'; end if;
  select * into w from estimate_work_items where id=p_work_item_id for update;
  if not found then raise exception 'Estimator case not found'; end if;
  if w.latest_estimate_id is not null then return w.latest_estimate_id; end if;
  if w.readiness_status<>'ready_for_draft' then raise exception 'All required inputs must be extracted before drafting'; end if;
  perform pg_advisory_xact_lock(hashtext('stonebridge-estimate-number'));
  select coalesce(max((regexp_match(estimate_number,'^EST-ESRP-([0-9]+)$'))[1]::int),0)+1 into n from estimates where estimate_number~'^EST-ESRP-[0-9]+$';
  eno:='EST-ESRP-'||lpad(n::text,4,'0');
  insert into estimates(project_id,estimate_number,version,program_track,status,pricing_status,delivery_provider,delivery_status,ai_confidence,ai_gap_flags)
    values(w.project_id,eno,1,w.program_track,'ai_draft','in_progress','box_sign','not_ready',0,'[]') returning id into eid;
  for source in select distinct on(d.document_type) d.* from estimate_source_documents d
    join estimate_work_items sibling on sibling.id=d.work_item_id
    where sibling.project_id=w.project_id and d.extraction_status='extracted'
      and d.document_type in('audit_report','site_visit','manual_j','manual_s')
    order by d.document_type,d.received_at desc,d.id desc
  loop
    label:=case source.document_type when 'audit_report' then 'Energy audit recommendations' when 'site_visit' then 'Site visit observations'
      when 'manual_j' then 'Manual J design inputs' when 'manual_s' then 'Manual S equipment selection' end;
    summary:=nullif(trim(source.extracted_data->>'summary'),'');
    insert into estimate_line_items(estimate_id,item_type,scope_name,description,sort_order,ai_generated,ai_source_document_id,ai_confidence,internal_notes)
      values(eid,'scope',label,coalesce(summary,'Review extracted source: '||source.file_name),i,true,source.id,0,
        'AI candidate only; estimator must verify program scope and add current pricing evidence.');
    i:=i+1;
  end loop;
  if i=0 then raise exception 'No extracted source documents are available'; end if;
  perform recompute_estimate_validation(eid);
  update estimate_work_items set latest_estimate_id=eid,readiness_status='draft_ready',updated_at=now() where id=p_work_item_id;
  return eid;
end $$;

create or replace function hydrate_structured_estimate_candidates()
returns trigger language plpgsql security definer set search_path=public as $$
declare d record; measure jsonb; equipment jsonb; parent_id uuid; candidate_count integer:=0; position integer:=0; gaps jsonb:='[]'::jsonb;
begin
  if new.latest_estimate_id is null or new.latest_estimate_id is not distinct from old.latest_estimate_id then return new; end if;
  update estimate_line_items set scope_name='Source-package note (not priced)' where estimate_id=new.latest_estimate_id and ai_generated=true and coalesce(internal_notes,'') like 'AI candidate only%';
  for d in select doc.* from estimate_source_documents doc join estimate_work_items source_work on source_work.id=doc.work_item_id where source_work.project_id=new.project_id and doc.extraction_status='extracted' and (doc.work_item_id=new.id or doc.document_type in ('site_visit','manual_j','manual_s')) order by doc.received_at loop
    for measure in select value from jsonb_array_elements(try_jsonb_array(d.extracted_data->>'measures_json')) loop
      if nullif(trim(measure->>'scope_name'),'') is not null and upper(coalesce(nullif(measure->>'program_track',''),nullif(d.extracted_data->>'program_track',''),new.program_track))=new.program_track and d.work_item_id=new.id then
        insert into estimate_line_items(estimate_id,item_type,scope_name,description,area_location,sort_order,ai_generated,ai_source_document_id,ai_confidence,internal_notes,rebate_eligible)
        values(new.latest_estimate_id,'scope',measure->>'scope_name',nullif(measure->>'description',''),nullif(measure->>'area_location',''),position,true,d.id,75,'AI candidate only; verify against cited source before pricing.',null);
        position:=position+1; candidate_count:=candidate_count+1;
      end if;
    end loop;
    for equipment in select value from jsonb_array_elements(try_jsonb_array(d.extracted_data->>'equipment_json')) loop
      if coalesce(nullif(equipment->>'material_name',''),nullif(equipment->>'component_model',''),nullif(equipment->>'indoor_model',''),nullif(equipment->>'outdoor_model','')) is not null and upper(coalesce(nullif(equipment->>'program_track',''),new.program_track))=new.program_track then
        parent_id:=null;
        select case when count(*)=1 then (array_agg(id))[1] else null end into parent_id from estimate_line_items where estimate_id=new.latest_estimate_id and item_type='scope' and lower(trim(scope_name))=lower(trim(equipment->>'scope_name'));
        insert into estimate_line_items(estimate_id,parent_line_item_id,item_type,scope_name,description,material_name,manufacturer,model_number,ahri_reference,technical_specifications,specification_source,energy_star_source_url,compliance_reference,ahri_certificate_url,measured_area,area_unit,coverage_per_unit,area_allowance_percent,quantity,unit_of_measure,sort_order,ai_generated,ai_source_document_id,ai_confidence,internal_notes,rebate_eligible)
        values(new.latest_estimate_id,parent_id,'material',concat_ws(' ',nullif(equipment->>'manufacturer',''),coalesce(nullif(equipment->>'component_model',''),nullif(equipment->>'outdoor_model',''),nullif(equipment->>'indoor_model',''))),concat_ws('; ',nullif(equipment->>'capacity',''),nullif(equipment->>'efficiency',''),nullif(equipment->>'manual_s_status','')),coalesce(nullif(equipment->>'material_name',''),nullif(concat_ws(' / ',nullif(equipment->>'outdoor_model',''),nullif(equipment->>'indoor_model',''),nullif(equipment->>'component_model','')),'')),nullif(equipment->>'manufacturer',''),concat_ws(' / ',nullif(equipment->>'outdoor_model',''),nullif(equipment->>'indoor_model',''),nullif(equipment->>'component_model','')),nullif(equipment->>'ahri_reference',''),concat_ws('; ',nullif(equipment->>'capacity',''),nullif(equipment->>'efficiency',''),nullif(equipment->>'airflow',''),nullif(equipment->>'refrigerant',''),nullif(equipment->>'warranty',''),nullif(equipment->>'manual_j_load',''),nullif(equipment->>'manual_s_status','')),concat_ws(' - ',d.file_name,'page '||nullif(equipment->>'source_page',''),nullif(equipment->>'specification_source_url','')),nullif(equipment->>'energy_star_source_url',''),nullif(equipment->>'compliance_reference',''),nullif(equipment->>'ahri_certificate_url',''),try_numeric(equipment->>'measured_area'),nullif(equipment->>'area_unit',''),try_numeric(equipment->>'coverage_per_unit'),try_numeric(equipment->>'area_allowance_percent'),try_numeric(equipment->>'quantity'),nullif(equipment->>'unit_of_measure',''),position,true,d.id,75,'AI candidate only; assign to a verified scope and confirm area, coverage, supplier, current price, ENERGY STAR status and AHRI evidence.',null);
        position:=position+1; candidate_count:=candidate_count+1;
      end if;
    end loop;
    gaps:=gaps||try_jsonb_array(d.extracted_data->>'conflicts_json');
    if nullif(trim(d.extracted_data->>'gap_flags'),'') is not null then gaps:=gaps||jsonb_build_array(d.extracted_data->>'gap_flags'); end if;
  end loop;
  if candidate_count=0 then
    insert into estimate_line_items(estimate_id,item_type,scope_name,description,sort_order,ai_generated,ai_confidence,internal_notes)
    values(new.latest_estimate_id,'scope','Source review required','No structured measures were extracted. The estimator must identify the supported scope.',0,true,50,'AI candidate only; no source-backed measure array was available.');
    gaps:=gaps||jsonb_build_array('No structured measure candidates were extracted');
  end if;
  update estimates set ai_gap_flags=gaps,updated_at=now() where id=new.latest_estimate_id;
  return new;
end $$;

create or replace function sero_scope_source_matches(p_estimate_id uuid,p_document_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from estimates e join estimate_source_documents d on d.id=p_document_id
    join estimate_work_items w on w.id=d.work_item_id
    where e.id=p_estimate_id and w.project_id=e.project_id
      and d.document_type in ('audit_report','pricing_support','other')
      and d.extraction_status='extracted'
      and (w.program_track=e.program_track or lower(coalesce(d.extracted_data->>'program',''))='both')
      and upper(coalesce(d.extracted_data->>'program_track',d.extracted_data->>'program',e.program_track)) in (e.program_track,'BOTH')
  );
$$;
revoke all on function sero_scope_source_matches(uuid,uuid) from public;

create or replace function validate_sero_scope_evidence()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.sero_scope_document_id is null then return new; end if;
  if new.item_type <> 'scope' then raise exception 'Scope evidence belongs on the parent scope'; end if;
  if nullif(trim(new.sero_scope_reference),'') is null then raise exception 'Source page or measure reference is required'; end if;
  if not sero_scope_source_matches(new.estimate_id,new.sero_scope_document_id) then raise exception 'Choose an extracted scope file for this property and program; HOMES quotation and technical files do not establish HEAR scope'; end if;
  new.sero_scope_reference:=trim(new.sero_scope_reference);
  return new;
end $$;

create or replace function recompute_estimate_validation(p_estimate_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare score integer:=100; checks jsonb:='[]'; e estimates%rowtype; wid uuid; hvac boolean; mj boolean; ms boolean;
begin
  select * into e from estimates where id=p_estimate_id; if not found then raise exception 'Estimate not found'; end if;
  select id,hvac_in_scope,manual_j_required,manual_s_required into wid,hvac,mj,ms from estimate_work_items where latest_estimate_id=p_estimate_id limit 1;
  if nullif(e.terms_document_path,'') is null or e.terms_version<>'v1.0-demo' then score:=score-20; checks:=checks||jsonb_build_array('Canonical Terms of Service is not attached'); end if;
  if wid is null or not exists(select 1 from estimate_source_documents d join estimate_work_items w on w.id=d.work_item_id where w.project_id=e.project_id and d.document_type='audit_report' and d.extraction_status='extracted') then score:=score-15; checks:=checks||jsonb_build_array('Extracted energy audit report is missing'); end if;
  if wid is null or not exists(select 1 from estimate_source_documents d join estimate_work_items w on w.id=d.work_item_id where w.project_id=e.project_id and d.document_type='site_visit' and d.extraction_status='extracted') then score:=score-15; checks:=checks||jsonb_build_array('Submitted Site Visit is missing'); end if;
  if hvac and mj and not exists(select 1 from estimate_source_documents d join estimate_work_items w on w.id=d.work_item_id where w.project_id=e.project_id and d.document_type='manual_j' and d.extraction_status='extracted') then score:=score-15; checks:=checks||jsonb_build_array('Required Manual J is missing'); end if;
  if hvac and ms and not exists(select 1 from estimate_source_documents d join estimate_work_items w on w.id=d.work_item_id where w.project_id=e.project_id and d.document_type='manual_s' and d.extraction_status='extracted') then score:=score-15; checks:=checks||jsonb_build_array('Required Manual S is missing'); end if;
  if jsonb_array_length(coalesce(e.ai_gap_flags,'[]'))>0 and nullif(trim(e.ai_gap_resolution),'') is null then score:=score-20; checks:=checks||jsonb_build_array('Extracted conflicts and missing fields require a documented resolution'); end if;
  if e.program_track='HEAR' and exists(select 1 from estimate_line_items l where l.estimate_id=p_estimate_id and l.item_type='scope' and not coalesce(l.internal_notes,'') like 'AI candidate only%' and (not sero_scope_source_matches(p_estimate_id,l.sero_scope_document_id) or nullif(trim(l.sero_scope_reference),'') is null)) then score:=score-25; checks:=checks||jsonb_build_array('Every HEAR scope requires its source file and page or measure reference'); end if;
  if not exists(select 1 from estimate_pricing_assumptions a where a.estimate_id=p_estimate_id and a.county is not null and a.tax_rate is not null) then score:=score-10; checks:=checks||jsonb_build_array('County and tax-rate pricing assumptions require verification'); end if;
  if not exists(select 1 from estimate_line_items where estimate_id=p_estimate_id and item_type='scope' and not coalesce(internal_notes,'') like 'AI candidate only%') then score:=score-25; checks:=checks||jsonb_build_array('No verified program scope is ready for quotation'); end if;
  if not exists(select 1 from estimate_line_items where estimate_id=p_estimate_id and item_type in('material','labor','fee')) then score:=score-25; checks:=checks||jsonb_build_array('No priced material, labor, or fee lines'); end if;
  if exists(select 1 from estimate_line_items where estimate_id=p_estimate_id and item_type<>'scope' and parent_line_item_id is null) then score:=score-10; checks:=checks||jsonb_build_array('Every cost line must be assigned to a quotation scope'); end if;
  if exists(select 1 from estimate_line_items where estimate_id=p_estimate_id and item_type='material' and (nullif(trim(material_name),'') is null or coalesce(quantity,0)<=0 or coalesce(unit_cost,0)<=0 or nullif(trim(source_vendor),'') is null or nullif(trim(source_url),'') is null)) then score:=score-15; checks:=checks||jsonb_build_array('Material name, quantity, unit price, supplier, and current source link are required'); end if;
  if exists(select 1 from estimate_line_items where estimate_id=p_estimate_id and item_type='material' and (source_checked_at is null or source_checked_at<current_date-interval '30 days')) then score:=score-10; checks:=checks||jsonb_build_array('Material prices must be source-checked within 30 days of review'); end if;
  if exists(select 1 from estimate_line_items where estimate_id=p_estimate_id and item_type='material' and rebate_eligible=true and (energy_star_certified is distinct from true or (manufacturer is not null and nullif(trim(model_number),'') is null))) then score:=score-15; checks:=checks||jsonb_build_array('Rebate-eligible equipment requires model-level ENERGY STAR verification'); end if;
  if exists(select 1 from estimate_line_items where estimate_id=p_estimate_id and item_type='labor' and (nullif(trim(subcontractor_name),'') is null or coalesce(subcontractor_quote_amount,0)<=0 or coalesce(labor_hours,0)<=0 or coalesce(program_hourly_rate,0)<=0 or abs(coalesce(labor_reconciliation_difference,999999))>.01)) then score:=score-15; checks:=checks||jsonb_build_array('Labor source, commercial total, crew-hours, and hourly reconciliation are incomplete'); end if;
  if exists(select 1 from estimate_line_items where estimate_id=p_estimate_id and rebate_eligible is null and not coalesce(internal_notes,'') like 'AI candidate only%') then score:=score-5; checks:=checks||jsonb_build_array('Every proposed line needs a rebate-eligibility decision'); end if;
  if exists(select 1 from estimate_line_items where estimate_id=p_estimate_id and item_type='material' and energy_star_certified=true and nullif(trim(energy_star_source_url),'') is null) then score:=score-15; checks:=checks||jsonb_build_array('ENERGY STAR certification requires an exact-model listing source; a checked box is not evidence'); end if;
  if exists(select 1 from estimate_line_items where estimate_id=p_estimate_id and item_type='material' and nullif(trim(model_number),'') is not null and (nullif(trim(technical_specifications),'') is null or nullif(trim(specification_source),'') is null or nullif(trim(compliance_reference),'') is null)) then score:=score-15; checks:=checks||jsonb_build_array('Modeled equipment requires capacities/ratings, specification evidence and applicable program requirement'); end if;
  if exists(select 1 from estimate_line_items where estimate_id=p_estimate_id and item_type='material' and nullif(trim(ahri_reference),'') is not null and nullif(trim(ahri_certificate_url),'') is null) then score:=score-15; checks:=checks||jsonb_build_array('Recorded AHRI numbers require the matching certificate source'); end if;
  perform recalculate_estimate_total(p_estimate_id); select * into e from estimates where id=p_estimate_id;
  if coalesce(e.total_project_cost,0)<=0 then score:=score-20; checks:=checks||jsonb_build_array('Project total must be greater than $0'); end if;
  score:=greatest(0,least(100,score)); update estimates set ai_confidence=score,validation_checks=checks,updated_at=now() where id=p_estimate_id; return score;
end $$;

create or replace function promote_estimate_to_review(p_estimate_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare e estimates%rowtype; score integer;
begin
  if auth.role()<>'service_role' and not is_ops_hub_user() then raise exception 'Ops Hub access required'; end if;
  perform recalculate_estimate_total(p_estimate_id);
  score:=recompute_estimate_validation(p_estimate_id);
  select * into e from estimates where id=p_estimate_id for update;
  if e.status<>'ai_draft' then raise exception 'Only an AI draft can enter review'; end if;
  if score<95 then raise exception 'Estimate package is only % complete. Resolve every validation item before review.',score; end if;
  update estimates set pricing_status='ready',status='pending_review',updated_at=now() where id=p_estimate_id;
  update estimate_work_items set readiness_status='in_review',updated_at=now() where latest_estimate_id=p_estimate_id;
end $$;

create or replace function create_estimate_revision(p_estimate_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  source estimates%rowtype;
  source_line estimate_line_items%rowtype;
  new_id uuid;
  new_line_id uuid;
  new_parent_id uuid;
  next_version integer;
  copied_columns text;
  copied_values text;
  line_id_map jsonb := '{}'::jsonb;
begin
  if auth.role() <> 'service_role' and not is_ops_hub_user() then raise exception 'Ops Hub access required'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'A revision reason is required'; end if;

  select * into source from estimates where id = p_estimate_id for update;
  if not found then raise exception 'Estimate not found'; end if;
  if source.status not in ('approved', 'sent_for_signature', 'signed') then
    raise exception 'Only approved, sent, or signed estimates require a new revision';
  end if;

  select coalesce(max(version), 0) + 1 into next_version
  from estimates where estimate_number = source.estimate_number and program_track = source.program_track;

  insert into estimates(
    project_id, estimate_number, version, program_track, status,
    total_project_cost, rebate_amount, homeowner_out_of_pocket,
    ai_confidence, ai_gap_flags, validation_checks, ai_gap_resolution,
    parent_estimate_id, revision_reason, pricing_status,
    delivery_provider, delivery_status, terms_version, terms_document_path,
    modeled_savings_percent, rebate_calculation_notes
  ) values (
    source.project_id, source.estimate_number, next_version, source.program_track, 'ai_draft',
    source.total_project_cost, source.rebate_amount, source.homeowner_out_of_pocket,
    source.ai_confidence, source.ai_gap_flags, source.validation_checks, source.ai_gap_resolution,
    source.id, trim(p_reason), 'in_progress',
    'box_sign', 'not_ready', source.terms_version, source.terms_document_path,
    source.modeled_savings_percent, source.rebate_calculation_notes
  ) returning id into new_id;

  select
    string_agg(format('%I', column_name), ', ' order by ordinal_position),
    string_agg(format('r.%I', column_name), ', ' order by ordinal_position)
  into copied_columns, copied_values
  from information_schema.columns
  where table_schema = 'public' and table_name = 'estimate_line_items'
    and column_name not in ('id', 'estimate_id', 'parent_line_item_id', 'created_at', 'updated_at')
    and is_generated = 'NEVER';

  for source_line in
    select * from estimate_line_items where estimate_id = source.id
    order by (parent_line_item_id is not null), sort_order, updated_at, id
  loop
    new_line_id := gen_random_uuid();
    new_parent_id := case when source_line.parent_line_item_id is null then null
      else (line_id_map ->> source_line.parent_line_item_id::text)::uuid end;
    execute format(
      'insert into estimate_line_items (id, estimate_id, parent_line_item_id, %s) select $1, $2, $3, %s from jsonb_populate_record(null::estimate_line_items, $4) r',
      copied_columns, copied_values
    ) using new_line_id, new_id, new_parent_id,
      to_jsonb(source_line) - array['id', 'estimate_id', 'parent_line_item_id', 'created_at', 'updated_at', 'labor_reconciliation_difference'];
    line_id_map := line_id_map || jsonb_build_object(source_line.id::text, new_line_id::text);
  end loop;

  insert into estimate_pricing_assumptions(
    estimate_id, county, tax_rate, tax_source_url, tax_checked_at,
    overhead_percent, profit_percent, contingency_percent, bonding_percent,
    mobilization_percent, travel_percent, material_split_percent, labor_split_percent
  )
  select new_id, county, tax_rate, tax_source_url, tax_checked_at,
    overhead_percent, profit_percent, contingency_percent, bonding_percent,
    mobilization_percent, travel_percent, material_split_percent, labor_split_percent
  from estimate_pricing_assumptions where estimate_id = source.id
  on conflict (estimate_id) do nothing;

  update estimate_work_items set latest_estimate_id = new_id,
    readiness_status = 'draft_ready', updated_at = now()
  where latest_estimate_id = source.id;
  return new_id;
end;
$$;

create or replace function record_estimate_program_return(
  p_application_id uuid,
  p_reason text,
  p_affected_items jsonb default '[]'::jsonb,
  p_portal_status_event_id uuid default null,
  p_resubmission_due_at timestamptz default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare app project_applications%rowtype; latest_estimate uuid; return_id uuid;
begin
  if auth.role() <> 'service_role' and not is_ops_hub_user() then
    raise exception 'Ops Hub access required';
  end if;
  select * into app from project_applications where id=p_application_id for update;
  if not found then raise exception 'Project application not found'; end if;

  if p_portal_status_event_id is not null then
    select id into return_id from estimate_program_returns
    where portal_status_event_id=p_portal_status_event_id;
    if return_id is not null then return return_id; end if;
  end if;

  select id into latest_estimate from estimates
  where project_id=app.project_id and program_track=app.program_track
  order by version desc,created_at desc limit 1;

  update project_applications set internal_status_code='returned',updated_at=now()
  where id=p_application_id;

  insert into estimate_program_returns(project_application_id,estimate_id,portal_status_event_id,
    returned_reason,affected_items,resubmission_due_at)
  values(p_application_id,latest_estimate,p_portal_status_event_id,nullif(trim(p_reason),''),
    coalesce(p_affected_items,'[]'::jsonb),p_resubmission_due_at)
  returning id into return_id;
  return return_id;
end;
$$;

create or replace function start_estimate_return_revision(p_return_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare return_row estimate_program_returns%rowtype; new_estimate_id uuid;
begin
  if auth.role() <> 'service_role' and not is_ops_hub_user() then raise exception 'Ops Hub access required'; end if;
  select * into return_row from estimate_program_returns where id=p_return_id for update;
  if not found then raise exception 'Program return not found'; end if;
  if return_row.status not in ('open','revision_in_progress') then
    raise exception 'This return is already resubmitted or resolved';
  end if;
  if return_row.estimate_id is null then raise exception 'No estimate is linked to this return'; end if;

  if return_row.status='revision_in_progress' then
    select id into new_estimate_id from estimates where parent_estimate_id=return_row.estimate_id
    order by version desc limit 1;
    if new_estimate_id is not null then return new_estimate_id; end if;
  end if;

  new_estimate_id := create_estimate_revision(return_row.estimate_id,
    coalesce(return_row.returned_reason,'Program returned estimate for correction'));
  update estimate_program_returns set status='revision_in_progress' where id=p_return_id;
  update project_applications set internal_status_code='estimate_pending_revision',updated_at=now()
  where id=return_row.project_application_id;
  return new_estimate_id;
end;
$$;

create or replace function bridge_portal_return_to_estimate()
returns trigger language plpgsql security definer set search_path = public as $$
declare latest_estimate uuid; latest_event uuid; reason text;
begin
  if new.portal_status_code <> 'app_returned'
    or new.portal_status_code is not distinct from old.portal_status_code then
    return new;
  end if;

  new.internal_status_code := 'returned';
  new.updated_at := now();

  select id,body_snippet into latest_event,reason from portal_status_events
  where project_application_id=new.id and parsed_status_code='app_returned'
  order by received_at desc limit 1;

  select id into latest_estimate from estimates
  where project_id=new.project_id and program_track=new.program_track
  order by version desc,created_at desc limit 1;

  if latest_event is null or not exists(
    select 1 from estimate_program_returns where portal_status_event_id=latest_event
  ) then
    insert into estimate_program_returns(project_application_id,estimate_id,portal_status_event_id,
      returned_reason,affected_items,status)
    values(new.id,latest_estimate,latest_event,
      coalesce(nullif(trim(reason),''),'Program returned the application for corrections.'),
      '[]'::jsonb,'open');
  end if;

  return new;
end;
$$;

create or replace function record_estimate_release_artifact(
  p_estimate_id uuid,
  p_artifact text,
  p_external_id text,
  p_external_url text default null
)
returns text language plpgsql security definer set search_path = public as $$
declare row_status text; next_status text;
begin
  if auth.role() <> 'service_role' and not is_ops_hub_user() then raise exception 'Ops Hub access required'; end if;
  select status into row_status from estimates where id=p_estimate_id for update;
  if row_status <> 'approved' then raise exception 'Final approval is required before release drafts'; end if;

  if p_artifact='ghl_requested' then
    update estimates set delivery_status='ghl_draft_requested',updated_at=now() where id=p_estimate_id;
  elsif p_artifact='ghl_draft' then
    update estimates set ghl_document_id=p_external_id,
      delivery_status=case when outlook_draft_message_id is not null then 'ready_for_human_release' else 'ghl_draft_created' end,
      release_prepared_at=case when outlook_draft_message_id is not null then now() else release_prepared_at end,updated_at=now()
    where id=p_estimate_id;
  elsif p_artifact='outlook_draft' then
    update estimates set outlook_draft_message_id=p_external_id,outlook_draft_web_url=p_external_url,
      delivery_status=case when ghl_document_id is not null or delivery_status='ghl_draft_requested' then 'ready_for_human_release' else 'outlook_draft_created' end,
      release_prepared_at=case when ghl_document_id is not null or delivery_status='ghl_draft_requested' then now() else release_prepared_at end,updated_at=now()
    where id=p_estimate_id;
  else raise exception 'Unknown release artifact: %',p_artifact;
  end if;

  select delivery_status into next_status from estimates where id=p_estimate_id;
  return next_status;
end;
$$;

create or replace function mark_estimate_homeowner_sent(p_estimate_id uuid, p_ghl_document_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'service_role' and not is_ops_hub_user() then raise exception 'Ops Hub access required'; end if;
  update estimates set delivery_status='sent',status='sent_for_signature',ghl_document_id=p_ghl_document_id,
    homeowner_sent_at=now(),updated_at=now()
  where id=p_estimate_id and status='approved' and delivery_status='ready_for_human_release';
  if not found then raise exception 'Both drafts and final approval are required before recording homeowner send'; end if;
  update estimate_work_items set readiness_status='sent_for_signature',updated_at=now() where latest_estimate_id=p_estimate_id;
end;
$$;

create or replace function mark_estimate_signed_for_portal(p_estimate_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'service_role' and not is_ops_hub_user() then raise exception 'Ops Hub access required'; end if;
  update estimates set status='signed',delivery_status='ready_for_portal_upload',signed_at=now(),updated_at=now()
  where id=p_estimate_id and (
    status='sent_for_signature' or
    (status='approved' and delivery_status in ('ready_for_human_release','sent','viewed'))
  );
  if not found then raise exception 'Final approval and a prepared/released document are required before signature'; end if;
  update estimate_work_items set readiness_status='signed',updated_at=now() where latest_estimate_id=p_estimate_id;
end;
$$;

create or replace function mark_estimate_portal_uploaded(p_estimate_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'service_role' and not is_ops_hub_user() then raise exception 'Ops Hub access required'; end if;
  update estimates set delivery_status='uploaded_to_portal',portal_uploaded_at=now(),updated_at=now()
  where id=p_estimate_id and status='signed' and delivery_status='ready_for_portal_upload';
  if not found then raise exception 'A signed estimate is required before portal upload'; end if;
end;
$$;

create or replace function queue_box_sign_after_final_approval()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  recipient text;
  production_enabled boolean;
  parent_folder text;
  job_status text;
  reason text;
begin
  if new.status <> 'sent_for_signature' or old.status = 'sent_for_signature' then return new; end if;

  select production_auto_send_enabled,box_parent_folder_id
  into production_enabled,parent_folder from estimate_delivery_settings where singleton;
  if new.is_test then
    recipient := lower(trim(coalesce(new.test_recipient_email,'')));
    job_status := case when recipient <> '' and parent_folder is not null then 'pending' else 'blocked' end;
    reason := case when recipient = '' then 'Controlled test recipient is missing'
                   when parent_folder is null then 'E-sign destination folder is not configured' end;
  else
    select lower(trim(coalesce(email,''))) into recipient from projects where id=new.project_id;
    job_status := case when production_enabled and recipient <> '' and parent_folder is not null then 'pending' else 'blocked' end;
    reason := case when not production_enabled then 'Production automatic sending is disabled'
                   when recipient = '' then 'Homeowner email is missing'
                   when parent_folder is null then 'E-sign destination folder is not configured' end;
  end if;

  insert into box_sign_delivery_jobs(estimate_id,recipient_email,status,is_test,blocker)
  values(new.id,nullif(recipient,''),job_status,new.is_test,reason)
  on conflict (estimate_id) do update set recipient_email=excluded.recipient_email,
    status=excluded.status,is_test=excluded.is_test,blocker=excluded.blocker,updated_at=now();
  update estimates set delivery_provider='box_sign',delivery_status=
    case when job_status='pending' then 'box_sign_queued' else 'ready' end,updated_at=now()
  where id=new.id;
  return new;
end;
$$;

comment on function queue_box_sign_after_final_approval() is
  'Fires on estimates.status -> sent_for_signature. approved means the estimator/reviewer chain signed off internally; sent_for_signature means staff separately confirmed the homeowner reviewed the estimate and said yes to proceed. Only then is the e-sign outbox job queued.';

create or replace function queue_review_email_after_approval()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  proj_id uuid;
  pending_siblings int;
  ready_ids uuid[];
  recipient text;
  job_status text;
  reason text;
begin
  if new.status <> 'approved' or old.status = 'approved' then return new; end if;
  proj_id := new.project_id;

  select count(*) into pending_siblings
  from estimates
  where project_id = proj_id and id <> new.id and status in ('ai_draft','pending_review');
  if pending_siblings > 0 then return new; end if;

  select array_agg(e.id) into ready_ids
  from estimates e
  where e.project_id = proj_id
    and e.status = 'approved'
    and not exists (
      select 1 from estimate_review_email_jobs j
      where e.id = any(j.estimate_ids) and j.status in ('pending','processing','sent')
    );
  if ready_ids is null or array_length(ready_ids,1) = 0 then return new; end if;

  if new.is_test then
    recipient := lower(trim(coalesce(new.test_recipient_email,'')));
  else
    select lower(trim(coalesce(email,''))) into recipient from projects where id=proj_id;
  end if;
  job_status := case when recipient <> '' then 'pending' else 'blocked' end;
  reason := case when recipient = '' then 'Homeowner email is missing' end;

  insert into estimate_review_email_jobs(project_id, estimate_ids, recipient_email, status, is_test, blocker)
  values (proj_id, ready_ids, nullif(recipient,''), job_status, new.is_test, reason);
  return new;
end;
$$;

comment on function queue_review_email_after_approval() is
  'Queues the homeowner review-email draft once an estimate is approved AND no sibling program-track estimate for the same project is still ai_draft/pending_review -- combines every ready-and-not-yet-sent estimate for the project into one job. Not gated by production_auto_send_enabled -- it only ever creates a draft, never sends.';

create or replace function initialize_estimate_pricing_assumptions()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into estimate_pricing_assumptions(estimate_id,travel_percent)
  values(new.id,case when new.program_track='HEAR' then 3 else 1 end)
  on conflict(estimate_id) do nothing;
  return new;
end $$;

create or replace function apply_estimate_pricing_assumptions(p_estimate_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  estimate_status text;
  assumptions estimate_pricing_assumptions%rowtype;
  scope_row record;
  charge record;
  next_sort integer;
  charge_amount numeric(12,2);
  equipment_adjustment numeric(12,2);
begin
  if auth.role() <> 'service_role' and not is_ops_hub_user() then raise exception 'Ops Hub access required'; end if;
  select status into estimate_status from estimates where id = p_estimate_id for update;
  if estimate_status is null then raise exception 'Estimate not found'; end if;
  if estimate_status in ('approved','sent_for_signature','signed') then raise exception 'Create a revision before changing approved costs'; end if;

  select * into assumptions from estimate_pricing_assumptions where estimate_id = p_estimate_id;
  if not found or assumptions.county is null or assumptions.tax_rate is null then raise exception 'Save a verified county and tax rate first'; end if;

  delete from estimate_line_items where estimate_id = p_estimate_id and internal_notes = 'SYSTEM: calculated from workbook pricing assumptions';
  select coalesce(max(sort_order), 0) + 1 into next_sort from estimate_line_items where estimate_id = p_estimate_id;

  for scope_row in
    select scope.id,
      coalesce(sum(case when child.item_type='material' and coalesce(child.cost_category,'materials') <> 'equipment' then coalesce(child.materials_amount,0) else 0 end),0) material_base,
      coalesce(sum(case when child.item_type='labor' then coalesce(child.labor_amount,0) else 0 end),0) labor_base,
      coalesce(sum(case when child.cost_category='equipment' then coalesce(child.materials_amount,0)+coalesce(child.markup_amount,0)+coalesce(child.permit_amount,0)+coalesce(child.tax_amount,0) else 0 end),0) recorded_equipment
    from estimate_line_items scope
    left join estimate_line_items child on child.parent_line_item_id = scope.id
      and child.internal_notes is distinct from 'SYSTEM: calculated from workbook pricing assumptions'
    where scope.estimate_id = p_estimate_id and scope.item_type = 'scope' and coalesce(scope.internal_notes,'') not like 'AI candidate only%'
    group by scope.id, scope.sort_order
    order by scope.sort_order, scope.id
  loop
    equipment_adjustment := round(scope_row.labor_base * 0.10, 2) - scope_row.recorded_equipment;
    if equipment_adjustment <> 0 then
      insert into estimate_line_items(estimate_id,parent_line_item_id,item_type,scope_name,description,cost_category,markup_amount,rebate_eligible,internal_notes,ai_generated,sort_order)
      values(p_estimate_id,scope_row.id,'fee','Equipment / Minor Tools',format('10%% of direct labor ($%s)',to_char(scope_row.labor_base,'FM999999990.00')),'equipment',equipment_adjustment,false,'SYSTEM: calculated from workbook pricing assumptions',false,next_sort);
      next_sort := next_sort + 1;
    end if;

    for charge in
      select * from (values
        ('overhead'::text,'Overhead - Insurance Included'::text,assumptions.overhead_percent,scope_row.material_base+scope_row.labor_base+round(scope_row.labor_base*0.10,2)),
        ('profit','Profit',assumptions.profit_percent,scope_row.material_base+scope_row.labor_base+round(scope_row.labor_base*0.10,2)),
        ('contingency','Contingency',assumptions.contingency_percent,scope_row.material_base+scope_row.labor_base+round(scope_row.labor_base*0.10,2)),
        ('bonding','Bonding',assumptions.bonding_percent,scope_row.material_base+scope_row.labor_base+round(scope_row.labor_base*0.10,2)),
        ('mobilization','Mobilization',assumptions.mobilization_percent,scope_row.material_base+scope_row.labor_base+round(scope_row.labor_base*0.10,2)),
        ('travel','Travel / Lodging',assumptions.travel_percent,scope_row.material_base+scope_row.labor_base+round(scope_row.labor_base*0.10,2)),
        ('tax_delivery','County Sales Tax',assumptions.tax_rate,scope_row.material_base+round(scope_row.labor_base*0.10,2))
      ) as calculated(category,label,percentage,calculation_base)
    loop
      charge_amount := round(charge.calculation_base * charge.percentage / 100, 2);
      if charge_amount <> 0 then
        insert into estimate_line_items(estimate_id,parent_line_item_id,item_type,scope_name,description,cost_category,tax_amount,markup_amount,rebate_eligible,internal_notes,ai_generated,sort_order)
        values(p_estimate_id,scope_row.id,'fee',charge.label,format('%s%% of %s base ($%s)',charge.percentage,case when charge.category='tax_delivery' then 'material/equipment' else 'direct cost' end,to_char(charge.calculation_base,'FM999999990.00')),charge.category,case when charge.category='tax_delivery' then charge_amount else 0 end,case when charge.category='tax_delivery' then 0 else charge_amount end,true,'SYSTEM: calculated from workbook pricing assumptions',false,next_sort);
        next_sort := next_sort + 1;
      end if;
    end loop;
  end loop;
  return recalculate_estimate_total(p_estimate_id);
end;
$$;

create or replace function recalculate_esrp_rebate(p_estimate_id uuid)
returns numeric language plpgsql security definer set search_path=public as $$
declare e estimates%rowtype; tier text; coverage numeric:=0; calculated numeric:=0; project_total numeric:=0; scope record; scope_cost numeric; cap numeric; weatherization_cost numeric:=0;
begin
  select * into e from estimates where id=p_estimate_id; if not found then raise exception 'Estimate not found'; end if;
  select coalesce(ami_tier,'unknown') into tier from projects where id=e.project_id;
  coverage:=case tier when 'tier_1' then 1 when 'tier_2' then .5 else 0 end;
  perform recalculate_estimate_total(p_estimate_id); select coalesce(total_project_cost,0) into project_total from estimates where id=p_estimate_id;
  if coverage=0 then update estimates set rebate_amount=0,homeowner_out_of_pocket=project_total,rebate_calculation_notes='Blocked: AMI tier is unconfirmed.' where id=p_estimate_id; return 0; end if;
  if e.program_track='HOMES' then
    if tier='tier_2' and e.modeled_savings_percent is null then update estimates set rebate_amount=0,homeowner_out_of_pocket=project_total,rebate_calculation_notes='Blocked: modeled savings percentage is required for Tier 2 HOMES.' where id=p_estimate_id; return 0; end if;
    cap:=case when tier='tier_1' then 16000 when e.modeled_savings_percent>=35 then 4000 else 2000 end;
    calculated:=least(project_total*coverage,cap);
  else
    for scope in select s.id,s.scope_name from estimate_line_items s where s.estimate_id=p_estimate_id and s.item_type='scope' and s.rebate_eligible=true loop
      select coalesce(sum(case when l.item_type='material' then coalesce(l.quantity,0)*coalesce(l.unit_cost,0)*(1+coalesce(l.waste_factor_percent,0)/100) when l.item_type='labor' then coalesce(l.subcontractor_quote_amount,l.labor_amount,0) else coalesce(l.permit_amount,0)+coalesce(l.tax_amount,0)+coalesce(l.markup_amount,0) end),0) into scope_cost from estimate_line_items l where l.parent_line_item_id=scope.id and l.rebate_eligible=true;
      if lower(scope.scope_name)~'(air seal|insulat|ventilat)' then weatherization_cost:=weatherization_cost+scope_cost;
      else cap:=case when lower(scope.scope_name) like '%water heater%' then 1750 when lower(scope.scope_name) like '%heat pump dryer%' then 840 when lower(scope.scope_name)~'(cooking|range|stove)' then 840 when lower(scope.scope_name) like '%panel%' then 4000 when lower(scope.scope_name)~'(wiring|electrical)' then 2500 when lower(scope.scope_name)~'(heating|cooling|heat pump)' then 8000 else 0 end; calculated:=calculated+least(scope_cost*coverage,cap); end if;
    end loop;
    calculated:=least(calculated+least(weatherization_cost*coverage,1600),14000,project_total);
  end if;
  update estimates set rebate_amount=round(calculated,2),homeowner_out_of_pocket=greatest(project_total-round(calculated,2),0),rebate_calculation_notes=concat('Calculated from confirmed ',tier,' coverage and program caps; final program approval required.'),updated_at=now() where id=p_estimate_id;
  return round(calculated,2);
end $$;

comment on function recalculate_esrp_rebate(uuid) is 'Conservative ESRP cap calculator; never establishes income eligibility or program approval.';

create or replace function enable_estimate_review_simulation(
  p_estimate_id uuid,
  p_test_recipient_email text
)
returns void language plpgsql security definer set search_path = public as $$
declare actor uuid; actor_email text; estimate_status text;
begin
  if auth.role() <> 'service_role' and not is_ops_hub_user() then
    raise exception 'Ops Hub access required';
  end if;
  select id,email into actor,actor_email from staff
  where active and email ilike coalesce(auth.jwt() ->> 'email','') order by created_at limit 1;
  if actor is null then raise exception 'Your authenticated account is not linked to active staff'; end if;
  if lower(trim(coalesce(p_test_recipient_email,''))) <> lower(trim(coalesce(actor_email,''))) then
    raise exception 'The test recipient must be your authenticated staff email';
  end if;
  select status into estimate_status from estimates where id=p_estimate_id for update;
  if estimate_status is null then raise exception 'Estimate not found'; end if;
  if estimate_status <> 'ai_draft' then
    raise exception 'Enable simulation before submitting the estimate for review';
  end if;

  perform set_config('app.test_mode_authorized','true',true);
  update estimates set is_test=true,test_operator_staff_id=actor,
    test_recipient_email=lower(trim(p_test_recipient_email)),updated_at=now()
  where id=p_estimate_id;
end;
$$;

create or replace function protect_estimate_test_controls()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_test is distinct from old.is_test
    or new.test_operator_staff_id is distinct from old.test_operator_staff_id
    or new.test_recipient_email is distinct from old.test_recipient_email then
    if auth.role() <> 'service_role'
      and coalesce(current_setting('app.test_mode_authorized',true),'') <> 'true' then
      raise exception 'Test controls can only be changed through the controlled test-mode function';
    end if;
  end if;
  return new;
end;
$$;

create or replace function bridge_estimate_source_doc_to_compliance()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_project_id uuid;
  v_doc_code text;
begin
  v_doc_code := case new.document_type
    when 'audit_report' then 'audit_report'
    when 'manual_j' then 'manual_j'
    when 'manual_s' then 'manual_j'
    else null
  end;
  if v_doc_code is null then
    return new;
  end if;

  select wi.project_id into v_project_id
  from estimate_work_items wi
  where wi.id = new.work_item_id;

  if v_project_id is null then
    return new;
  end if;

  insert into project_compliance_documents
    (project_id, doc_type_code, status, file_url, notes, uploaded_at, auto_detected)
  values
    (v_project_id, v_doc_code, 'pending_review',
     'https://docs.example-storage.com/file/' || new.box_file_id,
     'Auto-detected from document intake (' || coalesce(new.box_path, new.file_name) || ') on ' || to_char(now(), 'YYYY-MM-DD'),
     now(), true)
  on conflict (project_id, doc_type_code) do update set
     file_url = excluded.file_url,
     notes = excluded.notes,
     uploaded_at = now(),
     auto_detected = true,
     status = case
       when project_compliance_documents.file_url is distinct from excluded.file_url
            and project_compliance_documents.status in ('uploaded', 'rejected')
         then 'pending_review'
       when project_compliance_documents.status = 'missing'
         then 'pending_review'
       else project_compliance_documents.status
     end;

  return new;
end;
$$;

create or replace function guard_estimate_number_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare change_reason text;
begin
  if new.estimate_number is not distinct from old.estimate_number then return new; end if;
  if old.status not in ('ai_draft','pending_review','rejected') then raise exception 'Approved and signed estimate numbers are locked'; end if;
  change_reason:=nullif(trim(current_setting('app.estimate_number_change_reason',true)),'');
  if change_reason is null then raise exception 'Use the migration number editor and provide a reason'; end if;
  if new.estimate_number !~ '^[A-Za-z0-9][A-Za-z0-9 ./_-]{0,79}$' then raise exception 'Use 1-80 letters, numbers, spaces, periods, slashes, underscores or hyphens'; end if;
  insert into estimate_number_history(estimate_id,previous_number,new_number,reason,changed_by)
    values(old.id,old.estimate_number,new.estimate_number,change_reason,auth.uid());
  return new;
end $$;

create or replace function rename_estimate_for_migration(p_estimate_id uuid,p_estimate_number text,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare e estimates%rowtype;
begin
  if auth.role() is distinct from 'service_role' and not coalesce(is_ops_hub_user(),false) then raise exception 'Ops Hub access required'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'Migration reason is required'; end if;
  if nullif(trim(p_estimate_number),'') is null then raise exception 'Estimate number is required'; end if;
  select * into e from estimates where id=p_estimate_id for update;
  if not found then raise exception 'Estimate not found'; end if;
  perform set_config('app.estimate_number_change_reason',trim(p_reason),true);
  update estimates set estimate_number=trim(p_estimate_number),updated_at=now() where id=p_estimate_id;
  perform set_config('app.estimate_number_change_reason','',true);
end $$;
revoke all on function rename_estimate_for_migration(uuid,text,text) from public;

create or replace function set_portal_presence_from_evidence()
returns trigger language plpgsql as $$
begin
  if new.portal_application_id is not null or new.portal_status_code is not null then
    new.portal_presence_status := 'yes';
  end if;
  return new;
end;
$$;

create or replace function normalize_estimate_labor_line()
returns trigger language plpgsql set search_path = public as $$
declare total_hours numeric; agreed_total numeric;
begin
  if new.item_type <> 'labor' then return new; end if;

  total_hours := nullif(new.labor_hours,0);
  if total_hours is null and coalesce(new.labor_days,0) > 0
    and coalesce(new.labor_hours_per_day,0) > 0 and coalesce(new.crew_size,0) > 0 then
    total_hours := new.labor_days * new.labor_hours_per_day * new.crew_size;
    new.labor_hours := total_hours;
  end if;

  agreed_total := nullif(new.subcontractor_quote_amount,0);
  if agreed_total is null then
    agreed_total := case new.labor_pricing_method
      when 'daily' then coalesce(new.labor_rate,0) * coalesce(new.labor_days,0)
      when 'hourly' then coalesce(new.labor_rate,0) * coalesce(total_hours,0)
      when 'fixed' then coalesce(new.labor_rate,0)
      else 0 end;
    new.subcontractor_quote_amount := nullif(agreed_total,0);
  end if;

  if new.program_hourly_rate is null and coalesce(total_hours,0) > 0 and coalesce(agreed_total,0) > 0 then
    new.program_hourly_rate := round(agreed_total / total_hours,4);
  end if;
  new.labor_reconciliation_difference := round(
    coalesce(new.program_hourly_rate,0) * coalesce(total_hours,0) - coalesce(agreed_total,0),2
  );
  -- The commercial and hourly figures are two representations of one cost.
  new.labor_amount := agreed_total;
  return new;
end;
$$;

create or replace function normalize_estimate_area_line()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.item_type='material' and coalesce(new.measured_area,0)>0 and coalesce(new.coverage_per_unit,0)>0 then
    new.area_unit:=coalesce(nullif(trim(new.area_unit),''),'sq ft');
    new.calculated_quantity:=ceil((new.measured_area/new.coverage_per_unit)*(1+coalesce(new.area_allowance_percent,0)/100));
    new.quantity:=new.calculated_quantity;
    new.waste_factor_percent:=0;
    new.materials_amount:=round(new.calculated_quantity*coalesce(new.unit_cost,0),2);
  elsif new.item_type='material' then
    new.calculated_quantity:=null;
  end if;
  if new.item_type='labor' and new.labor_pricing_method='area' then
    if coalesce(new.measured_area,0)<=0 or coalesce(new.labor_rate,0)<=0 then
      raise exception 'Area-priced labor requires positive measured area and unit rate';
    end if;
    new.area_unit:=coalesce(nullif(trim(new.area_unit),''),'sq ft');
    new.subcontractor_quote_amount:=round(new.measured_area*new.labor_rate,2);
    new.labor_amount:=new.subcontractor_quote_amount;
  end if;
  return new;
end $$;

create or replace function protect_final_estimate_line_items()
returns trigger language plpgsql security definer set search_path = public as $$
declare current_status text;
begin
  select status into current_status from estimates where id = coalesce(new.estimate_id, old.estimate_id);
  if current_status in ('approved','sent_for_signature','signed') then
    raise exception 'Approved or signed estimate versions are immutable; create a revision instead';
  end if;
  if tg_op <> 'DELETE' then new.updated_at := now(); end if;
  return coalesce(new, old);
end;
$$;

create or replace function audit_estimate_line_item_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare actor uuid;
begin
  -- A project-level delete cascades through estimates and line items. At that
  -- point the parent estimate is already being removed, so creating a fresh
  -- history row would immediately violate its estimate FK. Normal standalone
  -- line-item deletes still reach the audit insert below.
  if tg_op = 'DELETE' and not exists (
    select 1 from public.estimates where id = old.estimate_id
  ) then
    return old;
  end if;

  select id into actor
  from public.staff
  where active
    and email ilike coalesce(auth.jwt() ->> 'email','')
  order by created_at
  limit 1;

  insert into public.estimate_line_item_history(
    estimate_id, line_item_id, changed_by_staff_id, old_row, new_row
  )
  values(
    coalesce(new.estimate_id, old.estimate_id),
    coalesce(new.id, old.id),
    actor,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );

  return coalesce(new, old);
end;
$$;

create or replace function refresh_estimate_package_after_line_write()
returns trigger language plpgsql security definer set search_path=public as $$
declare eid uuid;
begin
  eid:=coalesce(new.estimate_id,old.estimate_id);
  perform recalculate_estimate_total(eid);
  perform recompute_estimate_validation(eid);
  return coalesce(new,old);
end $$;

create or replace function auto_create_ready_estimate_package()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.readiness_status='ready_for_draft' and new.latest_estimate_id is null then perform create_ai_estimate_draft(new.id); end if;
  return new;
end $$;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

drop trigger if exists estimate_source_document_readiness on estimate_source_documents;
create trigger estimate_source_document_readiness
after insert or update or delete on estimate_source_documents
for each row execute function estimate_source_document_readiness_trigger();

drop trigger if exists trg_estimate_source_doc_to_compliance on estimate_source_documents;
create trigger trg_estimate_source_doc_to_compliance
after insert on estimate_source_documents
for each row execute function bridge_estimate_source_doc_to_compliance();

drop trigger if exists initialize_estimate_approvals_on_review on estimates;
create trigger initialize_estimate_approvals_on_review
after insert or update of status on estimates
for each row execute function initialize_estimate_approvals();

drop trigger if exists enforce_estimate_approval_transition_before_update on estimate_approval_steps;
create trigger enforce_estimate_approval_transition_before_update
before update on estimate_approval_steps for each row execute function enforce_estimate_approval_transition();

drop trigger if exists guard_estimate_review_roles_trigger on estimate_approval_steps;
create trigger guard_estimate_review_roles_trigger
before update on estimate_approval_steps for each row execute function guard_estimate_review_roles();

drop trigger if exists advance_estimate_approval_chain_after_update on estimate_approval_steps;
create trigger advance_estimate_approval_chain_after_update
after update on estimate_approval_steps for each row execute function advance_estimate_approval_chain();

drop trigger if exists protect_estimate_test_controls_before_update on estimates;
create trigger protect_estimate_test_controls_before_update
before update on estimates for each row execute function protect_estimate_test_controls();

drop trigger if exists guard_estimate_number_change_trigger on estimates;
create trigger guard_estimate_number_change_trigger
before update of estimate_number on estimates for each row execute function guard_estimate_number_change();

drop trigger if exists queue_box_sign_after_final_approval_trigger on estimates;
create trigger queue_box_sign_after_final_approval_trigger
after update of status on estimates for each row execute function queue_box_sign_after_final_approval();

drop trigger if exists queue_review_email_after_approval_trigger on estimates;
create trigger queue_review_email_after_approval_trigger
after update of status on estimates for each row execute function queue_review_email_after_approval();

drop trigger if exists initialize_estimate_pricing_assumptions_after_insert on estimates;
create trigger initialize_estimate_pricing_assumptions_after_insert
after insert on estimates for each row execute function initialize_estimate_pricing_assumptions();

drop trigger if exists normalize_estimate_labor_before_write on estimate_line_items;
create trigger normalize_estimate_labor_before_write
before insert or update on estimate_line_items for each row execute function normalize_estimate_labor_line();

drop trigger if exists normalize_estimate_area_before_write on estimate_line_items;
create trigger normalize_estimate_area_before_write
before insert or update on estimate_line_items for each row execute function normalize_estimate_area_line();

drop trigger if exists validate_sero_scope_evidence_trigger on estimate_line_items;
create trigger validate_sero_scope_evidence_trigger
before insert or update on estimate_line_items for each row execute function validate_sero_scope_evidence();

drop trigger if exists protect_final_estimate_line_items_before_write on estimate_line_items;
create trigger protect_final_estimate_line_items_before_write
before insert or update or delete on estimate_line_items for each row execute function protect_final_estimate_line_items();

drop trigger if exists audit_estimate_line_item_after_write on estimate_line_items;
create trigger audit_estimate_line_item_after_write
after insert or update or delete on estimate_line_items for each row execute function audit_estimate_line_item_change();

drop trigger if exists refresh_estimate_package_after_line_write_trigger on estimate_line_items;
create trigger refresh_estimate_package_after_line_write_trigger
after insert or update or delete on estimate_line_items for each row execute function refresh_estimate_package_after_line_write();

drop trigger if exists hydrate_structured_estimate_candidates_after_draft on estimate_work_items;
create trigger hydrate_structured_estimate_candidates_after_draft
after update of latest_estimate_id on estimate_work_items for each row execute function hydrate_structured_estimate_candidates();

drop trigger if exists auto_create_ready_estimate_package_trigger on estimate_work_items;
create trigger auto_create_ready_estimate_package_trigger
after insert or update of readiness_status on estimate_work_items
for each row when (new.readiness_status='ready_for_draft') execute function auto_create_ready_estimate_package();

drop trigger if exists set_portal_presence_from_evidence_trigger on project_applications;
create trigger set_portal_presence_from_evidence_trigger
before insert or update of portal_application_id, portal_status_code on project_applications
for each row execute function set_portal_presence_from_evidence();

drop trigger if exists bridge_portal_return_before_update on project_applications;
create trigger bridge_portal_return_before_update
before update of portal_status_code on project_applications
for each row execute function bridge_portal_return_to_estimate();

-- ============================================================================
-- ROW LEVEL SECURITY + GRANTS
-- ============================================================================
grant usage on schema public to authenticated, service_role;

-- Reference tables: readable by any authenticated session.
alter table pipeline_stages enable row level security;
alter table portal_statuses enable row level security;
alter table fieldwire_labels enable row level security;
alter table compliance_doc_types enable row level security;

create policy "authenticated read pipeline_stages" on pipeline_stages for select to authenticated using (true);
create policy "authenticated read portal_statuses" on portal_statuses for select to authenticated using (true);
create policy "authenticated read fieldwire_labels" on fieldwire_labels for select to authenticated using (true);
create policy "authenticated read compliance_doc_types" on compliance_doc_types for select to authenticated using (true);

grant select on pipeline_stages, portal_statuses, fieldwire_labels, compliance_doc_types to authenticated;
grant all on pipeline_stages, portal_statuses, fieldwire_labels, compliance_doc_types to service_role;

-- Staff: readable by any authenticated session; self-service insert/update
-- restricted to the caller's own JWT email (mirrors self-signup provisioning).
alter table staff enable row level security;
create policy "authenticated read staff" on staff for select to authenticated using (true);
create policy "self insert staff" on staff for insert to authenticated
  with check (lower(email) = lower(coalesce(auth.jwt() ->> 'email','')));
create policy "self update own staff row" on staff for update to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email','')))
  with check (lower(email) = lower(coalesce(auth.jwt() ->> 'email','')));
grant select, insert, update on staff to authenticated;
grant all on staff to service_role;

-- Core Ops Hub tables
alter table projects enable row level security;
alter table project_applications enable row level security;
alter table qualification_screenings enable row level security;
alter table project_compliance_documents enable row level security;
alter table portal_status_events enable row level security;
alter table automation_events enable row level security;
alter table mailbox_triage_events enable row level security;

create policy "Ops Hub staff manage projects" on projects for all to authenticated using (is_ops_hub_user()) with check (is_ops_hub_user());
create policy "Ops Hub staff manage project applications" on project_applications for all to authenticated using (is_ops_hub_user()) with check (is_ops_hub_user());
create policy "Ops Hub staff manage qualification screenings" on qualification_screenings for all to authenticated using (is_ops_hub_user()) with check (is_ops_hub_user());
create policy "Ops Hub staff manage compliance documents" on project_compliance_documents for all to authenticated using (is_ops_hub_user()) with check (is_ops_hub_user());
create policy "Ops Hub staff manage portal status events" on portal_status_events for all to authenticated using (is_ops_hub_user()) with check (is_ops_hub_user());
create policy "Ops Hub staff manage automation events" on automation_events for all to authenticated using (is_ops_hub_user()) with check (is_ops_hub_user());
create policy "Ops Hub staff manage mailbox triage events" on mailbox_triage_events for all to authenticated using (is_ops_hub_user()) with check (is_ops_hub_user());

grant select, insert, update, delete on projects, project_applications, qualification_screenings, project_compliance_documents, portal_status_events, automation_events, mailbox_triage_events to authenticated;
grant all on projects, project_applications, qualification_screenings, project_compliance_documents, portal_status_events, automation_events, mailbox_triage_events to service_role;

-- Estimating tables
alter table estimates enable row level security;
alter table estimate_line_items enable row level security;
alter table estimate_work_items enable row level security;
alter table estimate_source_documents enable row level security;
alter table estimate_approval_steps enable row level security;
alter table estimate_program_returns enable row level security;
alter table estimate_line_item_history enable row level security;
alter table estimate_number_history enable row level security;
alter table estimate_pricing_assumptions enable row level security;
alter table estimate_price_book_items enable row level security;
alter table county_pricing_rules enable row level security;
alter table estimate_delivery_settings enable row level security;
alter table box_sign_delivery_jobs enable row level security;
alter table estimate_review_email_jobs enable row level security;

create policy "Ops Hub staff manage estimates" on estimates for all to authenticated using (is_ops_hub_user()) with check (is_ops_hub_user());
create policy "Ops Hub staff manage estimate line items" on estimate_line_items for all to authenticated using (is_ops_hub_user()) with check (is_ops_hub_user());
create policy "Ops Hub staff manage estimate work items" on estimate_work_items for all to authenticated using (is_ops_hub_user()) with check (is_ops_hub_user());
create policy "Ops Hub staff manage estimate source documents" on estimate_source_documents for all to authenticated using (is_ops_hub_user()) with check (is_ops_hub_user());
create policy "Ops Hub staff manage estimate approvals" on estimate_approval_steps for all to authenticated using (is_ops_hub_user()) with check (is_ops_hub_user());
create policy "Ops Hub staff manage estimate returns" on estimate_program_returns for all to authenticated using (is_ops_hub_user()) with check (is_ops_hub_user());
create policy "Ops Hub staff view estimate edit history" on estimate_line_item_history for select to authenticated using (is_ops_hub_user());
create policy "Ops Hub staff view estimate number history" on estimate_number_history for select to authenticated using (is_ops_hub_user());
create policy "Ops Hub staff manage estimate assumptions" on estimate_pricing_assumptions for all to authenticated using (is_ops_hub_user()) with check (is_ops_hub_user());
create policy "Ops Hub staff manage price book" on estimate_price_book_items for all to authenticated using (is_ops_hub_user()) with check (is_ops_hub_user());
create policy "Ops Hub staff view county pricing" on county_pricing_rules for select to authenticated using (is_ops_hub_user());
create policy "Ops Hub staff view estimate delivery settings" on estimate_delivery_settings for select to authenticated using (is_ops_hub_user());
create policy "Ops Hub staff view Box Sign delivery jobs" on box_sign_delivery_jobs for select to authenticated using (is_ops_hub_user());
create policy "Ops Hub staff view review email jobs" on estimate_review_email_jobs for select to authenticated using (is_ops_hub_user());

grant select, insert, update, delete on estimates, estimate_line_items, estimate_work_items, estimate_source_documents, estimate_approval_steps, estimate_program_returns to authenticated;
grant select on estimate_line_item_history, estimate_number_history, county_pricing_rules, estimate_delivery_settings, box_sign_delivery_jobs, estimate_review_email_jobs to authenticated;
grant select, insert, update on estimate_pricing_assumptions, estimate_price_book_items to authenticated;
grant all on estimates, estimate_line_items, estimate_work_items, estimate_source_documents, estimate_approval_steps, estimate_program_returns, estimate_line_item_history, estimate_number_history, estimate_pricing_assumptions, estimate_price_book_items, county_pricing_rules, estimate_delivery_settings, box_sign_delivery_jobs, estimate_review_email_jobs to service_role;

grant execute on function is_ops_hub_user() to authenticated, service_role, anon;
grant execute on function recompute_estimate_readiness(uuid) to authenticated, service_role;
grant execute on function enable_estimate_review_simulation(uuid,text) to authenticated, service_role;
grant execute on function promote_estimate_to_review(uuid) to authenticated, service_role;
grant execute on function record_estimate_program_return(uuid,text,jsonb,uuid,timestamptz) to authenticated, service_role;
grant execute on function start_estimate_return_revision(uuid) to authenticated, service_role;
grant execute on function create_estimate_revision(uuid,text) to authenticated, service_role;
grant execute on function record_estimate_release_artifact(uuid,text,text,text) to authenticated, service_role;
grant execute on function mark_estimate_homeowner_sent(uuid,text) to authenticated, service_role;
grant execute on function mark_estimate_signed_for_portal(uuid) to authenticated, service_role;
grant execute on function mark_estimate_portal_uploaded(uuid) to authenticated, service_role;
grant execute on function create_ai_estimate_draft(uuid) to authenticated, service_role;
grant execute on function recompute_estimate_validation(uuid) to authenticated, service_role;
grant execute on function activate_marcus_final_fallback(uuid,text) to authenticated, service_role;
grant execute on function recalculate_esrp_rebate(uuid) to authenticated, service_role;
grant execute on function rename_estimate_for_migration(uuid,text,text) to authenticated, service_role;
grant execute on function apply_estimate_pricing_assumptions(uuid) to authenticated, service_role;

-- ============================================================================
-- SERVICE ROLE CATCH-ALL
-- ============================================================================
-- Supabase's own service_role key must always retain full access underneath
-- RLS (RLS restricts anon/authenticated; service_role bypasses it entirely).
-- This also sets default privileges so any future table created by a
-- follow-up migration inherits service_role access automatically.
grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant all privileges on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;
