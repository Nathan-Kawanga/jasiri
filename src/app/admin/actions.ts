"use server";
import { serverClient, serviceClient } from "@/lib/supabase/server";

// Platform admin resets a PIN (the pilot's replacement for SMS reset).
// The person is signed out on every phone.
export async function adminResetPin(userId: string, pin: string): Promise<{ ok: boolean; error?: string }> {
  if (!/^\d{6}$/.test(pin)) return { ok: false, error: "pin_format" };
  const supabase = await serverClient();
  const { data: me } = await supabase.rpc("my_profile");
  if (!me?.is_platform_admin || me.suspended) return { ok: false, error: "not_allowed" };
  const admin = serviceClient();
  const { data: target, error } = await admin.auth.admin.updateUserById(userId, { password: pin });
  if (error) return { ok: false, error: "generic" };
  await admin.rpc("end_user_sessions", { p_user: userId, p_keep_session: null });
  if (target.user?.email) await admin.rpc("login_record", { p_identifier: target.user.email, p_success: true });
  await admin.from("audit_log").insert({ actor_id: me.id, actor_roles: ["platform_admin"], action: "admin.reset_pin", entity: "profiles", entity_id: userId });
  return { ok: true };
}
