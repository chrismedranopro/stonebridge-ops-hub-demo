import type { ComplianceDocStatus, ComplianceDocType } from "./types";

export interface ComplianceSummary {
  percent: number;
  missing: number;
  rejected: number;
  requiredCount: number;
}

// Shared by the Compliance page's own per-project stats and the Portfolio
// table's compliance column, so the same project never shows two different
// percentages depending on which page you're looking at.
export function applicableDocTypes(docTypes: ComplianceDocType[], programTracks: string[]): ComplianceDocType[] {
  return docTypes.filter(
    (dt) =>
      dt.appliesToTrack === "both" ||
      dt.appliesToTrack === "conditional" ||
      programTracks.includes(dt.appliesToTrack)
  );
}

export function computeComplianceSummary(
  docTypes: ComplianceDocType[],
  programTracks: string[],
  statusFor: (docTypeCode: string) => ComplianceDocStatus
): ComplianceSummary {
  const applicable = applicableDocTypes(docTypes, programTracks);
  const required = applicable.filter((d) => d.required);

  let completed = 0;
  let missing = 0;
  let rejected = 0;
  for (const doc of required) {
    const status = statusFor(doc.code);
    if (status === "uploaded" || status === "pending_review") completed += 1;
    else if (status === "missing") missing += 1;
    else if (status === "rejected") rejected += 1;
  }

  const percent = required.length ? Math.round((completed / required.length) * 100) : 100;
  return { percent, missing, rejected, requiredCount: required.length };
}
