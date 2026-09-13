"use client";

import { FormEvent, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

type Notice = { tone: "success" | "error"; message: string } | null;

const inputStyle = {
  width: "100%",
  border: "1px solid var(--border)",
  borderRadius: 7,
  background: "var(--panel)",
  color: "var(--text)",
  padding: "9px 11px",
  fontSize: 12,
} as const;

const labelStyle = {
  display: "block",
  marginBottom: 6,
  color: "var(--muted2)",
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: ".05em",
  textTransform: "uppercase",
} as const;

function NoticeBox({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <div
      style={{
        marginBottom: 14,
        border: `1px solid ${notice.tone === "success" ? "rgba(34,197,94,.3)" : "rgba(239,68,68,.35)"}`,
        borderRadius: 8,
        background: notice.tone === "success" ? "rgba(34,197,94,.08)" : "rgba(239,68,68,.08)",
        color: notice.tone === "success" ? "var(--green-text)" : "var(--red-text)",
        padding: "10px 12px",
        fontSize: 12,
      }}
    >
      {notice.message}
    </div>
  );
}

export function SettingsView() {
  const { user, updatePassword, signOut } = useAuth();
  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [role, setRole] = useState(user?.role ?? "");
  const [initials, setInitials] = useState(user?.initials ?? "");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileNotice, setProfileNotice] = useState<Notice>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordNotice, setPasswordNotice] = useState<Notice>(null);

  if (!user) return null;

  const userId = user.id;
  const normalizedInitials = initials.trim().toUpperCase();
  const profileChanged =
    fullName.trim() !== user.full_name || role.trim() !== user.role || normalizedInitials !== user.initials;

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setProfileNotice(null);

    if (!fullName.trim()) {
      setProfileNotice({ tone: "error", message: "Full name is required." });
      return;
    }
    if (!normalizedInitials || normalizedInitials.length > 4) {
      setProfileNotice({ tone: "error", message: "Initials must be between 1 and 4 characters." });
      return;
    }

    setProfileSaving(true);
    const { error } = await supabase
      .from("staff")
      .update({ full_name: fullName.trim(), role: role.trim(), initials: normalizedInitials })
      .eq("id", userId);

    if (error) {
      setProfileNotice({ tone: "error", message: `Could not save profile: ${error.message}` });
      setProfileSaving(false);
      return;
    }

    window.location.reload();
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordNotice(null);

    if (newPassword.length < 8) {
      setPasswordNotice({ tone: "error", message: "Use at least 8 characters for the new password." });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordNotice({ tone: "error", message: "The password confirmation does not match." });
      return;
    }

    setPasswordSaving(true);
    const result = await updatePassword(newPassword);
    if (!result.ok) {
      setPasswordNotice({ tone: "error", message: result.error ?? "Could not update password." });
      setPasswordSaving(false);
      return;
    }

    setNewPassword("");
    setConfirmPassword("");
    setPasswordNotice({ tone: "success", message: "Password updated successfully." });
    setPasswordSaving(false);
  }

  return (
    <div>
      <div className="grid stat-row">
        <div className="card stat-card">
          <div className="label">Signed in as</div>
          <div className="value" style={{ fontSize: 18 }}>{user.first_name}</div>
          <div className="sub">{user.email}</div>
        </div>
        <div className="card stat-card">
          <div className="label">Access tier</div>
          <div className="value" style={{ fontSize: 18, textTransform: "capitalize" }}>{user.access_level}</div>
          <div className="sub">Managed by Stonebridge administrators</div>
        </div>
        <div className="card stat-card green">
          <div className="label">Account status</div>
          <div className="value" style={{ fontSize: 18 }}>Active</div>
          <div className="sub">Authenticated through Supabase</div>
        </div>
        <div className="card stat-card">
          <div className="label">Workspace</div>
          <div className="value" style={{ fontSize: 18 }}>ESRP</div>
          <div className="sub">Stonebridge Ops Hub</div>
        </div>
      </div>

      <div className="settings-grid">
        <form className="card" onSubmit={saveProfile}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
            <div>
              <h2 style={{ margin: 0 }}>Profile</h2>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: 11 }}>Shown across assignments, approvals, and activity records.</p>
            </div>
            <div style={{ width: 38, height: 38, flexShrink: 0, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--accent-dark)", color: "var(--accent2)", fontSize: 11, fontWeight: 700 }}>{normalizedInitials || user.initials}</div>
          </div>

          <NoticeBox notice={profileNotice} />

          <div className="settings-name-grid">
            <label>
              <span style={labelStyle}>Full name</span>
              <input style={inputStyle} value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" />
            </label>
            <label>
              <span style={labelStyle}>Initials</span>
              <input style={{ ...inputStyle, textTransform: "uppercase" }} value={initials} maxLength={4} onChange={(event) => setInitials(event.target.value)} />
            </label>
          </div>

          <label style={{ display: "block", marginTop: 12 }}>
            <span style={labelStyle}>Role / title</span>
            <input style={inputStyle} value={role} onChange={(event) => setRole(event.target.value)} placeholder="Operations Manager" />
          </label>

          <label style={{ display: "block", marginTop: 12 }}>
            <span style={labelStyle}>Email</span>
            <input style={{ ...inputStyle, color: "var(--muted2)", cursor: "not-allowed" }} value={user.email} readOnly disabled />
          </label>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <button className="primary" type="submit" disabled={profileSaving || !profileChanged}>
              {profileSaving ? "Saving…" : "Save profile"}
            </button>
          </div>
        </form>

        <div className="card">
          <h2 style={{ marginTop: 0, marginBottom: 4 }}>Access and security</h2>
          <p className="muted" style={{ marginTop: 0, fontSize: 11 }}>Your email and access tier cannot be changed from this page.</p>

          <div style={{ borderTop: "1px solid var(--border)", marginTop: 16, paddingTop: 14 }}>
            <div style={labelStyle}>Account permissions</div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
              <span className="muted">Access tier</span>
              <span className="pill info" style={{ textTransform: "capitalize" }}>{user.access_level}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 10, fontSize: 12 }}>
              <span className="muted">Staff record</span>
              <span style={{ fontFamily: "var(--mono)", fontSize: 10 }}>{user.id.slice(0, 8)}</span>
            </div>
          </div>

          <div style={{ borderTop: "1px solid var(--border)", marginTop: 16, paddingTop: 14 }}>
            <div style={labelStyle}>Session</div>
            <p className="muted" style={{ margin: "0 0 12px", fontSize: 11 }}>Sign out when using a shared or temporary computer.</p>
            <button className="ghost" type="button" onClick={signOut}>Sign out</button>
          </div>
        </div>

        <form className="card" onSubmit={changePassword} style={{ gridColumn: "1 / -1" }}>
          <h2 style={{ marginTop: 0, marginBottom: 4 }}>Change password</h2>
          <p className="muted" style={{ marginTop: 0, fontSize: 11 }}>Choose a unique password with at least eight characters.</p>

          <NoticeBox notice={passwordNotice} />

          <div className="settings-password-grid">
            <label>
              <span style={labelStyle}>New password</span>
              <input style={inputStyle} type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" />
            </label>
            <label>
              <span style={labelStyle}>Confirm password</span>
              <input style={inputStyle} type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" />
            </label>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <button className="primary" type="submit" disabled={passwordSaving || !newPassword || !confirmPassword}>
              {passwordSaving ? "Updating…" : "Update password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
