import { requireShopRole } from "@/lib/context";
import { s } from "@/lib/strings";
import { dateTime } from "@/lib/format";
import { Badge, Card, Page, Empty } from "@/components/ui";
import { Resolve } from "@/components/resolve-problem";

export default async function ProblemsPage() {
  const { supabase, shop } = await requireShopRole("manager");
  const { data } = await supabase.from("problem_reports")
    .select("id, note, status, resolution_note, created_at, resolved_at, reporter:profiles!problem_reports_reporter_id_fkey(full_name)")
    .eq("shop_id", shop.shop_id).order("created_at", { ascending: false }).limit(100);
  const rows = (data ?? []) as unknown as { id: string; note: string; status: string; resolution_note: string | null; created_at: string; reporter: { full_name: string } }[];
  return (
    <Page title={s.manager.problemsTitle}>
      <div className="space-y-3">
        {rows.length === 0 ? <Empty>{s.app.none}</Empty> : null}
        {rows.map((r) => (
          <Card key={r.id} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <b>{r.reporter.full_name}</b>
              <Badge tone={r.status === "open" ? "amber" : "green"}>{r.status === "open" ? "Open" : s.manager.resolved}</Badge>
            </div>
            <div className="text-sm text-muted">{dateTime(r.created_at)}</div>
            <p className="whitespace-pre-line">{r.note}</p>
            {r.resolution_note ? <p className="rounded-xl bg-paper p-2 text-sm">{r.resolution_note}</p> : null}
            {r.status === "open" ? <Resolve id={r.id} /> : null}
          </Card>
        ))}
      </div>
    </Page>
  );
}
