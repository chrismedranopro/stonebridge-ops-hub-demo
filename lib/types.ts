// Field names mirror db/schema.sql's `staff` table (see db/README.md).
// Future sessions add Project/Stage/etc. types here as those pages get built.
export interface Staff {
  id: string; // short id in sample data ('lp'/'pm'/'tc'); real schema uses uuid
  full_name: string;
  first_name: string;
  role: string;
  initials: string;
  email: string;
  // Dashboard-tier grouping, currently unused by the UI — see staff.access_level
  // comment in db/schema.sql. All staff see the same executive dashboard for now.
  access_level: "leadership" | "staff";
}

// Mirrors db/schema.sql's `pipeline_stages` table.
export interface PipelineStage {
  code: string;
  label: string;
  stage_group: string;
  sort_order: number;
  is_critical_alert: boolean;
}

// One card = one `project_applications` row (one program track for one project),
// per the 2026-07-31 decision that HOMES/HEAR always get independent status rows.
export interface PipelineCard {
  applicationId: string;
  projectId: string;
  displayId: string | null;
  homeownerName: string;
  address: string;
  programTrack: "HOMES" | "HEAR";
  stage: PipelineStage;
  portalStatusStale: boolean;
  createdAt: string;
}

// Mirrors db/schema.sql's `compliance_doc_types` reference table.
export interface ComplianceDocType {
  code: string;
  label: string;
  lifecycleStage: string;
  appliesToTrack: "HOMES" | "HEAR" | "both" | "conditional";
  required: boolean;
  conditionNote: string | null;
  sourceCitation: string | null;
}

// Mirrors db/schema.sql's `project_compliance_documents.status` check constraint.
export type ComplianceDocStatus = "missing" | "uploaded" | "pending_review" | "rejected";

// Per-project checklist state for one doc type. A doc type with no row yet in
// `project_compliance_documents` is represented the same way with status
// "missing" (the column's own default) -- see components/compliance/compliance-view.tsx.
export interface ProjectComplianceDoc {
  status: ComplianceDocStatus;
  fileUrl: string | null;
  uploadedAt: string | null;
  uploadedByStaffId: string | null;
  notes: string | null;
  // Set by the Box->compliance bridge trigger (audit report / Manual J/S pulled
  // from Fieldwire/<Project>/). Such rows land as "pending_review" for a human
  // to confirm -- migration 20260828_bridge_estimate_source_docs_to_compliance.
  autoDetected: boolean;
}
