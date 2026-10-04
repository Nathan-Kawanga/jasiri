import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { serverClient } from "./supabase/server";

export type Role = "manager" | "barber" | "service_staff" | "cashier";

export type Profile = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  is_barber: boolean;
  handle: string | null;
  about: string | null;
  photo_path: string | null;
  signup_role?: string | null;
  slot_minutes: number;
  is_platform_admin: boolean;
  suspended: boolean;
  trial_ends_at: string;
  paid_until: string | null;
  subscription: "free" | "trial" | "paid" | "due";
  payment_instructions: string;
  monthly_price_kes: string;
};

export type ShopMembership = {
  membership_id: string;
  shop_id: string;
  name: string;
  area: string;
  status: "pending" | "active";
  roles: Role[];
  on_duty: boolean;
  join_code: string | null;
  suspended: boolean;
};

export const SHOP_COOKIE = "jasiri_shop";

export const getContext = cache(async () => {
  const supabase = await serverClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const [{ data: profile }, { data: shops }] = await Promise.all([
    supabase.rpc("my_profile"),
    supabase.rpc("my_shops"),
  ]);
  if (!profile) return null;
  const all = (shops ?? []) as ShopMembership[];
  const usable = all.filter((m) => m.status === "active" && !m.suspended);
  const wanted = (await cookies()).get(SHOP_COOKIE)?.value;
  const current = usable.find((m) => m.shop_id === wanted) ?? usable[0] ?? null;
  return {
    supabase,
    user,
    profile: profile as Profile,
    shops: all,
    usableShops: usable,
    current,
    roles: (current?.roles ?? []) as Role[],
  };
});

export type Context = NonNullable<Awaited<ReturnType<typeof getContext>>>;

export async function requireContext(): Promise<Context> {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  if (ctx.profile.suspended) redirect("/suspended");
  return ctx;
}

// Requires the current shop and one of the roles; otherwise back home.
export async function requireShopRole(...roles: Role[]) {
  const ctx = await requireContext();
  if (!ctx.current || !roles.some((r) => ctx.roles.includes(r))) redirect("/");
  return { ...ctx, shop: ctx.current };
}

export async function requireBarber() {
  const ctx = await requireContext();
  if (!ctx.profile.is_barber) redirect("/");
  return ctx;
}

export async function requireAdmin() {
  const ctx = await requireContext();
  if (!ctx.profile.is_platform_admin) redirect("/");
  return ctx;
}
