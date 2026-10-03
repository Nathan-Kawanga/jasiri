import { requireBarber } from "@/lib/context";
import { s } from "@/lib/strings";
import { nairobiToday } from "@/lib/format";
import { Page } from "@/components/ui";
import { Availability, type Rule, type Block } from "./availability";

export default async function AvailabilityPage() {
  const { supabase, profile } = await requireBarber();
  const { data } = await supabase.rpc("my_day", { p_date: nairobiToday() });
  const d = data as { rules: Rule[]; blocks: Block[] };
  return (
    <Page title={s.booking.availabilityTitle}>
      <Availability rules={d.rules} blocks={d.blocks} slotMinutes={profile.slot_minutes} />
    </Page>
  );
}
