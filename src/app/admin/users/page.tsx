import { requireAdmin } from "@/lib/context";
import { s } from "@/lib/strings";
import { Page } from "@/components/ui";
import { AdminNav } from "../nav";
import { UserList, type AdminUser } from "./users";

export default async function AdminUsers({ searchParams }: PageProps<"/admin/users">) {
  const { supabase, profile } = await requireAdmin();
  const { q } = await searchParams;
  const { data } = await supabase.rpc("admin_users", { p_search: typeof q === "string" ? q : null });
  return (
    <Page title={s.admin.users}>
      <AdminNav at="/admin/users" />
      <form className="mb-4"><input name="q" defaultValue={typeof q === "string" ? q : ""} placeholder={s.app.search}
        className="block min-h-12 w-full rounded-xl border-2 border-line bg-white px-3 text-lg" /></form>
      <UserList users={(data ?? []) as AdminUser[]} me={profile.id} />
    </Page>
  );
}
