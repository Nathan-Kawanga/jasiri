import { requireAdmin } from "@/lib/context";
import { s } from "@/lib/strings";
import { nairobiToday, addDays, dayLabel } from "@/lib/format";
import { Card, Page, Stat } from "@/components/ui";
import { RangeNav, pickDays } from "@/components/day-nav";
import { UsageCodes, BookingTable, type CodeMetrics, type BookingMetric } from "@/components/usage";
import { AdminNav } from "./nav";

type Platform = {
  codes: CodeMetrics; bookings: BookingMetric[]; signups: number; new_shops: number; barbers_moved_with_book: number;
  problems: { open: number; resolved: number };
  kill_criteria: { barbers: number; barbers_15_codes_last_7_days: number; trial_ended: number; paying_after_trial: number };
  daily_active: { day: string; users: number }[];
};
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);

export default async function AdminHome({ searchParams }: PageProps<"/admin">) {
  const { supabase } = await requireAdmin();
  const days = pickDays((await searchParams).days);
  const to = nairobiToday();
  const from = addDays(to, -(days - 1));
  const { data } = await supabase.rpc("platform_usage", { p_from: from, p_to: to });
  const u = data as Platform;
  const k = u.kill_criteria;
  const usagePct = pct(k.barbers_15_codes_last_7_days, k.barbers);
  const payPct = pct(k.paying_after_trial, k.trial_ended);
  return (
    <Page title={s.admin.title} actions={<a href={`/api/export/usage?format=csv&from=${from}&to=${to}`} className="min-h-12 px-2 py-3 font-semibold text-brand">{s.app.downloadCsv}</a>}>
      <AdminNav at="/admin" />
      <RangeNav base="/admin" days={days} />
      <div className="space-y-4">
        <Card className="space-y-3">
          <div className="text-lg font-bold">{s.admin.killTitle}</div>
          <div className="grid grid-cols-2 gap-3">
            <Stat label={`${s.admin.killUsage}: ${k.barbers_15_codes_last_7_days}/${k.barbers}`} value={`${usagePct}%`} tone={usagePct < 60 ? "warn" : undefined} />
            <Stat label={`${s.admin.killPay}: ${k.paying_after_trial}/${k.trial_ended}`} value={`${payPct}%`} tone={k.trial_ended && payPct < 40 ? "warn" : undefined} />
          </div>
        </Card>
        <div className="grid grid-cols-3 gap-3">
          <Stat label={s.admin.signups} value={u.signups} />
          <Stat label={s.admin.newShops} value={u.new_shops} />
          <Stat label={s.admin.movedWithBook} value={u.barbers_moved_with_book} />
        </div>
        <UsageCodes m={u.codes} />
        <BookingTable rows={u.bookings} />
        <div className="grid grid-cols-2 gap-3">
          <Stat label={`${s.manager.problemsTitle}: open`} value={u.problems.open} />
          <Stat label={`${s.manager.problemsTitle}: ${s.manager.resolved}`} value={u.problems.resolved} />
        </div>
        <Card className="space-y-1">
          <div className="font-bold">{s.admin.dailyActive}</div>
          {u.daily_active.map((d) => <div key={d.day} className="flex justify-between text-sm"><span>{dayLabel(d.day + "T12:00:00+03:00")}</span><b>{d.users}</b></div>)}
        </Card>
      </div>
    </Page>
  );
}
