import type { ReactNode } from "react";
import { requireShopRole } from "@/lib/context";
import { s } from "@/lib/strings";
import { kes, dayLabel, dateTime, nairobiToday, addDays } from "@/lib/format";
import { Card, Page, Badge } from "@/components/ui";
import { RangeNav, pickDays } from "@/components/day-nav";

type Flags = {
  open_after_day: { code_id: string; display_code: string; day: string; barber_name: string | null; staff_name: string | null }[];
  mismatches: { code_id: string; display_code: string; day: string; barber_name: string | null; expected: number; paid: number; cashier_name: string }[];
  voids_by_person: { name: string; count: number; reasons: Record<string, number> }[];
  handovers: { display_code: string; at: string; from_name: string | null; to_name: string }[];
  void_recreate: { voided_code: string; new_code: string; voided_barber: string | null; new_barber: string | null; at: string }[];
  open_problems: number;
};

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <Card className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold">{title}</h2>
        <Badge tone={count ? "amber" : "green"}>{count}</Badge>
      </div>
      {children}
    </Card>
  );
}

export default async function FlagsPage({ searchParams }: PageProps<"/shop/flags">) {
  const { supabase, shop } = await requireShopRole("manager");
  const days = pickDays((await searchParams).days);
  const to = nairobiToday();
  const { data } = await supabase.rpc("shop_flags", { p_shop: shop.shop_id, p_from: addDays(to, -(days - 1)), p_to: to });
  const f = data as Flags;
  const d = (ymd: string) => dayLabel(ymd + "T12:00:00+03:00");
  return (
    <Page title={s.manager.flagsTitle} back="/shop/admin">
      <RangeNav base="/shop/flags" days={days} />
      <div className="space-y-3">
        <Section title={s.manager.openAfterDay} count={f.open_after_day.length}>
          {f.open_after_day.map((x) => <div key={x.code_id} className="text-sm"><b className="font-mono">{x.display_code}</b> · {d(x.day)} · {x.barber_name ?? s.code.noBarber} → {x.staff_name ?? "—"}</div>)}
        </Section>
        <Section title={s.manager.mismatchList} count={f.mismatches.length}>
          {f.mismatches.map((x) => <div key={x.code_id} className="text-sm"><b className="font-mono">{x.display_code}</b> · {d(x.day)} · {x.barber_name ?? "—"} · {kes(x.expected)} → <b>{kes(x.paid)}</b> ({x.cashier_name})</div>)}
        </Section>
        <Section title={s.manager.voidsByPerson} count={f.voids_by_person.reduce((a, x) => a + x.count, 0)}>
          {f.voids_by_person.map((x) => <div key={x.name} className="text-sm"><b>{x.name}</b>: {x.count} · {Object.entries(x.reasons).map(([k, v]) => `${s.cashier.reasons[k]} ${v}`).join(", ")}</div>)}
        </Section>
        <Section title={s.manager.handovers} count={f.handovers.length}>
          {f.handovers.map((x, i) => <div key={i} className="text-sm"><b className="font-mono">{x.display_code}</b> · {dateTime(x.at)} · {x.from_name ?? "—"} → {x.to_name}</div>)}
        </Section>
        <Section title={s.manager.voidRecreate} count={f.void_recreate.length}>
          {f.void_recreate.map((x, i) => <div key={i} className="text-sm"><b className="font-mono">{x.voided_code}</b> ({x.voided_barber ?? "—"}) → <b className="font-mono">{x.new_code}</b> ({x.new_barber ?? "—"}) · {dateTime(x.at)}</div>)}
        </Section>
        <Section title={s.manager.openProblems} count={f.open_problems}><span /></Section>
      </div>
    </Page>
  );
}
