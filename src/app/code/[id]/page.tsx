import { notFound } from "next/navigation";
import { requireContext } from "@/lib/context";
import { Page } from "@/components/ui";
import { CodeConfirm, type CodeView } from "./confirm";

export default async function CodePage({ params }: PageProps<"/code/[id]">) {
  const { id } = await params;
  const { supabase, profile } = await requireContext();
  const { data: c } = await supabase.from("codes")
    .select("id, display_code, status, barber_amount, client_first_name, assigned_staff_id, created_by, barber_id")
    .eq("id", id).maybeSingle();
  if (!c || c.created_by !== profile.id) notFound();
  let staffName: string | null = null;
  if (c.assigned_staff_id) {
    const { data } = await supabase.from("profiles").select("full_name").eq("id", c.assigned_staff_id).maybeSingle();
    staffName = data?.full_name ?? null;
  }
  const view: CodeView = { ...c, staff_name: staffName };
  return (
    <Page title={c.display_code} back={c.barber_id ? "/" : "/queue"}>
      <CodeConfirm code={view} />
    </Page>
  );
}
