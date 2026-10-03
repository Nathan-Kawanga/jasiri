import Link from "next/link";
import { requireContext } from "@/lib/context";
import { s } from "@/lib/strings";
import { kes, time, dayLabel, nairobiToday, addDays, weekStart, monthStart } from "@/lib/format";
import { Badge, Card, Page, Stat, Empty } from "@/components/ui";
import { ReportProblem } from "./report";

type Row = {
  code_id: string; display_code: string; shop_name: string; day: string; created_at: string; status: string;
  service_status: string; role: string; amount: number; client_first_name: string | null; void_reason: string | null; verification: string;
};
type Earnings = { rows: Row[]; verified_amount: number; verified_count: number; open_amount: number; open_count: number; voided_count: number };

function periods() {
  const today = nairobiToday();
  const ws = weekStart(today);
  const ms = monthStart(today);
  const lastMs = monthStart(addDays(ms, -1));
  return {
    today: { label: s.app.today, from: today, to: today },
    week: { label: s.app.thisWeek, from: ws, to: today },
    lastweek: { label: s.earnings.lastWeek, from: addDays(ws, -7), to: addDays(ws, -1) },
    month: { label: s.earnings.thisMonth, from: ms, to: today },
    lastmonth: { label: s.earnings.lastMonth, from: lastMs, to: addDays(ms, -1) },
  } as const;
}

export default async function EarningsPage({ searchParams }: PageProps<"/earnings">) {
  const { supabase, usableShops, current } = await requireContext();
  const { p } = await searchParams;
  const all = periods();
  const key = (typeof p === "string" && p in all ? p : "today") as keyof typeof all;
  const period = all[key];
  const { data } = await supabase.rpc("my_earnings", { p_from: period.from, p_to: period.to });
  const e = data as Earnings;
  const exp = (f: string) => `/api/export/earnings?format=${f}&from=${period.from}&to=${period.to}`;

  return (
    <Page title={s.earnings.title}>
      <div className="space-y-5">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {Object.entries(all).map(([k, v]) => (
            <Link key={k} href={`/earnings?p=${k}`} className={`min-h-12 shrink-0 rounded-full px-4 py-3 text-sm font-semibold ${k === key ? "bg-brand text-white" : "border-2 border-line bg-white"}`}>{v.label}</Link>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Stat label={`${s.earnings.verified} (${e.verified_count} ${s.earnings.codes})`} value={kes(e.verified_amount)} /></div>
          <Stat label={`${s.earnings.open} (${e.open_count})`} value={kes(e.open_amount)} tone={e.open_count ? "warn" : undefined} />
          <Stat label={s.earnings.voided} value={e.voided_count} />
        </div>
        <Card className="space-y-2">
          <div className="font-bold">{s.earnings.export}</div>
          <div className="grid grid-cols-3 gap-2">
            <a href={exp("xlsx")} className="min-h-12 rounded-xl border-2 border-brand py-3 text-center font-semibold text-brand">{s.app.downloadExcel}</a>
            <a href={exp("pdf")} className="min-h-12 rounded-xl border-2 border-brand py-3 text-center font-semibold text-brand">{s.app.downloadPdf}</a>
            <a href={exp("csv")} className="min-h-12 rounded-xl border-2 border-brand py-3 text-center font-semibold text-brand">{s.app.downloadCsv}</a>
          </div>
        </Card>
        <section className="space-y-2">
          <h2 className="text-lg font-bold">{s.earnings.myCodes}</h2>
          {e.rows.length === 0 ? <Empty>{s.app.none}</Empty> : null}
          {e.rows.map((r) => (
            <div key={`${r.code_id}${r.role}`} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-white px-3 py-2">
              <div>
                <div><b className="font-mono">{r.display_code}</b> · {r.client_first_name ?? "—"} · {r.role === "barber" ? s.earnings.asBarber : s.earnings.asService}</div>
                <div className="text-sm text-muted">{key === "today" ? time(r.created_at) : `${dayLabel(r.created_at)} ${time(r.created_at)}`}{usableShops.length > 1 ? ` · ${r.shop_name}` : ""}</div>
              </div>
              <div className="text-right">
                <div className="font-bold tabular-nums">{kes(r.amount)}</div>
                <Badge tone={r.verification === "cashier_confirmed" ? "green" : r.verification === "voided" ? "red" : "amber"}>{s.code.verification[r.verification]}</Badge>
              </div>
            </div>
          ))}
        </section>
        <ReportProblem shops={usableShops.map((m) => ({ id: m.shop_id, name: m.name }))} defaultShop={current?.shop_id ?? null} />
      </div>
    </Page>
  );
}
