import { Suspense } from "react";
import { ComplianceView } from "@/components/compliance/compliance-view";

export default function CompliancePage() {
  return (
    <Suspense fallback={<div className="card"><p className="muted" style={{ marginTop: 0 }}>Loading…</p></div>}>
      <ComplianceView />
    </Suspense>
  );
}
