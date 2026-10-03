import { requireShopRole } from "@/lib/context";
import { s } from "@/lib/strings";
import { Page } from "@/components/ui";
import { ManageShop, type Member } from "./manage";

export default async function Manage() {
  const { supabase, shop, profile } = await requireShopRole("manager");
  const { data } = await supabase
    .from("memberships")
    .select("id, user_id, status, roles, on_duty_date, requested_at, profiles!memberships_user_id_fkey(full_name, is_barber)")
    .eq("shop_id", shop.shop_id)
    .in("status", ["pending", "active"])
    .order("requested_at");
  const members = (data ?? []).map((m) => {
    const p = m.profiles as unknown as { full_name: string; is_barber: boolean };
    return { id: m.id, user_id: m.user_id, status: m.status, roles: m.roles, name: p.full_name, is_barber: p.is_barber } as Member;
  });
  return (
    <Page title={s.shop.manageTitle}>
      <ManageShop shop={shop} members={members} me={profile.id} site={process.env.NEXT_PUBLIC_SITE_URL ?? ""} />
    </Page>
  );
}
