import { requireBarber } from "@/lib/context";
import { s } from "@/lib/strings";
import { Page } from "@/components/ui";
import { Photos, type Photo } from "./photos";

export default async function PhotosPage() {
  const { supabase, profile } = await requireBarber();
  const { data } = await supabase.from("portfolio_photos").select("id, path, caption").order("created_at", { ascending: false });
  return (
    <Page title={s.photos.title}>
      <Photos userId={profile.id} name={profile.full_name} avatarPath={profile.photo_path} initial={(data ?? []) as Photo[]} />
    </Page>
  );
}
