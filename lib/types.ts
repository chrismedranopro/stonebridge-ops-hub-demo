// Field names mirror the `staff` table (supabase/migrations).
// Future sessions add Project/Stage/etc. types here as those pages get built.
export interface Staff {
  id: string; // staff.id (uuid) -- not the auth user id; see staff.auth_user_id
  full_name: string;
  first_name: string;
  role: string;
  initials: string;
  email: string;
  // Dashboard-tier grouping, currently unused by the UI — see staff.access_level
  // column comment in the baseline migration. All staff see the same executive dashboard for now.
  access_level: "leadership" | "staff";
}

// Mirrors the `pipeline_stages` table.
export interface PipelineStage {
  code: string;
  label: string;
  stage_group: string;
  sort_order: number;
  is_critical_alert: boolean;
}

// One card = one `project_applications` row (one program track for one project),
// HOMES and HEAR always get independent status rows.
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

// Mirrors the `compliance_doc_types` reference table.
export interface ComplianceDocType {
  code: string;
  label: string;
  lifecycleStage: string;
  appliesToTrack: "HOMES" | "HEAR" | "both" | "conditional";
  required: boolean;
  conditionNote: string | null;
  sourceCitation: string | null;
}

// Mirrors the `project_compliance_documents.status` check constraint.
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
  // Set by the document-intake -> compliance bridge trigger (audit report /
  // Manual J/S). Such rows land as "pending_review" for a human to confirm --
  // see bridge_estimate_source_doc_to_compliance() in the baseline migration.
  autoDetected: boolean;
}
