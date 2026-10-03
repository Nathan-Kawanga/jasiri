import Link from "next/link";
import { s } from "@/lib/strings";
import { dateTime } from "@/lib/format";
import { Empty } from "./ui";

export type AuditRow = {
  id: number; at: string; actor_id: string | null; actor_roles: string[]; action: string; entity: string;
  before: Record<string, unknown> | null; after: Record<string, unknown> | null;
};

const HIDE = new Set(["id", "shop_id", "created_at", "created_day", "requested_at", "added_at"]);

function changes(r: AuditRow): string {
  if (r.before && r.after) {
    return Object.keys(r.after)
      .filter((k) => !HIDE.has(k) && JSON.stringify(r.before![k]) !== JSON.stringify(r.after![k]))
      .map((k) => `${k}: ${fmt(r.before![k])} → ${fmt(r.after![k])}`).join(" · ");
  }
  const row = r.after ?? r.before ?? {};
  return ["display_code", "status", "barber_amount", "amount", "roles", "name", "first_name", "slot_start"]
    .filter((k) => k in row).map((k) => `${k}: ${fmt(row[k])}`).join(" · ");
}
const fmt = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

export function AuditList({ rows, names, moreHref }: { rows: AuditRow[]; names: Record<string, string>; moreHref: string | null }) {
  if (rows.length === 0) return <Empty>{s.app.none}</Empty>;
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.id} className="rounded-xl border border-line bg-surface p-2 text-sm">
          <div className="flex justify-between gap-2"><b>{r.action}</b><span className="text-muted">{dateTime(r.at)}</span></div>
          <div className="text-muted">{r.actor_id ? names[r.actor_id] ?? r.actor_id.slice(0, 8) : "system"}{r.actor_roles.length ? ` (${r.actor_roles.join(", ")})` : ""}</div>
          <div className="break-words font-mono text-xs">{changes(r)}</div>
        </div>
      ))}
      {moreHref ? <Link href={moreHref} className="block min-h-12 py-3 text-center font-semibold text-brand">{s.manager.loadMore}</Link> : null}
    </div>
  );
}
