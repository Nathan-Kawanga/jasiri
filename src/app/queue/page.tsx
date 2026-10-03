import { requireShopRole } from "@/lib/context";
import { s } from "@/lib/strings";
import { Page } from "@/components/ui";
import { Queue, type QueueData } from "./queue";

export default async function QueuePage() {
  const { supabase, shop } = await requireShopRole("service_staff");
  const { data } = await supabase.rpc("service_queue", { p_shop: shop.shop_id });
  return (
    <Page title={s.queue.title}>
      <Queue shopId={shop.shop_id} initial={data as QueueData} />
    </Page>
  );
}
