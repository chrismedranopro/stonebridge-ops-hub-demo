"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { PasswordInput } from "@/components/password-input";

export default function ResetPasswordPage() {
  const { updatePassword } = useAuth();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Arriving here from the emailed reset link already establishes a recovery
  // session client-side (Supabase's detectSessionInUrl picks up the token in
  // the URL on load) — this form just sets a new password on that session.
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setSubmitting(true);
    const result = await updatePassword(password);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong. Try again.");
      return;
    }
    router.replace("/dashboard");
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="logo-row">
          <div className="logo-box">MD</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Stonebridge</div>
            <div style={{ color: "var(--muted2)", fontSize: 9 }}>Operations Hub</div>
          </div>
        </div>
        <h1>Set a new password</h1>
        <form onSubmit={handleSubmit}>
          <label htmlFor="reset-pass">New password</label>
          <PasswordInput
            id="reset-pass"
            placeholder="At least 8 characters"
            autoComplete="new-password"
            required
            value={password}
            onChange={setPassword}
          />
          <label htmlFor="reset-pass-confirm">Confirm new password</label>
          <PasswordInput
            id="reset-pass-confirm"
            placeholder="••••••••"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={setConfirmPassword}
          />
          {error && <div className="login-error">{error}</div>}
          <button type="submit" className="primary" disabled={submitting}>
            {submitting ? "Saving…" : "Set Password"}
          </button>
        </form>
      </div>
    </div>
  );
}
