"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Staff } from "./types";

const ALLOWED_DOMAIN = "@cascadiahomeenergy.com";
// Developer/testing access only — mirrors the exception in the
// enforce_cascadia_domain_trigger DB trigger, which is the real gate.
// Not a client account; remove once a real @cascadiahomeenergy.com address exists
// for whoever is building/maintaining this app.
const DEV_ACCESS_EMAILS = ["chrismedrano.pro@gmail.com"];

function isAllowedEmail(email: string): boolean {
  return email.endsWith(ALLOWED_DOMAIN) || DEV_ACCESS_EMAILS.includes(email);
}

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

function nameFromEmail(email: string): string {
  return email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function fallbackStaff(userId: string, email: string): Staff {
  const name = nameFromEmail(email);
  return {
    id: userId,
    full_name: name,
    first_name: name.split(" ")[0],
    role: "",
    initials: name.slice(0, 2).toUpperCase(),
    email,
    access_level: "staff",
  };
}

// Set (briefly) by signUp() right before calling supabase.auth.signUp(), and
// consumed the moment resolveStaff actually creates a row for that email --
// this is the ONLY thing that's allowed to create a staff row. Without this
// gate, resolveStaff used to treat ANY session with no matching row as "first
// time here" and silently re-provision one -- which meant deleting (or
// deactivating) someone's staff row never actually revoked their access, it
// just self-healed on their next login (Chris found this by testing it
// directly on his own christina@cascadiahomeenergy.com row, 2026-08-26).
let allowStaffCreateForEmail: string | null = null;

// The only real gate on WHO CAN SIGN UP is Supabase itself: a Postgres
// trigger on auth.users (enforce_cascadia_domain_trigger) refuses to
// create an account for any email outside @cascadiahomeenergy.com. But an
// auth.users row, once created, exists forever regardless of what happens in
// `staff` -- so `staff` is what actually gates APP ACCESS. A session with no
// matching active `staff` row is unauthorized, full stop: either the account
// was never provisioned, or access was revoked (row deleted or
// active=false). The only legitimate way to get a first row is through
// signUp() itself (allowStaffCreateForEmail, above); everywhere else --
// including a plain login -- gets signed back out.
async function resolveStaff(session: Session | null): Promise<Staff | null> {
  const email = session?.user?.email;
  if (!email) return null;

  const { data: existing } = await supabase
    .from("staff")
    .select("id, full_name, role, initials, email, access_level")
    .ilike("email", email)
    .eq("active", true)
    .maybeSingle();
  if (existing) return toStaff(existing);

  if (allowStaffCreateForEmail?.toLowerCase() !== email.toLowerCase()) {
    await supabase.auth.signOut();
    return null;
  }
  allowStaffCreateForEmail = null;

  const meta = session!.user.user_metadata as {
    first_name?: string;
    last_name?: string;
    role?: string;
  };
  const fullName = [meta.first_name, meta.last_name].filter(Boolean).join(" ").trim() || nameFromEmail(email);
  const initials =
    ((meta.first_name?.[0] ?? "") + (meta.last_name?.[0] ?? "")).toUpperCase() || fullName.slice(0, 2).toUpperCase();

  // access_level deliberately omitted — leave it to the column default
  // ('staff') so self-signup can never grant the leadership tier.
  // upsert (not insert): onAuthStateChange can fire more than once for the
  // same first-time session (e.g. INITIAL_SESSION + SIGNED_IN), so two calls
  // here can race past the "existing" check above at the same time. Insert
  // let that create duplicate rows for the same email indefinitely, since
  // once >1 row matched, .maybeSingle() below could never resolve cleanly
  // again — every later login just added another one. The staff_email_unique
  // constraint makes onConflict resolve to an update instead of a duplicate.
  const { data: created } = await supabase
    .from("staff")
    .upsert({ full_name: fullName, role: meta.role ?? "", initials, email }, { onConflict: "email" })
    .select("id, full_name, role, initials, email, access_level")
    .maybeSingle();

  return created ? toStaff(created) : fallbackStaff(session!.user.id, email);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(async ({ data }) => {
      const staff = await resolveStaff(data.session);
      if (cancelled) return;
      setUser(staff);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const staff = await resolveStaff(session);
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
    if (!isAllowedEmail(trimmed)) {
      return { ok: false, error: `Use your ${ALLOWED_DOMAIN} email address.` };
    }
    // Client-side domain check above is just UX — the real gate is the
    // enforce_cascadia_domain_trigger on auth.users, which would reject
    // this insert regardless of what the frontend checked.
    // Name/role ride along as auth user_metadata so resolveStaff can create
    // the real staff row once a session exists (immediately, or after the
    // confirmation link is clicked — whichever comes first). Flagging the
    // email here is what lets resolveStaff's create-branch fire at all for
    // this one session, whenever it lands (see allowStaffCreateForEmail).
    allowStaffCreateForEmail = trimmed;
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
    if (error) {
      allowStaffCreateForEmail = null;
      return { ok: false, error: error.message };
    }
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
    const staff = await resolveStaff(data.session);
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
