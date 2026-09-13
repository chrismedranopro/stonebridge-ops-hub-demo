"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { PasswordInput } from "@/components/password-input";

export default function LoginPage() {
  const { user, loading, signInWithPassword } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user) router.replace("/dashboard");
  }, [user, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await signInWithPassword(email, password);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong. Try again.");
    }
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
        <h1>Sign in</h1>
        <div className="sub">Sign in, or create an account to try the demo.</div>
        <form onSubmit={handleSubmit}>
          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            type="email"
            placeholder="you@example.com"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <label htmlFor="login-pass">Password</label>
          <PasswordInput
            id="login-pass"
            placeholder="••••••••"
            autoComplete="current-password"
            required
            value={password}
            onChange={setPassword}
          />
          {error && <div className="login-error">{error}</div>}
          <button type="submit" className="primary" disabled={submitting || loading}>
            {submitting ? "Signing in…" : "Sign In"}
          </button>
        </form>
        <div className="login-note">
          <Link href="/forgot-password" style={{ color: "var(--accent)" }}>Forgot password?</Link>
          {" · "}
          No account yet?{" "}
          <Link href="/signup" style={{ color: "var(--accent)" }}>Create one</Link>
        </div>
      </div>
    </div>
  );
}
