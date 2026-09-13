"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { PasswordInput } from "@/components/password-input";

export default function SignupPage() {
  const { user, loading, signUp } = useAuth();
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);

  useEffect(() => {
    if (user) router.replace("/dashboard");
  }, [user, router]);

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
    const result = await signUp(email, password, { firstName, lastName, role });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong. Try again.");
      return;
    }
    if (result.needsConfirmation) {
      setConfirmationSent(true);
    }
    // If no confirmation is required, onAuthStateChange already picked up the
    // new session and the useEffect above will redirect to /dashboard.
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
        <h1>Create account</h1>
        <div className="sub">Only @stonebridgehomeenergy.com email addresses can sign up.</div>

        {confirmationSent ? (
          <p className="muted">
            Check <strong>{email}</strong> for a confirmation link, then come back here to sign in.
          </p>
        ) : (
          <form onSubmit={handleSubmit}>
            <label htmlFor="signup-first-name">First name</label>
            <input
              id="signup-first-name"
              type="text"
              placeholder="Jane"
              autoComplete="given-name"
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
            <label htmlFor="signup-last-name">Last name</label>
            <input
              id="signup-last-name"
              type="text"
              placeholder="Doe"
              autoComplete="family-name"
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
            <label htmlFor="signup-role">Role</label>
            <input
              id="signup-role"
              type="text"
              placeholder="e.g. ESRP Estimator"
              autoComplete="organization-title"
              required
              value={role}
              onChange={(e) => setRole(e.target.value)}
            />
            <label htmlFor="signup-email">Email</label>
            <input
              id="signup-email"
              type="email"
              placeholder="you@stonebridgehomeenergy.com"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <label htmlFor="signup-pass">Password</label>
            <PasswordInput
              id="signup-pass"
              placeholder="At least 8 characters"
              autoComplete="new-password"
              required
              value={password}
              onChange={setPassword}
            />
            <label htmlFor="signup-pass-confirm">Confirm password</label>
            <PasswordInput
              id="signup-pass-confirm"
              placeholder="••••••••"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={setConfirmPassword}
            />
            {error && <div className="login-error">{error}</div>}
            <button type="submit" className="primary" disabled={submitting || loading}>
              {submitting ? "Creating account…" : "Create Account"}
            </button>
          </form>
        )}

        {!confirmationSent && (
          <div className="login-note">
            Already have an account? <Link href="/login" style={{ color: "var(--accent)" }}>Sign in</Link>
          </div>
        )}
      </div>
    </div>
  );
}
