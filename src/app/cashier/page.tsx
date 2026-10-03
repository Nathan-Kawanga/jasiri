import { requireShopRole } from "@/lib/context";
import { s } from "@/lib/strings";
import { Page } from "@/components/ui";
import { Cashier, type CCode } from "./cashier";

export default async function CashierPage() {
  const { supabase, shop } = await requireShopRole("cashier");
  const { data } = await supabase.rpc("cashier_codes", { p_shop: shop.shop_id });
  return (
    <Page title={`${s.cashier.title} · ${shop.name}`}>
      <Cashier shopId={shop.shop_id} initial={(data ?? []) as CCode[]} />
    </Page>
  );
}
