// Server-side (route handler) access to Supabase *as the calling user*.
// The browser sends its access token; we verify it with Supabase Auth and then
// query with that token, so every read is filtered by the same RLS policies
// the browser would get. No service-role key is used anywhere in this app.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

export type StaffGuardResult =
  | { ok: true; db: SupabaseClient }
  | { ok: false; response: NextResponse };

function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}

/** Require a signed-in, ACTIVE staff member (same rule as the database's is_ops_hub_user()). */
export async function requireOpsHubUser(request: NextRequest): Promise<StaffGuardResult> {
  const token = bearerToken(request);
  if (!token) {
    return { ok: false, response: NextResponse.json({ error: "Sign in to continue." }, { status: 401 }) };
  }

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data: userData, error: userError } = await db.auth.getUser(token);
  if (userError || !userData.user) {
    return { ok: false, response: NextResponse.json({ error: "Your session has expired. Sign in again." }, { status: 401 }) };
  }

  const { data: isStaff, error: staffError } = await db.rpc("is_ops_hub_user");
  if (staffError) {
    console.error("is_ops_hub_user check failed", staffError);
    return { ok: false, response: NextResponse.json({ error: "Could not verify your access. Try again." }, { status: 503 }) };
  }
  if (isStaff !== true) {
    return { ok: false, response: NextResponse.json({ error: "Your account does not have Ops Hub access." }, { status: 403 }) };
  }
  return { ok: true, db };
}
