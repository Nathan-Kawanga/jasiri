import { requireShopRole } from "@/lib/context";
import { s } from "@/lib/strings";
import { Page } from "@/components/ui";
import { nairobiToday, nairobiToIso } from "@/lib/format";
import { NewCode, type Preselected, type TodayBooking } from "./new-code";

export default async function NewCodePage({ searchParams }: PageProps<"/code/new">) {
  const { supabase, shop, profile } = await requireShopRole("barber");
  const { booking } = await searchParams;
  let pre: Preselected | null = null;
  if (typeof booking === "string") {
    const { data } = await supabase.from("bookings").select("id, client_id, status, services, clients(first_name)")
      .eq("id", booking).eq("status", "booked").maybeSingle();
    if (data) pre = {
      bookingId: data.id, firstName: (data.clients as unknown as { first_name: string } | null)?.first_name ?? "",
      services: ((data.services ?? []) as { name: string; kind: string }[]).filter((x) => x.kind === "barber").map((x) => x.name),
    };
  }
  const today = nairobiToday();
  const [{ data: services }, { data: booked }] = await Promise.all([
    supabase.rpc("my_services"),
    // Today's bookings not yet coded: one tap starts the code for that client.
    supabase.from("bookings").select("id, slot_start, services, clients(first_name)")
      .eq("barber_id", profile.id).eq("status", "booked")
      .gte("slot_start", nairobiToIso(today, "00:00")).lt("slot_start", nairobiToIso(nairobiToday(1), "00:00"))
      .order("slot_start"),
  ]);
  const todays: TodayBooking[] = (booked ?? []).map((b) => ({
    bookingId: b.id, at: b.slot_start,
    firstName: (b.clients as unknown as { first_name: string } | null)?.first_name ?? "",
    services: ((b.services ?? []) as { name: string; kind: string }[]).filter((x) => x.kind === "barber").map((x) => x.name),
  }));
  return (
    <Page title={s.code.newTitle}>
      <NewCode shopId={shop.shop_id} barberName={profile.full_name.split(" ")[0]} preselected={pre} bookings={todays}
        services={(services ?? []) as { name: string; price: number }[]} />
    </Page>
  );
}
