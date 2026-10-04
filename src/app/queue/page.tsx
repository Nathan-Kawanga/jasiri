import { requireShopRole } from "@/lib/context";
import { s } from "@/lib/strings";
import { Page } from "@/components/ui";
import { Queue, type QueueData } from "./queue";

export default async function QueuePage() {
  const { supabase, shop } = await requireShopRole("service_staff");
  const [{ data }, { data: services }] = await Promise.all([
    supabase.rpc("service_queue", { p_shop: shop.shop_id }),
    supabase.rpc("my_services"),
  ]);
  return (
    <Page title={s.queue.title}>
      <Queue shopId={shop.shop_id} initial={data as QueueData} services={(services ?? []) as { name: string; price: number }[]} />
    </Page>
  );
}
