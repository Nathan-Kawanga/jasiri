import { requireShopRole } from "@/lib/context";
import { s } from "@/lib/strings";
import { kes } from "@/lib/format";
import { ticketsFromPeople, ticketMismatch, type PersonRow, type Ticket } from "@/lib/payout";
import { Page, Empty } from "@/components/ui";
import { DayNav, pickDay } from "@/components/day-nav";
import { PrintButton } from "@/components/print-button";

export default async function PayoutPage({ searchParams }: PageProps<"/shop/payout">) {
  const { supabase, shop } = await requireShopRole("cashier", "manager");
  const day = pickDay((await searchParams).d);
  const [{ data }, tix] = await Promise.all([
    supabase.rpc("payout_sheet", { p_shop: shop.shop_id, p_day: day }),
    supabase.rpc("payout_tickets", { p_shop: shop.shop_id, p_day: day }),
  ]);
  const rows = (data as { rows: PersonRow[] }).rows;
  // Before update 11 is run, rebuild the codes from the per-person sheet.
  const tickets = tix.error ? ticketsFromPeople(rows) : (tix.data as Ticket[]);
  const exp = (f: string) => `/api/export/payout?format=${f}&shop=${shop.shop_id}&from=${day}`;
  const th = "p-2 font-semibold";
  const side = "border-l-2 border-brand/60";

  return (
    <Page title={s.manager.payoutTitle} wide>
      <DayNav base="/shop/payout" day={day} />
      <div className="mb-2 hidden text-xl font-bold print:block">{shop.name} · {day}</div>
      {tickets.length === 0 ? <Empty>{s.app.none}</Empty> : (
        <>
          <h2 className="mb-1 text-sm text-muted">{s.manager.perTicket}</h2>
          <p className="no-print mb-2 text-xs text-muted md:hidden">{s.manager.swipe}</p>
          <div className="overflow-x-auto rounded-2xl border border-line">
            <table className="w-full min-w-[620px] border-collapse bg-surface text-left text-sm">
              <thead>
                <tr className="text-base">
                  <th colSpan={3} className="p-2 text-center font-bold">{s.manager.barberTotal}</th>
                  <th colSpan={3} className={`p-2 text-center font-bold ${side}`}>{s.manager.serviceStaff}</th>
                </tr>
                <tr className="border-b-2 border-brand">
                  <th className={th}>{s.manager.person}</th><th className={`${th} text-right`}>{s.manager.work}</th><th className={th}>{s.manager.paidCode}</th>
                  <th className={`${th} ${side}`}>{s.manager.person}</th><th className={`${th} text-right`}>{s.manager.work}</th><th className={th}>{s.manager.paidCode}</th>
                </tr>
              </thead>
              <tbody>
                {tickets.flatMap((t) => {
                  const lines = t.lines.length ? t.lines : [null];
                  return lines.map((l, i) => (
                    <tr key={`${t.code}-${i}`} className={`align-top ${i === lines.length - 1 ? "border-b border-line" : ""}`}>
                      {i === 0 ? (
                        <>
                          <td rowSpan={lines.length} className="p-2 font-bold">{t.barber ?? "—"}</td>
                          <td rowSpan={lines.length} className="p-2 text-right tabular-nums">
                            {t.barber ? <><div className="text-muted">{s.earnings.asBarber}</div><b>{kes(t.barber_amount)}</b></> : ""}
                          </td>
                          <td rowSpan={lines.length} className="p-2">
                            <div className="font-mono font-bold">{t.code}</div>
                            {ticketMismatch(t) ? <div className="text-xs text-amber-300">{s.manager.clientPaid(t.amount_paid!)}</div> : null}
                          </td>
                        </>
                      ) : null}
                      {l ? (
                        <>
                          <td className={`p-2 font-bold ${side}`}>{l.name}</td>
                          <td className="p-2 text-right tabular-nums"><div className="text-muted">{l.note || s.earnings.asService}</div><b>{kes(l.amount)}</b></td>
                          <td className="p-2 font-mono font-bold">{t.code}</td>
                        </>
                      ) : (
                        <td colSpan={3} className={`p-2 text-muted ${side}`}>—</td>
                      )}
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {rows.length > 0 ? (
        <>
          <h2 className="mb-2 mt-6 text-lg font-bold">{s.manager.perPerson}</h2>
          <table className="w-full border-collapse bg-surface text-left">
            <thead><tr className="border-b-2 border-brand text-sm">
              <th className="p-2">{s.manager.person}</th><th className="p-2 text-right">{s.manager.paidCodes}</th>
              <th className="p-2 text-right">{s.manager.earned}</th><th className="p-2 text-right">{s.manager.openCodes}</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user_id + r.role} className="border-b border-line align-top">
                  <td className="p-2"><b>{r.name}</b><div className="text-sm text-muted">{r.role === "barber" ? s.earnings.asBarber : s.earnings.asService}</div></td>
                  <td className="p-2 text-right tabular-nums">{r.paid_count}</td>
                  <td className="p-2 text-right font-bold tabular-nums">{kes(r.paid_amount)}</td>
                  <td className="p-2 text-right tabular-nums">{r.open_count || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      <div className="no-print mt-5 grid grid-cols-3 gap-2">
        <a href={exp("xlsx")} className="min-h-12 rounded-xl border border-brand py-3 text-center font-semibold text-brand">{s.app.downloadExcel}</a>
        <a href={exp("pdf")} className="min-h-12 rounded-xl border border-brand py-3 text-center font-semibold text-brand">{s.app.downloadPdf}</a>
        <a href={exp("csv")} className="min-h-12 rounded-xl border border-brand py-3 text-center font-semibold text-brand">{s.app.downloadCsv}</a>
      </div>
      <div className="mt-2"><PrintButton label={s.app.print} /></div>
    </Page>
  );
}
