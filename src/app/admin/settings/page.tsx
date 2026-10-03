import { requireAdmin } from "@/lib/context";
import { s } from "@/lib/strings";
import { Page } from "@/components/ui";
import { AdminNav } from "../nav";
import { Settings } from "./settings";

export default async function AdminSettings() {
  const { profile } = await requireAdmin();
  return (
    <Page title={s.admin.settings}>
      <AdminNav at="/admin/settings" />
      <Settings instructions={profile.payment_instructions} price={profile.monthly_price_kes} />
    </Page>
  );
}
