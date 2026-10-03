import { requireAdmin } from "@/lib/context";
import { s } from "@/lib/strings";
import { Page } from "@/components/ui";
import { AdminNav } from "../nav";
import { ClientDelete } from "./delete";

export default async function AdminClients() {
  await requireAdmin();
  return (
    <Page title={s.admin.clients}>
      <AdminNav at="/admin/clients" />
      <ClientDelete />
    </Page>
  );
}
