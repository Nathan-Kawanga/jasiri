import { requireShopRole } from "@/lib/context";
import { s } from "@/lib/strings";
import { Page } from "@/components/ui";
import { NewCode, type Preselected } from "./new-code";

export default async function NewCodePage({ searchParams }: PageProps<"/code/new">) {
  const { supabase, shop, profile } = await requireShopRole("barber");
  const { booking } = await searchParams;
  let pre: Preselected | null = null;
  if (typeof booking === "string") {
    const { data } = await supabase.from("bookings").select("id, client_id, status, clients(first_name)")
      .eq("id", booking).eq("status", "booked").maybeSingle();
    if (data) pre = { bookingId: data.id, firstName: (data.clients as unknown as { first_name: string } | null)?.first_name ?? "" };
  }
  return (
    <Page title={s.code.newTitle}>
      <NewCode shopId={shop.shop_id} barberName={profile.full_name.split(" ")[0]} preselected={pre} />
    </Page>
  );
}
