import { requireShopRole } from "@/lib/context";
import { s } from "@/lib/strings";
import { nairobiToday, addDays, dayLabel } from "@/lib/format";
import { Card, Page, Stat } from "@/components/ui";
import { RangeNav, pickDays } from "@/components/day-nav";
import { UsageCodes, BookingTable, type CodeMetrics, type BookingMetric } from "@/components/usage";

type Usage = {
  codes: CodeMetrics;
  per_barber: { name: string; confirmed: number; paid: number; with_phone_pct: number | null }[];
  bookings: BookingMetric[];
  problems: { open: number; resolved: number };
  active_staff: { day: string; names: string[] }[];
};

export default async function UsagePage({ searchParams }: PageProps<"/shop/usage">) {
  const { supabase, shop } = await requireShopRole("manager");
  const days = pickDays((await searchParams).days);
  const to = nairobiToday();
  const from = addDays(to, -(days - 1));
  const { data } = await supabase.rpc("shop_usage", { p_shop: shop.shop_id, p_from: from, p_to: to });
  const u = data as Usage;
  return (
    <Page title={s.manager.usageTitle} back="/shop/admin" actions={<a href={`/api/export/usage?format=csv&shop=${shop.shop_id}&from=${from}&to=${to}`} className="min-h-12 px-2 py-3 font-semibold text-brand">{s.app.downloadCsv}</a>}>
      <RangeNav base="/shop/usage" days={days} />
      <div className="space-y-4">
        <UsageCodes m={u.codes} />
        <Card className="space-y-1">
          <div className="font-bold">{s.manager.perBarber}</div>
          {u.per_barber.map((b) => <div key={b.name} className="flex justify-between text-sm"><span>{b.name}</span><span>{b.paid}/{b.confirmed} · {b.with_phone_pct ?? 0}% ☎</span></div>)}
        </Card>
        <BookingTable rows={u.bookings} />
        <div className="grid grid-cols-2 gap-3">
          <Stat label={`${s.manager.problemsTitle}: open`} value={u.problems.open} />
          <Stat label={`${s.manager.problemsTitle}: ${s.manager.resolved}`} value={u.problems.resolved} />
        </div>
        <Card className="space-y-1">
          <div className="font-bold">{s.manager.activeStaff}</div>
          {u.active_staff.map((d) => <div key={d.day} className="text-sm"><b>{dayLabel(d.day + "T12:00:00+03:00")}</b>: {d.names.join(", ")}</div>)}
        </Card>
      </div>
    </Page>
  );
}
