import { requireShopRole } from "@/lib/context";
import { s } from "@/lib/strings";
import { Page } from "@/components/ui";
import { ManageShop, type Member } from "./manage";

export default async function Manage() {
  const { supabase, shop, profile } = await requireShopRole("manager");
  const query = (cols: string) => supabase
    .from("memberships")
    .select(`id, user_id, status, roles, on_duty_date, requested_at, profiles!memberships_user_id_fkey(${cols})`)
    .eq("shop_id", shop.shop_id)
    .in("status", ["pending", "active"])
    .order("requested_at");
  let { data, error } = await query("full_name, is_barber, signup_role");
  // Until the database has update 5, fall back to the columns that existed before.
  if (error) ({ data, error } = await query("full_name, is_barber"));
  const members = (data ?? []).map((m) => {
    const p = m.profiles as unknown as { full_name: string; is_barber: boolean; signup_role: string | null };
    return { id: m.id, user_id: m.user_id, status: m.status, roles: m.roles, name: p.full_name, is_barber: p.is_barber, signup_role: p.signup_role } as Member;
  });
  return (
    <Page title={s.shop.manageTitle}>
      <ManageShop shop={shop} members={members} me={profile.id} site={process.env.NEXT_PUBLIC_SITE_URL ?? ""} />
    </Page>
  );
}
