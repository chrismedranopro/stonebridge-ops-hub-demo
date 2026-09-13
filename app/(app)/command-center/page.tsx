import { Suspense } from "react";
import { CommandCenterView } from "@/components/command-center/command-center-view";

export default function CommandCenterPage() {
  return (
    <Suspense fallback={<div className="card"><p className="muted" style={{ marginTop: 0 }}>Loading…</p></div>}>
      <CommandCenterView />
    </Suspense>
  );
}
