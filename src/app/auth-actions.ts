"use server";
import { redirect } from "next/navigation";
import { serverClient, serviceClient } from "@/lib/supabase/server";
import { normalizePhone, phoneLoginEmail, EMAIL_RE } from "@/lib/phone";
import { clientIp, rateLimit } from "@/lib/ip";

export type FormState = { error?: string; minutes?: number; ok?: string } | undefined;

const PIN_RE = /^\d{6}$/;

// Only same-site paths, so a crafted link can't send people elsewhere after sign-in.
function nextPath(form: FormData): string {
  const n = String(form.get("next") ?? "");
  return n.startsWith("/") && !n.startsWith("//") && !n.includes("\\") ? n : "/";
}
const HANDLE_RE = /^[a-z0-9][a-z0-9-]{2,29}$/;

function loginEmailFor(identifier: string): string | null {
  const id = identifier.trim().toLowerCase();
  if (id.includes("@")) return EMAIL_RE.test(id) ? id : null;
  const phone = normalizePhone(id);
  return phone ? phoneLoginEmail(phone) : null;
}

export async function signIn(_: FormState, form: FormData): Promise<FormState> {
  const loginEmail = loginEmailFor(String(form.get("identifier") ?? ""));
  const pin = String(form.get("pin") ?? "");
  if (!loginEmail) return { error: "invalid_phone" };
  if (!PIN_RE.test(pin)) return { error: "pin_format" };

  const ip = await clientIp();
  if (!(await rateLimit(`login-ip:${ip}`, 30, 600))) return { error: "rate_limited" };

  const admin = serviceClient();
  const { data: wait } = await admin.rpc("login_wait_seconds", { p_identifier: loginEmail });
  if (wait && wait > 0) return { error: "locked", minutes: Math.ceil(wait / 60) };

  const supabase = await serverClient();
  const { error } = await supabase.auth.signInWithPassword({ email: loginEmail, password: pin });
  await admin.rpc("login_record", { p_identifier: loginEmail, p_success: !error });
  if (error) return { error: "wrong_pin" };
  redirect(nextPath(form));
}

export async function signUp(_: FormState, form: FormData): Promise<FormState> {
  const fullName = String(form.get("full_name") ?? "").trim();
  const mode = form.get("mode") === "email" ? "email" : "phone";
  const pin = String(form.get("pin") ?? "");
  const pin2 = String(form.get("pin2") ?? "");
  const isBarber = mode === "phone" && form.get("is_barber") === "on";
  const handle = String(form.get("handle") ?? "").trim().toLowerCase();

  if (fullName.length < 2) return { error: "name_required" };
  if (!PIN_RE.test(pin)) return { error: "pin_format" };
  if (pin !== pin2) return { error: "pin_mismatch" };
  if (isBarber && !HANDLE_RE.test(handle)) return { error: "handle_format" };

  let phone: string | null = null;
  let contactEmail: string | null = null;
  let loginEmail: string;
  if (mode === "phone") {
    phone = normalizePhone(String(form.get("phone") ?? ""));
    if (!phone) return { error: "invalid_phone" };
    loginEmail = phoneLoginEmail(phone);
  } else {
    contactEmail = String(form.get("email") ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(contactEmail) || contactEmail.endsWith("@phone.jasiri.app")) return { error: "invalid_email" };
    loginEmail = contactEmail;
  }

  const ip = await clientIp();
  if (!(await rateLimit(`signup-ip:${ip}`, 10, 3600))) return { error: "rate_limited" };

  const admin = serviceClient();
  if (phone) {
    const { data } = await admin.from("profiles").select("id").eq("phone", phone).maybeSingle();
    if (data) return { error: "phone_taken" };
  }
  if (contactEmail) {
    const { data } = await admin.from("profiles").select("id").eq("email", contactEmail).maybeSingle();
    if (data) return { error: "email_taken" };
  }
  if (isBarber) {
    const { data } = await admin.from("profiles").select("id").eq("handle", handle).maybeSingle();
    if (data) return { error: "handle_taken" };
  }

  const { error } = await admin.auth.admin.createUser({
    email: loginEmail,
    password: pin,
    email_confirm: true,
    user_metadata: { full_name: fullName, phone, contact_email: contactEmail, is_barber: isBarber, handle: isBarber ? handle : null },
  });
  if (error) {
    return { error: /already|registered|exists/i.test(error.message) ? (phone ? "phone_taken" : "email_taken") : "generic" };
  }

  const supabase = await serverClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email: loginEmail, password: pin });
  if (signInError) return { error: "generic" };
  redirect(nextPath(form));
}

export async function signOut() {
  const supabase = await serverClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}

// Changing your own PIN signs out your other phones and keeps this one.
export async function changePin(_: FormState, form: FormData): Promise<FormState> {
  const current = String(form.get("current") ?? "");
  const pin = String(form.get("pin") ?? "");
  const pin2 = String(form.get("pin2") ?? "");
  if (!PIN_RE.test(pin) || !PIN_RE.test(current)) return { error: "pin_format" };
  if (pin !== pin2) return { error: "pin_mismatch" };

  const supabase = await serverClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return { error: "not_signed_in" };

  const admin = serviceClient();
  const { data: wait } = await admin.rpc("login_wait_seconds", { p_identifier: user.email });
  if (wait && wait > 0) return { error: "locked", minutes: Math.ceil(wait / 60) };

  // Check the current PIN without touching this browser's session.
  const { createClient } = await import("@supabase/supabase-js");
  const probe = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: wrong } = await probe.auth.signInWithPassword({ email: user.email, password: current });
  await admin.rpc("login_record", { p_identifier: user.email, p_success: !wrong });
  if (wrong) return { error: "wrong_pin" };

  const { error } = await supabase.auth.updateUser({ password: pin });
  if (error) return { error: "generic" };
  await supabase.rpc("end_my_other_sessions");
  await admin.rpc("record_pin_change", { p_user: user.id });
  return { ok: "pin_changed" };
}
