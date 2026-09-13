-- ============================================================================
-- Stonebridge Ops Hub -- Demo Seed Data
-- ============================================================================
-- Entirely fictional. Company: Stonebridge Home Energy Solutions, running the
-- Energy Saver Rebate Program (ESRP). Office: 4820 Meridian Park Dr, Suite
-- 210, Richmond, VA 23230. Run this AFTER demo-schema.sql on a fresh database.
-- ============================================================================

-- ============================================================================
-- REFERENCE DATA
-- ============================================================================

insert into pipeline_stages (code, label, stage_group, sort_order, source, needs_validation, is_critical_alert, notes) values
('new_pre_qualified',           'New Pre-Qualified',                'lead_intake',      10,  'seed', false, false, null),
('contacted',                   'Contacted',                        'lead_intake',      20,  'seed', false, false, null),
('out_of_service_area_on_hold', 'Out of Service Area - On Hold',    'lead_intake',      30,  'seed', false, false, null),
('lead_intake_form_sent',       'Lead Intake Form Sent',            'lead_intake',      40,  'seed', false, false, null),
('lead_intake_form_received',   'Lead Intake Form Received',        'lead_intake',      50,  'seed', false, false, null),
('pre_qualification_pending',   'Pre-Qualification Pending',        'lead_intake',      60,  'seed', false, false, null),
('pending_site_visit_sched',    'Pending Site Visit Scheduling',    'site_visit',       70,  'seed', false, false, null),
('site_visit_scheduled',        'Site Visit Scheduled',             'site_visit',       80,  'seed', false, false, null),
('on_hold_pre_weatherization',  'On Hold - Pre-Weatherization',     'site_visit',       100, 'seed', false, true,  'No work proceeds over an unresolved health/safety defect.'),
('estimating',                  'Estimating',                       'estimating',       110, 'seed', false, false, null),
('estimate_pending_approval',   'Estimate Pending Approval',        'estimating',       120, 'seed', false, false, null),
('estimate_pending_revision',   'Estimate Pending Revision',        'submission',       185, 'seed', false, true,  null),
('estimate_pending_signature',  'Estimate Pending Signature',       'estimating',       140, 'seed', false, false, null),
('pending_portal_submission',   'Pending Portal Submission',        'submission',       150, 'seed', false, false, null),
('unsigned_estimate_submitted', 'Unsigned Estimate Submitted',      'submission',       160, 'seed', false, false, null),
('signed_estimate_submitted',   'Signed Estimate Submitted',        'submission',       170, 'seed', false, false, null),
('returned',                    'Returned',                         'submission',       180, 'seed', false, true,  'An idle Returned reservation risks cancellation -- prioritize.'),
('permit_application',          'Permit Application',               'pre_construction', 190, 'seed', false, false, null),
('sub_sourcing',                'Sub Sourcing',                     'pre_construction', 200, 'seed', false, false, null),
('work_order_sent',             'Work Order Sent',                  'pre_construction', 240, 'seed', false, false, null),
('active_installation',         'Active Installation',              'construction',     270, 'seed', false, false, null),
('install_check',               'Install Check',                    'construction',     280, 'seed', false, false, null),
('closeout_upload',             'Closeout Upload',                  'closeout',         300, 'seed', false, false, null),
('awaiting_customer_attestation','Awaiting Customer Attestation',   'closeout',         310, 'seed', false, false, null),
('state_payout_customer_balance_collection','State Payout & Customer Balance Collection','closeout', 330, 'seed', false, false, null),
('completed',                   'Completed',                        'terminal',         900, 'seed', false, false, null),
('declined',                    'Declined',                         'terminal',         910, 'seed', false, false, null),
('cancelled',                   'Cancelled',                        'terminal',         920, 'seed', false, false, null),
('outside_service_area',        'Outside Service Area',             'terminal',         930, 'seed', false, false, null);

insert into portal_statuses (code, label, category, meaning, recommended_action, needs_validation) values
('pre_qual_pending_submission', 'Pre-Qualification Pending Submission', 'pre_qualification', 'Homeowner has not finished applying', 'Log as pending; do not schedule a site visit yet', false),
('pre_qual_review_in_progress', 'Pre-Qualification Review - In Progress', 'pre_qualification', 'Program reviewing eligibility', 'Wait', false),
('app_pending_submission',      'Project Application - Pending Submission', 'application', 'Homeowner approved and selected us; application not yet submitted', 'Move to qualification + site visit flow', false),
('app_under_review',            'Project Application - Review', 'application', 'Reservation package submitted, program reviewing', 'Monitor daily', false),
('app_returned',                'Project Application - Returned', 'application', 'Corrections required', 'Fix and resubmit immediately', false),
('app_approved',                'Project Approved - Rebate Reserved', 'reservation', 'Official notice to proceed', 'Send sub work order; mobilize. No work before this status.', false),
('post_review_in_progress',     'Post Project Review - In Progress', 'closeout', 'Program QC reviewing closeout and invoice', 'Monitor', false),
('project_completed',           'Project Completed', 'closeout', 'Rebate application approved, ready for payment', null, false),
('rebate_paid',                 'Rebate Paid', 'payment', 'Payment issued to Stonebridge', 'Reconcile and collect customer cost share, then close project', false),
('cancelled',                   'Cancelled', 'terminal', null, null, false);

insert into compliance_doc_types (code, label, lifecycle_stage, applies_to_track, required, condition_note, source_citation) values
('audit_report',              'Energy Audit Report (HOMES energy assessment)', 'pre_qualification', 'HOMES', true, 'Site visits/quoting prohibited until this is on file', 'Program Stage 1'),
('homeowner_intake_form',     'Homeowner Intake Form (HEAR limited assessment)', 'pre_qualification', 'HEAR', true, null, 'Internal SOP'),
('manual_j',                  'ACCA Manual J Load Calculation', 'pre_reservation', 'conditional', true, 'Required for every heating/cooling scope', 'Program Stage 1'),
('signed_estimate',           'Customer-Signed Estimate / SOW', 'pre_reservation', 'both', true, 'Must bear customer signature before submission', 'Program Stage 1'),
('energy_star_verification',  'ENERGY STAR Certification Verification (model-level)', 'pre_reservation', 'both', true, null, 'Internal SOP'),
('pre_install_qit_photos',    'Pre-Installation Photos (geotagged)', 'pre_install', 'both', true, 'Must be taken before old equipment is removed', 'Program Stage 2'),
('post_install_qit_photos',   'Post-Install Photos (equipment nameplates, closeout work)', 'post_install', 'both', true, null, 'Internal SOP'),
('permits_closed',            'Closed Permits', 'closeout', 'both', true, 'If applicable to scope', 'Internal SOP'),
('customer_portal_attestation','Customer Portal Attestation (homeowner-signed)', 'closeout', 'both', true, 'QC review and payment cannot start without this', 'Internal SOP'),
('final_signed_invoice',      'Final Paid Invoice (signed by homeowner and RC)', 'closeout', 'both', true, null, 'Program Stage 3');

-- ============================================================================
-- STAFF
-- ============================================================================
insert into staff (full_name, email, role, initials, access_level, active) values
('Christina Medrano', 'christina@stonebridgehomeenergy.com', 'Estimator', 'CM', 'staff', true),
('Devon Park',         'devon@stonebridgehomeenergy.com',     'Intake Coordinator', 'DP', 'staff', true),
('Renee Ibarra',       'renee@stonebridgehomeenergy.com',     'Compliance Analyst', 'RI', 'staff', true),
('Marcus Webb',        'marcus@stonebridgehomeenergy.com',    'Pricing Lead', 'MW', 'staff', true),
('Jordan Ellis',       'jordan@stonebridgehomeenergy.com',    'Founder', 'JE', 'leadership', true);

-- ============================================================================
-- PROJECTS (fictional homeowners / properties)
-- ============================================================================
insert into projects (
  id, display_id, homeowner_name, phone, email, address_line1, address_line2,
  county, distance_miles_from_office, ami_tier, lead_source, qualification_result,
  service_area_check, audit_report_on_file, audit_report_date,
  assigned_owner_id, notes
) values
('11111111-1111-4111-8111-111111111101', 'CAS-2026-001', 'Robert & Linda Whitfield', '(804) 555-0142', 'whitfield.family@example.com',
  '128 Larkspur Hollow Ln', 'Richmond, VA 23225', 'Richmond City', 6.4, 'tier_1', 'website_form', 'qualified',
  'in_area', true, '2026-07-18',
  (select id from staff where email='christina@stonebridgehomeenergy.com'),
  'HOMES weatherization + HVAC changeout. Full estimate package approved.'),

('22222222-2222-4222-8222-222222222202', 'CAS-2026-002', 'Maria Alvarez', '(804) 555-0187', 'maria.alvarez@example.com',
  '4417 Chesterfield Meadow Dr', 'Richmond, VA 23234', 'Chesterfield', 9.1, 'tier_2', 'referral', 'qualified',
  'in_area', true, '2026-08-02',
  (select id from staff where email='devon@stonebridgehomeenergy.com'),
  'HEAR heat pump water heater replacement. Estimate in review.'),

('33333333-3333-4333-8333-333333333303', 'CAS-2026-003', 'Thanh & Kim Nguyen', '(804) 555-0163', 'nguyen.household@example.com',
  '902 Bellwood Terrace', 'Henrico, VA 23228', 'Henrico', 5.0, 'tier_2', 'direct_call', 'qualified',
  'in_area', true, '2026-08-20',
  (select id from staff where email='christina@stonebridgehomeenergy.com'),
  'HOMES insulation and air sealing. Draft estimate in progress.'),

('44444444-4444-4444-8444-444444444404', 'CAS-2026-004', 'Ngozi Okafor', '(804) 555-0119', 'ngozi.okafor@example.com',
  '76 Windmill Point Rd', 'Chesterfield, VA 23832', 'Chesterfield', 14.2, 'unknown', 'portal', 'qualified',
  'in_area', true, '2026-08-27',
  (select id from staff where email='devon@stonebridgehomeenergy.com'),
  'HEAR electrical panel upgrade. Awaiting site visit scheduling.'),

('55555555-5555-4555-8555-555555555505', 'CAS-2026-005', 'Sarah Bennett', '(804) 555-0175', 'sarah.bennett@example.com',
  '215 Foxcroft Lane', 'Richmond, VA 23231', 'Richmond City', 7.8, 'tier_1', 'direct_email', 'qualified',
  'in_area', false, null,
  (select id from staff where email='devon@stonebridgehomeenergy.com'),
  'HOMES furnace replacement. Site visit scheduled.'),

('66666666-6666-4666-8666-666666666606', 'CAS-2026-006', 'James & Patricia Sullivan', '(804) 555-0198', 'sullivan.residence@example.com',
  '63 Briarwood Crossing', 'Henrico, VA 23223', 'Henrico', 11.5, 'tier_2', 'website_form', 'pending',
  'in_area', false, null,
  (select id from staff where email='renee@stonebridgehomeenergy.com'),
  'Dual HOMES + HEAR applicant. Early pipeline, pre-qualification review.');

-- ============================================================================
-- PROJECT APPLICATIONS (per-program status)
-- ============================================================================
insert into project_applications (project_id, program_track, internal_status_code, portal_status_code, tracker_id, portal_presence_status) values
('11111111-1111-4111-8111-111111111101', 'HOMES', 'pending_portal_submission', 'app_under_review', 'ESRP-2026-0001', 'yes'),
('22222222-2222-4222-8222-222222222202', 'HEAR',  'estimate_pending_approval', 'app_pending_submission', 'ESRP-2026-0002', 'yes'),
('33333333-3333-4333-8333-333333333303', 'HOMES', 'estimating', null, 'ESRP-2026-0003', 'unknown'),
('44444444-4444-4444-8444-444444444404', 'HEAR',  'pending_site_visit_sched', 'pre_qual_review_in_progress', 'ESRP-2026-0004', 'yes'),
('55555555-5555-4555-8555-555555555505', 'HOMES', 'site_visit_scheduled', null, 'ESRP-2026-0005', 'unknown'),
('66666666-6666-4666-8666-666666666606', 'HOMES', 'pre_qualification_pending', 'pre_qual_pending_submission', 'ESRP-2026-0006', 'yes'),
('66666666-6666-4666-8666-666666666606', 'HEAR',  'new_pre_qualified', null, 'ESRP-2026-0007', 'unknown');

-- ============================================================================
-- QUALIFICATION SCREENINGS
-- ============================================================================
insert into qualification_screenings (project_id, step, result, evaluated_by, evaluated_by_staff_id, notes) values
('11111111-1111-4111-8111-111111111101', '1_audit_report',      'pass', 'human', (select id from staff where email='devon@stonebridgehomeenergy.com'), 'Audit report on file, reviewed.'),
('11111111-1111-4111-8111-111111111101', '2_service_radius',    'pass', 'system', null, '6.4 miles from office, within service radius.'),
('22222222-2222-4222-8222-222222222202', '1_audit_report',      'pass', 'human', (select id from staff where email='devon@stonebridgehomeenergy.com'), null),
('22222222-2222-4222-8222-222222222202', '2_service_radius',    'pass', 'system', null, '9.1 miles from office.'),
('44444444-4444-4444-8444-444444444404', '2_service_radius',    'pass', 'system', null, '14.2 miles from office, within extended radius.'),
('66666666-6666-4666-8666-666666666606', '1_audit_report',      'needs_human_review', 'human', (select id from staff where email='renee@stonebridgehomeenergy.com'), 'Awaiting audit report upload.');

-- ============================================================================
-- PROJECT COMPLIANCE DOCUMENTS
-- ============================================================================
insert into project_compliance_documents (project_id, doc_type_code, status, file_url, uploaded_at, uploaded_by_staff_id, notes) values
('11111111-1111-4111-8111-111111111101', 'signed_estimate',          'pending_review', 'https://docs.example-storage.com/file/est-whitfield-001', now() - interval '2 days', (select id from staff where email='christina@stonebridgehomeenergy.com'), 'Awaiting homeowner signature.'),
('11111111-1111-4111-8111-111111111101', 'energy_star_verification', 'uploaded', 'https://docs.example-storage.com/file/es-verify-whitfield', now() - interval '5 days', (select id from staff where email='renee@stonebridgehomeenergy.com'), null),
('22222222-2222-4222-8222-222222222202', 'homeowner_intake_form',    'uploaded', 'https://docs.example-storage.com/file/intake-alvarez', now() - interval '10 days', (select id from staff where email='devon@stonebridgehomeenergy.com'), null),
('22222222-2222-4222-8222-222222222202', 'energy_star_verification', 'missing', null, null, null, 'Needs model-level verification before approval.'),
('33333333-3333-4333-8333-333333333303', 'audit_report',             'uploaded', 'https://docs.example-storage.com/file/audit-nguyen', now() - interval '18 days', (select id from staff where email='christina@stonebridgehomeenergy.com'), null),
('44444444-4444-4444-8444-444444444404', 'homeowner_intake_form',    'pending_review', 'https://docs.example-storage.com/file/intake-okafor', now() - interval '3 days', (select id from staff where email='devon@stonebridgehomeenergy.com'), null),
('55555555-5555-4555-8555-555555555505', 'audit_report',             'missing', null, null, null, 'Site visit not yet completed.');

-- ============================================================================
-- PORTAL STATUS EVENTS (raw inbound-email log)
-- ============================================================================
insert into portal_status_events (project_id, project_application_id, received_at, subject, body_snippet, parsed_status_code, matched, from_address, program_track, status_meaning, event_type, property_address, resolved) values
('11111111-1111-4111-8111-111111111101',
  (select id from project_applications where project_id='11111111-1111-4111-8111-111111111101' and program_track='HOMES'),
  now() - interval '1 day', 'Application Status Update - ESRP-2026-0001',
  'Your project application is currently under review by our team.', 'app_under_review', true,
  'no-reply@stateenergyprogram.example.gov', 'HOMES', 'Reservation package submitted, program reviewing', 'status_update',
  '128 Larkspur Hollow Ln, Richmond, VA 23225', true),
(null, null, now() - interval '4 hours', 'Application Status Update - Unmatched Applicant',
  'Your pre-qualification is pending submission.', 'pre_qual_pending_submission', false,
  'no-reply@stateenergyprogram.example.gov', 'HEAR', 'Homeowner has not finished applying', 'status_update',
  '19 Colonial Oak Dr, Mechanicsville, VA 23111', false),
('22222222-2222-4222-8222-222222222202',
  (select id from project_applications where project_id='22222222-2222-4222-8222-222222222202' and program_track='HEAR'),
  now() - interval '6 days', 'New Customer Selection - ESRP-2026-0002',
  'A homeowner has selected Stonebridge Home Energy Solutions as their contractor.', 'app_pending_submission', true,
  'no-reply@stateenergyprogram.example.gov', 'HEAR', 'Homeowner approved and selected contractor', 'new_customer_selection',
  '4417 Chesterfield Meadow Dr, Richmond, VA 23234', true);

-- ============================================================================
-- MAILBOX TRIAGE EVENTS
-- ============================================================================
insert into mailbox_triage_events (from_name, from_address, subject, body_snippet, ai_summary, email_type, resolved) values
('Coastal Plain Insulation Co.', 'dispatch@example-subcontractor.com', 'RE: Whitfield job - material delivery',
  'Confirming the blown-in insulation delivery for Thursday morning at the Larkspur Hollow address.',
  'Subcontractor confirming a Thursday morning material delivery for the Whitfield job.', 'subcontractor', true),
('Sarah Bennett', 'sarah.bennett@example.com', 'Question about my furnace estimate',
  'Hi, just wondering when I should expect to hear back about scheduling the site visit?',
  'Homeowner asking when her site visit will be scheduled.', 'homeowner_inquiry', false);

-- ============================================================================
-- AUTOMATION EVENTS (activity feed)
-- ============================================================================
insert into automation_events (occurred_at, source_workflow, project_id, event_type, message, severity) values
(now() - interval '6 days', 'lead_intake', '22222222-2222-4222-8222-222222222202', 'lead_captured', 'New lead captured from website form: Maria Alvarez.', 'info'),
(now() - interval '5 days', 'compliance_tracking', '22222222-2222-4222-8222-222222222202', 'doc_missing_alert', 'Energy Star verification still missing for Alvarez HEAR application.', 'warning'),
(now() - interval '3 days', 'portal_status_ingestion', '11111111-1111-4111-8111-111111111101', 'status_changed', 'Portal status updated to Project Application - Review for Whitfield HOMES application.', 'info'),
(now() - interval '2 days', 'ai_estimate_draft', '11111111-1111-4111-8111-111111111101', 'estimate_drafted', 'AI draft estimate generated for Whitfield HOMES application.', 'info'),
(now() - interval '1 hours', 'ai_estimate_draft', '11111111-1111-4111-8111-111111111101', 'estimate_approved', 'Estimate EST-ESRP-0001 received final approval.', 'info');

-- ============================================================================
-- ESTIMATE A -- Whitfield (HOMES) -- full pipeline through FINAL APPROVAL
-- ============================================================================
-- Exercises the real trigger chain end-to-end: document-readiness evidence,
-- pricing assumptions, generated fee lines, the two-step approval chain, the
-- >=95 validation gate on final approval, and the review-email outbox.

insert into estimates (id, project_id, estimate_number, version, program_track, status, ai_gap_flags)
values ('a1a1a1a1-1111-4111-8111-aaaaaaaaaa01', '11111111-1111-4111-8111-111111111101', 'EST-ESRP-0001', 1, 'HOMES', 'ai_draft', '[]'::jsonb);

insert into estimate_work_items (id, project_id, project_application_id, program_track, box_project_folder_name, readiness_status, hvac_in_scope, manual_j_required, manual_s_required, latest_estimate_id)
values ('a1a1a1a1-1111-4111-8111-aaaaaaaaaa02', '11111111-1111-4111-8111-111111111101',
  (select id from project_applications where project_id='11111111-1111-4111-8111-111111111101' and program_track='HOMES'),
  'HOMES', 'Whitfield Property Folder', 'approved', true, false, false, 'a1a1a1a1-1111-4111-8111-aaaaaaaaaa01');

insert into estimate_source_documents (id, work_item_id, document_type, box_file_id, box_path, file_name, extraction_status, extracted_data)
values
('a1a1a1a1-1111-4111-8111-aaaaaaaaaa03', 'a1a1a1a1-1111-4111-8111-aaaaaaaaaa02', 'audit_report', 'demo-audit-whitfield', 'Demo/Whitfield/audit-report.pdf', 'Whitfield Energy Audit Report.pdf', 'extracted', '{"summary":"Recommends attic air sealing, blown-in insulation, and a heat pump changeout."}'::jsonb),
('a1a1a1a1-1111-4111-8111-aaaaaaaaaa04', 'a1a1a1a1-1111-4111-8111-aaaaaaaaaa02', 'site_visit',   'demo-sitevisit-whitfield', 'Demo/Whitfield/site-visit.pdf', 'Whitfield Site Visit Form.pdf', 'extracted', '{"summary":"Site visit confirms attic access and existing HVAC condition."}'::jsonb);

update estimate_pricing_assumptions
set county = 'Richmond City', tax_rate = 5.3, tax_source_url = 'https://www.tax.virginia.gov/sales-and-use-tax', tax_checked_at = now()
where estimate_id = 'a1a1a1a1-1111-4111-8111-aaaaaaaaaa01';

insert into estimate_line_items (id, estimate_id, item_type, scope_name, description, sort_order, internal_notes, rebate_eligible)
values ('a1a1a1a1-1111-4111-8111-aaaaaaaaaa05', 'a1a1a1a1-1111-4111-8111-aaaaaaaaaa01', 'scope',
  'Attic Insulation & HVAC Changeout', 'Blown-in attic insulation, air sealing, and heat pump changeout per audit recommendations.',
  0, 'Verified scope of work', true);

insert into estimate_line_items (
  id, estimate_id, parent_line_item_id, item_type, scope_name, material_name, manufacturer, model_number,
  quantity, unit_of_measure, unit_cost, materials_amount, waste_factor_percent,
  source_vendor, source_url, source_checked_at, rebate_eligible, energy_star_certified, energy_star_source_url,
  technical_specifications, specification_source, compliance_reference, sort_order
) values (
  'a1a1a1a1-1111-4111-8111-aaaaaaaaaa06', 'a1a1a1a1-1111-4111-8111-aaaaaaaaaa01', 'a1a1a1a1-1111-4111-8111-aaaaaaaaaa05',
  'material', 'Heat pump system', 'ThermalCore Pro 3-Ton Heat Pump System', 'ThermalCore', 'TCP-3610-HP',
  1, 'set', 5200.00, 5200.00, 0,
  'Regional HVAC Supply', 'https://example-hvacsupply.com/thermalcore-tcp-3610', current_date, true, true,
  'https://www.energystar.gov/productfinder/demo-tcp-3610',
  '3-ton, 16 SEER2, variable-speed compressor', 'Manufacturer spec sheet, page 2', 'Meets ESRP HOMES equipment eligibility requirements', 1
);

insert into estimate_line_items (
  id, estimate_id, parent_line_item_id, item_type, scope_name, subcontractor_name,
  labor_pricing_method, labor_rate, labor_hours, rebate_eligible, sort_order
) values (
  'a1a1a1a1-1111-4111-8111-aaaaaaaaaa07', 'a1a1a1a1-1111-4111-8111-aaaaaaaaaa01', 'a1a1a1a1-1111-4111-8111-aaaaaaaaaa05',
  'labor', 'HVAC installation labor', 'Blue Ridge Mechanical LLC', 'hourly', 45.00, 20, true, 2
);

select apply_estimate_pricing_assumptions('a1a1a1a1-1111-4111-8111-aaaaaaaaaa01');
select recalculate_esrp_rebate('a1a1a1a1-1111-4111-8111-aaaaaaaaaa01');

update estimates set status = 'pending_review' where id = 'a1a1a1a1-1111-4111-8111-aaaaaaaaaa01';

update estimate_approval_steps
set status = 'approved', decided_by_staff_id = reviewer_staff_id, decided_at = now(), note = 'Reviewed and approved.'
where estimate_id = 'a1a1a1a1-1111-4111-8111-aaaaaaaaaa01' and reviewer_key = 'christina';

update estimate_approval_steps
set status = 'approved', decided_by_staff_id = reviewer_staff_id, decided_at = now(), note = 'Final approval granted.'
where estimate_id = 'a1a1a1a1-1111-4111-8111-aaaaaaaaaa01' and reviewer_key = 'jordan';

-- ============================================================================
-- ESTIMATE B -- Alvarez (HEAR) -- mid-review (first approval done, final pending)
-- ============================================================================
insert into estimates (id, project_id, estimate_number, version, program_track, status, ai_gap_flags)
values ('b2b2b2b2-2222-4222-8222-bbbbbbbbbb01', '22222222-2222-4222-8222-222222222202', 'EST-ESRP-0002', 1, 'HEAR', 'ai_draft', '[]'::jsonb);

update estimate_pricing_assumptions
set county = 'Chesterfield', tax_rate = 5.3, tax_source_url = 'https://www.tax.virginia.gov/sales-and-use-tax', tax_checked_at = now()
where estimate_id = 'b2b2b2b2-2222-4222-8222-bbbbbbbbbb01';

insert into estimate_line_items (id, estimate_id, item_type, scope_name, description, sort_order, internal_notes, rebate_eligible)
values ('b2b2b2b2-2222-4222-8222-bbbbbbbbbb02', 'b2b2b2b2-2222-4222-8222-bbbbbbbbbb01', 'scope',
  'Heat Pump Water Heater Replacement', 'Replace existing electric resistance water heater with a heat pump water heater.',
  0, 'Verified scope of work', true);

insert into estimate_line_items (
  id, estimate_id, parent_line_item_id, item_type, scope_name, material_name, manufacturer, model_number,
  quantity, unit_of_measure, unit_cost, materials_amount, waste_factor_percent,
  source_vendor, source_url, source_checked_at, rebate_eligible, energy_star_certified, energy_star_source_url, sort_order
) values (
  'b2b2b2b2-2222-4222-8222-bbbbbbbbbb03', 'b2b2b2b2-2222-4222-8222-bbbbbbbbbb01', 'b2b2b2b2-2222-4222-8222-bbbbbbbbbb02',
  'material', 'Heat pump water heater', 'EcoWave 50-Gallon Heat Pump Water Heater', 'EcoWave', 'EW-HPWH-50',
  1, 'each', 1850.00, 1850.00, 0,
  'Regional Plumbing Supply', 'https://example-plumbingsupply.com/ecowave-hpwh-50', current_date, true, true,
  'https://www.energystar.gov/productfinder/demo-ew-hpwh-50', 1
);

insert into estimate_line_items (
  id, estimate_id, parent_line_item_id, item_type, scope_name, subcontractor_name,
  labor_pricing_method, labor_rate, labor_hours, rebate_eligible, sort_order
) values (
  'b2b2b2b2-2222-4222-8222-bbbbbbbbbb04', 'b2b2b2b2-2222-4222-8222-bbbbbbbbbb01', 'b2b2b2b2-2222-4222-8222-bbbbbbbbbb02',
  'labor', 'Water heater swap labor', 'Piedmont Plumbing & Electric', 'hourly', 40.00, 6, true, 2
);

select apply_estimate_pricing_assumptions('b2b2b2b2-2222-4222-8222-bbbbbbbbbb01');

update estimates set status = 'pending_review' where id = 'b2b2b2b2-2222-4222-8222-bbbbbbbbbb01';

update estimate_approval_steps
set status = 'approved', decided_by_staff_id = reviewer_staff_id, decided_at = now(), note = 'Reviewed, ready for final approval.'
where estimate_id = 'b2b2b2b2-2222-4222-8222-bbbbbbbbbb01' and reviewer_key = 'christina';

-- ============================================================================
-- ESTIMATE C -- Nguyen (HOMES) -- still an AI/estimator draft, no review yet
-- ============================================================================
insert into estimates (id, project_id, estimate_number, version, program_track, status, ai_gap_flags)
values ('c3c3c3c3-3333-4333-8333-cccccccccc01', '33333333-3333-4333-8333-333333333303', 'EST-ESRP-0003', 1, 'HOMES', 'ai_draft', '[]'::jsonb);

insert into estimate_line_items (id, estimate_id, item_type, scope_name, description, sort_order, internal_notes)
values ('c3c3c3c3-3333-4333-8333-cccccccccc02', 'c3c3c3c3-3333-4333-8333-cccccccccc01', 'scope',
  'Attic Air Sealing & Insulation', 'Draft scope pending final measurements and estimator review.',
  0, 'Draft - pending estimator review');

insert into estimate_line_items (
  id, estimate_id, parent_line_item_id, item_type, scope_name, material_name,
  quantity, unit_of_measure, unit_cost, materials_amount,
  source_vendor, source_url, sort_order, rebate_eligible
) values (
  'c3c3c3c3-3333-4333-8333-cccccccccc03', 'c3c3c3c3-3333-4333-8333-cccccccccc01', 'c3c3c3c3-3333-4333-8333-cccccccccc02',
  'material', 'Blown-in cellulose insulation', 'Cellulose Insulation, 30lb bag',
  40, 'bag', 14.50, 580.00,
  'Local Building Supply', 'https://example-buildingsupply.com/cellulose-insulation', 1, true
);
