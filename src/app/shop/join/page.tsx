import { requireContext } from "@/lib/context";
import { s } from "@/lib/strings";
import { Notice, Page } from "@/components/ui";
import { JoinForm } from "./form";

export default async function JoinShop({ searchParams }: PageProps<"/shop/join">) {
  await requireContext();
  const { code, welcome } = await searchParams;
  return (
    <Page title={s.shop.joinTitle}>
      {welcome ? <div className="mb-4"><Notice tone="ok">{s.shop.welcomeJoin}</Notice></div> : null}
      <JoinForm initialCode={typeof code === "string" ? code : ""} />
    </Page>
  );
}
