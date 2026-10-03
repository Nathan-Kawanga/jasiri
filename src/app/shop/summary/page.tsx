import { requireShopRole } from "@/lib/context";
import { s } from "@/lib/strings";
import { kes } from "@/lib/format";
import { Page, Stat } from "@/components/ui";
import { DayNav, pickDay } from "@/components/day-nav";

type Summary = { created: number; paid: number; voided: number; cancelled: number; open: number; till_total: number; expected_total: number; barber_total: number; service_total: number; mismatch_count: number };

export default async function SummaryPage({ searchParams }: PageProps<"/shop/summary">) {
  const { supabase, shop } = await requireShopRole("cashier", "manager");
  const day = pickDay((await searchParams).d);
  const { data } = await supabase.rpc("shop_summary", { p_shop: shop.shop_id, p_day: day });
  const x = data as Summary;
  return (
    <Page title={s.manager.summaryTitle}>
      <DayNav base="/shop/summary" day={day} />
      <div className="space-y-3">
        <div className="rounded-2xl gold-grad p-4 text-black">
          <div className="text-sm opacity-80">{s.manager.till}</div>
          <div className="text-4xl font-black tabular-nums">{kes(x.till_total)}</div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Stat label={s.manager.created} value={x.created} />
          <Stat label={s.manager.paid} value={x.paid} />
          <Stat label={s.manager.open} value={x.open} tone={x.open ? "warn" : undefined} />
          <Stat label={s.manager.voided} value={x.voided} />
          <Stat label={s.manager.barberTotal} value={kes(x.barber_total)} />
          <Stat label={s.manager.serviceTotal} value={kes(x.service_total)} />
          <Stat label={s.manager.expected} value={kes(x.expected_total)} />
          <Stat label={s.manager.mismatches} value={x.mismatch_count} tone={x.mismatch_count ? "warn" : undefined} />
        </div>
      </div>
    </Page>
  );
}
