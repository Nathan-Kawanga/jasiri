import { requireShopRole } from "@/lib/context";
import { s } from "@/lib/strings";
import { Page } from "@/components/ui";
import { AuditList, type AuditRow } from "@/components/audit-list";

export default async function AuditPage({ searchParams }: PageProps<"/shop/audit">) {
  const { supabase, shop } = await requireShopRole("manager");
  const { before } = await searchParams;
  let q = supabase.from("audit_log").select("id, at, actor_id, actor_roles, action, entity, before, after")
    .eq("shop_id", shop.shop_id).order("id", { ascending: false }).limit(50);
  if (typeof before === "string" && /^\d+$/.test(before)) q = q.lt("id", Number(before));
  const { data } = await q;
  const rows = (data ?? []) as AuditRow[];
  const ids = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))] as string[];
  const { data: people } = ids.length ? await supabase.from("profiles").select("id, full_name").in("id", ids) : { data: [] };
  const names = Object.fromEntries((people ?? []).map((p) => [p.id, p.full_name]));
  return (
    <Page title={s.manager.auditTitle}>
      <AuditList rows={rows} names={names} moreHref={rows.length === 50 ? `/shop/audit?before=${rows[49].id}` : null} />
    </Page>
  );
}
