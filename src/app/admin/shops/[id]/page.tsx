import { requireAdmin } from "@/lib/context";
import { s } from "@/lib/strings";
import { Page } from "@/components/ui";
import { AuditList, type AuditRow } from "@/components/audit-list";

export default async function AdminShopAudit({ params, searchParams }: PageProps<"/admin/shops/[id]">) {
  const { supabase } = await requireAdmin();
  const { id } = await params;
  const { before } = await searchParams;
  const { data: shop } = await supabase.from("shops").select("name").eq("id", id).maybeSingle();
  let q = supabase.from("audit_log").select("id, at, actor_id, actor_roles, action, entity, before, after")
    .eq("shop_id", id).order("id", { ascending: false }).limit(50);
  if (typeof before === "string" && /^\d+$/.test(before)) q = q.lt("id", Number(before));
  const { data } = await q;
  const rows = (data ?? []) as AuditRow[];
  const ids = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))] as string[];
  const { data: people } = ids.length ? await supabase.from("profiles").select("id, full_name").in("id", ids) : { data: [] };
  return (
    <Page title={`${s.manager.auditTitle} · ${shop?.name ?? ""}`} back="/admin/shops">
      <AuditList rows={rows} names={Object.fromEntries((people ?? []).map((p) => [p.id, p.full_name]))}
        moreHref={rows.length === 50 ? `/admin/shops/${id}?before=${rows[49].id}` : null} />
    </Page>
  );
}
