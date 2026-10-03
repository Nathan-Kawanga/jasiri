import { requireShopRole } from "@/lib/context";
import { s } from "@/lib/strings";
import { kes } from "@/lib/format";
import { Page, Empty } from "@/components/ui";
import { DayNav, pickDay } from "@/components/day-nav";
import { PrintButton } from "@/components/print-button";

type Row = { user_id: string; name: string; role: string; paid_count: number; paid_amount: number; open_count: number; codes: { code: string; amount: number }[] };

export default async function PayoutPage({ searchParams }: PageProps<"/shop/payout">) {
  const { supabase, shop } = await requireShopRole("cashier", "manager");
  const day = pickDay((await searchParams).d);
  const { data } = await supabase.rpc("payout_sheet", { p_shop: shop.shop_id, p_day: day });
  const rows = (data as { rows: Row[] }).rows;
  const exp = (f: string) => `/api/export/payout?format=${f}&shop=${shop.shop_id}&from=${day}`;
  return (
    <Page title={s.manager.payoutTitle}>
      <DayNav base="/shop/payout" day={day} />
      <div className="mb-2 hidden text-xl font-bold print:block">{shop.name} · {day}</div>
      {rows.length === 0 ? <Empty>{s.app.none}</Empty> : (
        <table className="w-full border-collapse bg-surface text-left">
          <thead><tr className="border-b-2 border-brand text-sm">
            <th className="p-2">{s.manager.person}</th><th className="p-2 text-right">{s.manager.paidCodes}</th>
            <th className="p-2 text-right">{s.manager.earned}</th><th className="p-2 text-right">{s.manager.openCodes}</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.user_id + r.role} className="border-b border-line align-top">
                <td className="p-2"><b>{r.name}</b><div className="text-sm text-muted">{r.role === "barber" ? s.earnings.asBarber : s.earnings.asService}</div>
                  <div className="font-mono text-xs text-muted">{r.codes.map((c) => c.code).join(" ")}</div></td>
                <td className="p-2 text-right tabular-nums">{r.paid_count}</td>
                <td className="p-2 text-right font-bold tabular-nums">{kes(r.paid_amount)}</td>
                <td className="p-2 text-right tabular-nums">{r.open_count || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="no-print mt-5 grid grid-cols-3 gap-2">
        <a href={exp("xlsx")} className="min-h-12 rounded-xl border border-brand py-3 text-center font-semibold text-brand">{s.app.downloadExcel}</a>
        <a href={exp("pdf")} className="min-h-12 rounded-xl border border-brand py-3 text-center font-semibold text-brand">{s.app.downloadPdf}</a>
        <a href={exp("csv")} className="min-h-12 rounded-xl border border-brand py-3 text-center font-semibold text-brand">{s.app.downloadCsv}</a>
      </div>
      <div className="mt-2"><PrintButton label={s.app.print} /></div>
    </Page>
  );
}
