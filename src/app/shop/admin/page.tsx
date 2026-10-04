import Link from "next/link";
import { requireShopRole } from "@/lib/context";
import { s } from "@/lib/strings";
import { Page } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { JoinRequests, type JoinRequest } from "@/components/join-requests";

// The manager's tools in one place, so a barber who manages the shop still sees a barber home.
export default async function ShopAdmin() {
  const { supabase, shop } = await requireShopRole("manager");
  const { data: requests, error } = await supabase.rpc("shop_join_requests", { p_shop: shop.shop_id });
  const items: { href: string; label: string; icon: IconName }[] = [
    { href: "/shop/manage", label: s.home.manage, icon: "users" },
    { href: "/shop/summary", label: s.home.summary, icon: "chart" },
    { href: "/shop/payout", label: s.home.payout, icon: "list" },
    { href: "/shop/flags", label: s.home.flags, icon: "flag" },
    { href: "/shop/usage", label: s.home.usage, icon: "chart" },
    { href: "/shop/problems", label: s.home.problems, icon: "alert" },
    { href: "/shop/audit", label: s.home.audit, icon: "shield" },
  ];
  return (
    <Page title={`${s.home.shopAdmin} · ${shop.name}`}>
      <JoinRequests shopId={shop.shop_id} initial={(requests ?? []) as JoinRequest[]} initialError={error ? "requests_failed" : null} />
      <div className="grid grid-cols-2 gap-3">
        {items.map((x) => (
          <Link key={x.href} href={x.href} className="flex min-h-24 flex-col justify-between rounded-3xl border border-line bg-surface p-4 hover:border-brand/40 active:scale-[0.97]">
            <span className="inline-flex size-10 items-center justify-center rounded-2xl bg-brand/10 text-brand"><Icon name={x.icon} size={20} /></span>
            <span className="mt-2 font-bold">{x.label}</span>
          </Link>
        ))}
      </div>
    </Page>
  );
}
