import { requireBarber } from "@/lib/context";
import { s } from "@/lib/strings";
import { Page } from "@/components/ui";
import { ClientBook, type BookClient } from "./book";

export default async function ClientsPage() {
  const { supabase, profile } = await requireBarber();
  const { data } = await supabase.rpc("my_client_book", { p_search: null });
  return (
    <Page title={s.clients.title} actions={<a href="/api/export/clients" download className="min-h-12 px-2 py-3 font-semibold text-brand">{s.app.downloadCsv}</a>}>
      <ClientBook initial={(data ?? []) as BookClient[]} barberName={profile.full_name.split(" ")[0]} />
    </Page>
  );
}
