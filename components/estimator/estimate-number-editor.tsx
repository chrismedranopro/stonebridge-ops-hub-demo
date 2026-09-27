"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export function EstimateNumberEditor({ estimateId, estimateNumber, status, onSaved }: {
  estimateId: string; estimateNumber: string; status: string; onSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [number, setNumber] = useState(estimateNumber);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const editable = ["ai_draft", "pending_review", "rejected"].includes(status);
  async function save() {
    if (!editable || !reason.trim() || number.trim() === estimateNumber) return;
    setSaving(true); setMessage("");
    try {
      const { error } = await supabase.rpc("rename_estimate_for_migration", { p_estimate_id: estimateId, p_estimate_number: number.trim(), p_reason: reason.trim() });
      if (error) { setMessage(error.message); return; }
      await onSaved(); setEditing(false); setMessage("Estimate number updated. Previous number retained in history.");
    } catch { setMessage("Unable to save the estimate number. Please retry."); }
    finally { setSaving(false); }
  }
  return <div className="border-b border-white/10 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="text-sm text-white">Estimate <strong>{estimateNumber}</strong></div>{editable && <button onClick={() => { setNumber(estimateNumber); setEditing(!editing); }} disabled={saving} className="text-xs text-cyan-300 underline">{editing ? "Cancel" : "Edit estimate number for migration"}</button>}</div>
    {editing && <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs text-slate-400">Estimate number<input maxLength={80} value={number} onChange={e => setNumber(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-white/10 px-3 text-sm text-white"/></label><label className="text-xs text-slate-400">Migration reason<input value={reason} onChange={e => setReason(e.target.value)} placeholder="Existing workbook or legacy reference" className="mt-1 h-10 w-full rounded-lg border border-white/10 px-3 text-sm text-white"/></label><p className="text-xs text-slate-400">The property and program stay linked. Approved and signed versions retain their original number.</p><button onClick={save} disabled={saving || !reason.trim() || !number.trim() || number.trim() === estimateNumber} className="justify-self-end rounded-lg border border-cyan-400/30 px-4 py-2 text-sm text-cyan-200 disabled:opacity-40">{saving ? "Saving..." : "Save estimate number"}</button></div>}
    {message && <p role="status" className="mt-2 text-xs text-amber-200">{message}</p>}
  </div>;
}
