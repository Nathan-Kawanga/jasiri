import Link from "next/link";
import { requireAdmin } from "@/lib/context";
import { s } from "@/lib/strings";
import { dayLabel } from "@/lib/format";
import { Badge, Card, Page } from "@/components/ui";
import { AdminNav } from "../nav";
import { SuspendShop } from "./suspend";

type Shop = { id: string; name: string; area: string; created_at: string; suspended: boolean; members: number; codes_7d: number };

export default async function AdminShops() {
  const { supabase } = await requireAdmin();
  const { data } = await supabase.rpc("admin_shops");
  return (
    <Page title={s.admin.shops}>
      <AdminNav at="/admin/shops" />
      <div className="space-y-3">
        {((data ?? []) as Shop[]).map((x) => (
          <Card key={x.id} className="space-y-2">
            <div className="flex items-center gap-2"><b className="text-lg">{x.name}</b>{x.suspended ? <Badge tone="red">{s.admin.suspend}</Badge> : null}</div>
            <div className="text-sm text-muted">{x.area} · {dayLabel(x.created_at)} · {x.members} {s.shop.members.toLowerCase()} · {x.codes_7d} codes (7d)</div>
            <div className="grid grid-cols-2 gap-2">
              <Link href={`/admin/shops/${x.id}`} className="min-h-12 rounded-xl border-2 border-brand py-3 text-center font-semibold text-brand">{s.manager.auditTitle}</Link>
              <SuspendShop id={x.id} suspended={x.suspended} />
            </div>
          </Card>
        ))}
      </div>
    </Page>
  );
}
