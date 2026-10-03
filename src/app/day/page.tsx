import { requireBarber } from "@/lib/context";
import { s } from "@/lib/strings";
import { nairobiToday, addDays, dayLabel } from "@/lib/format";
import { Page } from "@/components/ui";
import Link from "next/link";
import { DayView, type DayData } from "./day";

export default async function DayPage({ searchParams }: PageProps<"/day">) {
  const { supabase, profile, roles, current } = await requireBarber();
  const { d } = await searchParams;
  const day = typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : nairobiToday();
  const { data } = await supabase.rpc("my_day", { p_date: day });
  const canCode = !!current && roles.includes("barber");
  return (
    <Page title={s.booking.dayTitle}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <Link href={`/day?d=${addDays(day, -1)}`} className="min-h-12 min-w-12 rounded-xl border border-line px-3 py-2.5 text-center font-bold">‹</Link>
        <div className="text-center text-lg font-bold">{day === nairobiToday() ? s.app.today : dayLabel(day + "T12:00:00+03:00")}</div>
        <Link href={`/day?d=${addDays(day, 1)}`} className="min-h-12 min-w-12 rounded-xl border border-line px-3 py-2.5 text-center font-bold">›</Link>
      </div>
      <DayView day={day} data={data as DayData} canCode={canCode} barberName={profile.full_name.split(" ")[0]} />
    </Page>
  );
}
