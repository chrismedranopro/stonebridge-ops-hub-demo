"use client";

import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import type { PipelineStage } from "@/lib/types";

// Mirrors the projects.lead_source check constraint.
const LEAD_SOURCES: { value: string; label: string }[] = [
  { value: "unknown", label: "Unknown / not specified" },
  { value: "portal", label: "ESRP Portal" },
  { value: "direct_call", label: "Direct Call" },
  { value: "direct_email", label: "Direct Email" },
  { value: "referral", label: "Referral" },
  { value: "other", label: "Other" },
];

// Mirrors the projects.ami_tier check constraint. The intake SOP requires AMI
// tier at lead intake alongside name/address/contacts/track; caps per the
// ESRP program requirements.
const AMI_TIERS: { value: string; label: string }[] = [
  { value: "unknown", label: "Unknown — not yet determined" },
  { value: "tier_1", label: "Tier 1 (<80% AMI — 100% covered)" },
  { value: "tier_2", label: "Tier 2 (80–150% AMI — ~50% covered)" },
];

interface Props {
  onAdded: () => void;
}

// Manual lead entry — lets staff add a new lead directly until automated
// intake picks it up from its source.
export function AddLeadForm({ onAdded }: Props) {
  const [open, setOpen] = useState(false);
  const [homeownerName, setHomeownerName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [homes, setHomes] = useState(true);
  const [hear, setHear] = useState(false);
  const [leadSource, setLeadSource] = useState("unknown");
  const [amiTier, setAmiTier] = useState("unknown");
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [internalStage, setInternalStage] = useState("new_pre_qualified");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same source as the board (lead-pipeline-board.tsx) -- stages live in the
  // DB, not hardcoded, so a stage added/renamed there shows up here too.
  useEffect(() => {
    supabase
      .from("pipeline_stages")
      .select("code, label, stage_group, sort_order, is_critical_alert")
      .order("sort_order")
      .then(({ data }) => setStages((data ?? []) as PipelineStage[]));
  }, []);

  function reset() {
    setHomeownerName("");
    setPhone("");
    setEmail("");
    setAddressLine1("");
    setAddressLine2("");
    setHomes(true);
    setHear(false);
    setLeadSource("unknown");
    setAmiTier("unknown");
    setInternalStage("new_pre_qualified");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!homeownerName.trim() || !addressLine1.trim()) {
      setError("Homeowner name and address are required.");
      return;
    }
    if (!homes && !hear) {
      setError("Select at least one program track (HOMES and/or HEAR).");
      return;
    }

    setSubmitting(true);

    // One RPC = one transaction: the homeowner record and its program
    // applications are created together or not at all (no orphan projects).
    // The database also re-validates the input and assigns the owner from the
    // signed-in session.
    const tracks = [homes && "HOMES", hear && "HEAR"].filter(Boolean) as string[];
    const { error: createError } = await supabase.rpc("create_lead", {
      p_homeowner_name: homeownerName.trim(),
      p_program_tracks: tracks,
      p_internal_status_code: internalStage,
      p_phone: phone.trim() || null,
      p_email: email.trim() || null,
      p_address_line1: addressLine1.trim(),
      p_address_line2: addressLine2.trim() || null,
      p_lead_source: leadSource,
      p_ami_tier: amiTier,
    });

    setSubmitting(false);

    if (createError) {
      setError(`The lead was not saved: ${createError.message}`);
      return;
    }

    reset();
    setOpen(false);
    onAdded();
  }

  if (!open) {
    return (
      <div style={{ marginBottom: 14, display: "flex", justifyContent: "flex-end" }}>
        <button className="primary" onClick={() => setOpen(true)}>+ Add Lead</button>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <p className="muted" style={{ marginTop: 0 }}>
        For leads that come in outside the automated intake — referral, phone call, walk-in,
        or migrating an existing lead from an older tracker. Set Internal Stage to match
        where a migrated lead already is. New leads should stay at &quot;New Pre-Qualified&quot;
        so the intake and qualification automation picks them up (simulated in this demo).
      </p>
      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          <div>
            <label htmlFor="al-name">Homeowner Name</label>
            <input
              id="al-name"
              type="text"
              placeholder="e.g. Jane Sample"
              value={homeownerName}
              onChange={(e) => setHomeownerName(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="al-phone">Phone</label>
            <input
              id="al-phone"
              type="text"
              placeholder="(804) 555-0100"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="al-email">Email</label>
            <input
              id="al-email"
              type="email"
              placeholder="homeowner@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="full">
            <label htmlFor="al-address1">Address</label>
            <input
              id="al-address1"
              type="text"
              placeholder="Street address"
              value={addressLine1}
              onChange={(e) => setAddressLine1(e.target.value)}
            />
          </div>
          <div className="full">
            <label htmlFor="al-address2">City / State / ZIP</label>
            <input
              id="al-address2"
              type="text"
              placeholder="City, VA ZIP"
              value={addressLine2}
              onChange={(e) => setAddressLine2(e.target.value)}
            />
          </div>
          <div>
            <label>Program Track</label>
            <div style={{ display: "flex", gap: 14, alignItems: "center", height: 34 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 5, textTransform: "none", fontWeight: 400, fontSize: 12, color: "var(--text)" }}>
                <input type="checkbox" checked={homes} onChange={(e) => setHomes(e.target.checked)} style={{ width: "auto" }} />
                HOMES
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 5, textTransform: "none", fontWeight: 400, fontSize: 12, color: "var(--text)" }}>
                <input type="checkbox" checked={hear} onChange={(e) => setHear(e.target.checked)} style={{ width: "auto" }} />
                HEAR
              </label>
            </div>
          </div>
          <div>
            <label htmlFor="al-source">Source</label>
            <select id="al-source" value={leadSource} onChange={(e) => setLeadSource(e.target.value)}>
              {LEAD_SOURCES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="al-ami">AMI Tier</label>
            <select id="al-ami" value={amiTier} onChange={(e) => setAmiTier(e.target.value)}>
              {AMI_TIERS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="al-stage">Internal Stage</label>
            <select id="al-stage" value={internalStage} onChange={(e) => setInternalStage(e.target.value)}>
              {stages.map((s) => (
                <option key={s.code} value={s.code}>{s.label}</option>
              ))}
            </select>
            <p className="muted" style={{ fontSize: 10, margin: "5px 0 0", lineHeight: 1.4 }}>
              {internalStage === "new_pre_qualified"
                ? "Queues lead intake and qualification after saving (simulated in this demo)."
                : "Migration mode: saves at this stage and skips lead intake/qualification."}
            </p>
          </div>
        </div>
        {error && (
          <p style={{ color: "var(--red-text)", fontSize: 12, marginTop: 10 }}>{error}</p>
        )}
        <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
          <button type="submit" className="primary" disabled={submitting}>
            {submitting ? "Adding…" : "Add Lead"}
          </button>
          <button type="button" className="ghost" onClick={() => { setOpen(false); setError(null); }} disabled={submitting}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
