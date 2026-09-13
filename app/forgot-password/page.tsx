"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";

export default function ForgotPasswordPage() {
  const { sendPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await sendPasswordReset(email);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong. Try again.");
      return;
    }
    setSent(true);
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
        <h1>Reset password</h1>
        <div className="sub">We&apos;ll email you a link to set a new password.</div>

        {sent ? (
          <p className="muted">
            Check <strong>{email}</strong> for a reset link.
          </p>
        ) : (
          <form onSubmit={handleSubmit}>
            <label htmlFor="forgot-email">Email</label>
            <input
              id="forgot-email"
              type="email"
              placeholder="you@stonebridgehomeenergy.com"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {error && <div className="login-error">{error}</div>}
            <button type="submit" className="primary" disabled={submitting}>
              {submitting ? "Sending…" : "Send Reset Link"}
            </button>
          </form>
        )}

        <div className="login-note">
          <Link href="/login" style={{ color: "var(--accent)" }}>Back to sign in</Link>
        </div>
      </div>
    </div>
  );
}
