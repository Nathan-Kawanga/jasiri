import Link from "next/link";
import { s } from "@/lib/strings";
import { addDays, dayLabel, nairobiToday } from "@/lib/format";

export function pickDay(d: unknown): string {
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : nairobiToday();
}

export function DayNav({ base, day }: { base: string; day: string }) {
  const today = nairobiToday();
  return (
    <div className="no-print mb-4 flex items-center justify-between gap-2">
      <Link href={`${base}?d=${addDays(day, -1)}`} className="min-h-12 min-w-12 rounded-xl border-2 border-line px-3 py-2.5 text-center font-bold">‹</Link>
      <div className="text-lg font-bold">{day === today ? s.app.today : dayLabel(day + "T12:00:00+03:00")}</div>
      {day < today
        ? <Link href={`${base}?d=${addDays(day, 1)}`} className="min-h-12 min-w-12 rounded-xl border-2 border-line px-3 py-2.5 text-center font-bold">›</Link>
        : <span className="min-w-12" />}
    </div>
  );
}

export function RangeNav({ base, days }: { base: string; days: number }) {
  return (
    <div className="no-print mb-4 grid grid-cols-2 gap-2">
      {[7, 30].map((n) => (
        <Link key={n} href={`${base}?days=${n}`} className={`min-h-12 rounded-xl py-3 text-center font-semibold ${n === days ? "bg-brand text-white" : "border-2 border-line bg-white"}`}>
          {n === 7 ? s.manager.last7 : s.manager.last30}
        </Link>
      ))}
    </div>
  );
}

export function pickDays(v: unknown): number {
  return v === "30" ? 30 : 7;
}
