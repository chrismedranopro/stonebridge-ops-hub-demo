"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Staff } from "./types";

interface AuthResult {
  ok: boolean;
  error?: string;
  /** Sign-up only: true when Supabase requires the confirmation email to be clicked before sign-in works. */
  needsConfirmation?: boolean;
}

interface SignupProfile {
  firstName: string;
  lastName: string;
  role: string;
}

interface AuthContextValue {
  user: Staff | null;
  loading: boolean;
  signUp: (email: string, password: string, profile: SignupProfile) => Promise<AuthResult>;
  signInWithPassword: (email: string, password: string) => Promise<AuthResult>;
  sendPasswordReset: (email: string) => Promise<AuthResult>;
  updatePassword: (newPassword: string) => Promise<AuthResult>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function toStaff(row: {
  id: string;
  full_name: string;
  role: string | null;
  initials: string | null;
  email: string | null;
  access_level: string | null;
}): Staff {
  return {
    id: row.id,
    full_name: row.full_name,
    first_name: row.full_name.split(" ")[0],
    role: row.role ?? "",
    initials: row.initials ?? row.full_name.slice(0, 2).toUpperCase(),
    email: row.email ?? "",
    // Defensive default: never trust an unexpected DB value into a higher tier.
    access_level: row.access_level === "leadership" ? "leadership" : "staff",
  };
}

// This is a public demo: anyone can sign up with any email. Access is decided
// by the database, not here: a trigger on auth.users creates the staff row at
// sign-up, and every RLS policy requires an ACTIVE staff row whose
// auth_user_id is the session's user id (see is_ops_hub_user() in
// supabase/migrations). This lookup only mirrors that rule so the UI can sign
// out an unprovisioned or deactivated account instead of rendering empty pages.
async function resolveStaff(session: Session | null): Promise<{ staff: Staff | null; error?: string }> {
  const userId = session?.user?.id;
  if (!userId) return { staff: null };

  const { data: staff, error } = await supabase
    .from("staff")
    .select("id, full_name, role, initials, email, access_level")
    .eq("auth_user_id", userId)
    .eq("active", true)
    .maybeSingle();
  if (staff) return { staff: toStaff(staff) };
  // A failed lookup is not proof the account is revoked, so it is reported as
  // an error rather than treated as "no access".
  if (error) return { staff: null, error: `Could not load your staff record: ${error.message}` };

  await supabase.auth.signOut();
  return { staff: null };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(async ({ data }) => {
      const { staff, error } = await resolveStaff(data.session);
      if (error) console.error(error);
      if (cancelled) return;
      setUser(staff);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const { staff, error } = await resolveStaff(session);
      if (error) console.error(error);
      if (cancelled) return;
      setUser(staff);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function signUp(email: string, password: string, profile: SignupProfile): Promise<AuthResult> {
    const trimmed = email.trim().toLowerCase();
    // Name/role ride along as auth user_metadata; the database's sign-up
    // trigger turns them into the staff row (access level is never taken
    // from the client).
    const { data, error } = await supabase.auth.signUp({
      email: trimmed,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
        data: {
          first_name: profile.firstName.trim(),
          last_name: profile.lastName.trim(),
          role: profile.role.trim(),
        },
      },
    });
    if (error) return { ok: false, error: error.message };
    // If email confirmation is required, signUp succeeds but returns no
    // session yet — the account only becomes usable once the link is clicked.
    return { ok: true, needsConfirmation: !data.session };
  }

  async function signInWithPassword(email: string, password: string): Promise<AuthResult> {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) return { ok: false, error: error.message };

    // Resolve (and set) the staff record synchronously here, rather than
    // relying solely on the onAuthStateChange listener -- that path has no
    // way to report back to the login form, so a revoked account would just
    // silently bounce back to /login with no explanation.
    const { staff, error: staffError } = await resolveStaff(data.session);
    if (staffError) return { ok: false, error: staffError };
    if (!staff) {
      return { ok: false, error: "No active staff account found for this email. Contact an administrator." };
    }
    setUser(staff);
    return { ok: true };
  }

  async function sendPasswordReset(email: string): Promise<AuthResult> {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  async function updatePassword(newPassword: string): Promise<AuthResult> {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  function signOut() {
    supabase.auth.signOut();
    setUser(null);
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, signUp, signInWithPassword, sendPasswordReset, updatePassword, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
