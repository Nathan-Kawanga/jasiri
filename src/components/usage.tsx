import { s } from "@/lib/strings";
import { Card, Stat } from "./ui";

export type CodeMetrics = { confirmed: number; with_phone_pct: number | null; paid_pct: number | null; median_confirm_to_paid_min: number | null };
export type BookingMetric = { name: string; link: number; manual: number; link_pct: number | null; no_show_pct: number | null };

export function UsageCodes({ m }: { m: CodeMetrics }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Stat label={s.manager.withPhone} value={`${m.with_phone_pct ?? 0}%`} tone={(m.with_phone_pct ?? 0) < 80 ? "warn" : undefined} />
      <Stat label={s.manager.reachPaid} value={`${m.paid_pct ?? 0}%`} />
      <Stat label={s.manager.medianMinutes} value={m.median_confirm_to_paid_min ?? "—"} />
      <Stat label={s.manager.created} value={m.confirmed} />
    </div>
  );
}

export function BookingTable({ rows }: { rows: BookingMetric[] }) {
  return (
    <Card className="space-y-1">
      <div className="font-bold">{s.manager.bookingSplit}</div>
      <div className="text-sm text-muted">{s.manager.noShowRate}</div>
      {rows.length === 0 ? <div className="text-sm text-muted">{s.app.none}</div> : null}
      {rows.map((b) => (
        <div key={b.name} className="flex justify-between text-sm">
          <span>{b.name}</span>
          <span className={(b.link_pct ?? 0) < 30 ? "font-semibold text-amber-800" : ""}>{b.link}/{b.link + b.manual} ({b.link_pct ?? 0}%) · {b.no_show_pct ?? 0}%</span>
        </div>
      ))}
    </Card>
  );
}
