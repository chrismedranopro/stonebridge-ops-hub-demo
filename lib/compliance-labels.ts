import type { ComplianceDocStatus } from "./types";

// Order matches db/schema.sql's compliance_doc_types.lifecycle_stage check
// constraint, which is itself the GHEP program checklist's own stage order
// (GHEP program requirements, Stages 1-3, plus the SOP pre/post split).
export const LIFECYCLE_STAGE_ORDER = [
  "pre_qualification",
  "pre_reservation",
  "pre_install",
  "mid_install",
  "post_install",
  "closeout",
];

const LIFECYCLE_STAGE_LABELS: Record<string, string> = {
  pre_qualification: "Pre-Qualification",
  pre_reservation: "Pre-Reservation",
  pre_install: "Pre-Install",
  mid_install: "Mid-Install",
  post_install: "Post-Install",
  closeout: "Closeout",
};

export function formatLifecycleStage(code: string): string {
  return LIFECYCLE_STAGE_LABELS[code] ?? code;
}

const STATUS_LABELS: Record<ComplianceDocStatus, string> = {
  missing: "Missing",
  uploaded: "Uploaded",
  pending_review: "Pending Review",
  rejected: "Rejected",
};

export function formatDocStatus(status: ComplianceDocStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function docStatusPillClass(status: ComplianceDocStatus): "critical" | "warning" | "ok" {
  switch (status) {
    case "rejected":
    case "missing":
      return "critical";
    case "pending_review":
      return "warning";
    case "uploaded":
      return "ok";
  }
}

export function progressClass(percent: number): string {
  if (percent >= 100) return "";
  if (percent >= 50) return "mid";
  return "low";
}
