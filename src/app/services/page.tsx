import { redirect } from "next/navigation";
import { requireContext } from "@/lib/context";
import { s } from "@/lib/strings";
import { Page } from "@/components/ui";
import { ServicesEditor, type Service } from "./editor";

export default async function ServicesPage() {
  const { supabase, profile, shops } = await requireContext();
  const isStaff = shops.some((m) => m.status === "active" && m.roles.includes("service_staff"));
  if (!profile.is_barber && !isStaff) redirect("/");
  const { data } = await supabase.rpc("my_services");
  return (
    <Page title={s.services.title}>
      <ServicesEditor initial={(data ?? []) as Service[]} barber={profile.is_barber} />
    </Page>
  );
}
