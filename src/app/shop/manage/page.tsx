import { requireShopRole } from "@/lib/context";
import { s } from "@/lib/strings";
import { Page } from "@/components/ui";
import { ManageShop, type Member } from "./manage";
import { JoinRequests, type JoinRequest } from "@/components/join-requests";

export default async function Manage() {
  const { supabase, shop, profile } = await requireShopRole("manager");
  const base = () => supabase.from("memberships");
  const withRole = await base()
    .select("id, user_id, status, roles, requested_at, profiles!memberships_user_id_fkey(full_name, is_barber, signup_role)")
    .eq("shop_id", shop.shop_id).in("status", ["pending", "active"]).order("requested_at");
  // Until the database has update 5, fall back to the columns that existed before.
  const data = withRole.error
    ? (await base()
        .select("id, user_id, status, roles, requested_at, profiles!memberships_user_id_fkey(full_name, is_barber)")
        .eq("shop_id", shop.shop_id).in("status", ["pending", "active"]).order("requested_at")).data
    : withRole.data;
  const members = (data ?? []).map((m) => {
    const p = m.profiles as unknown as { full_name: string; is_barber: boolean; signup_role?: string | null };
    return { id: m.id, user_id: m.user_id, status: m.status, roles: m.roles, name: p.full_name, is_barber: p.is_barber, signup_role: p.signup_role ?? null } as Member;
  });
  const { data: requests, error: requestsError } = await supabase.rpc("shop_join_requests", { p_shop: shop.shop_id });
  return (
    <Page title={s.shop.manageTitle}>
      <JoinRequests shopId={shop.shop_id} initial={(requests ?? []) as JoinRequest[]} initialError={requestsError ? "requests_failed" : null} />
      <ManageShop shop={shop} members={members.filter((m) => m.status === "active")} me={profile.id} site={process.env.NEXT_PUBLIC_SITE_URL ?? ""} />
    </Page>
  );
}
