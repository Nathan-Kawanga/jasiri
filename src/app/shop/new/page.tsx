import { requireContext } from "@/lib/context";
import { s } from "@/lib/strings";
import { Notice, Page } from "@/components/ui";
import { NewShopForm } from "./form";

export default async function NewShop({ searchParams }: PageProps<"/shop/new">) {
  await requireContext();
  const { welcome } = await searchParams;
  return (
    <Page title={s.shop.createTitle}>
      {welcome ? <div className="mb-4"><Notice tone="ok">{s.shop.welcomeCreate}</Notice></div> : null}
      <NewShopForm />
    </Page>
  );
}
