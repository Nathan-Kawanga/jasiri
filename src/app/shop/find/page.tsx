import { requireContext } from "@/lib/context";
import { s } from "@/lib/strings";
import { Notice, Page } from "@/components/ui";
import { FindShop } from "./find";

export default async function FindShopPage({ searchParams }: PageProps<"/shop/find">) {
  const { profile } = await requireContext();
  const { welcome } = await searchParams;
  const role = (profile as { signup_role?: string | null }).signup_role ?? (profile.is_barber ? "barber" : null);
  return (
    <Page title={s.shop.findTitle}>
      {welcome ? <div className="mb-4"><Notice tone="ok">{s.shop.welcomeFind}</Notice></div> : null}
      <FindShop isBarber={profile.is_barber} defaultRole={role} />
    </Page>
  );
}
